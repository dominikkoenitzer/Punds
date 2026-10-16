import * as THREE from 'three'
import { EMA_RACK, groundHeight } from './layout'

// The visitor stands still and looks around. From the centre of the garden,
// on the path between the lanterns, the view holds still while the mouse
// moves over the middle of the screen, so whatever it points at stays under
// it; towards the left or right edge the head turns, further the closer to
// the edge, round and round without end. Dragging (or a finger on a phone) turns it
// too. A click on one of the garden's places flies the eyes to a close view
// of it; there the head turns only a little, and a click outside it, Esc or
// the browser's back flies home again.

export interface View {
  position: THREE.Vector3
  yaw: number // heading(): 0 looks down -z, -pi/2 down +x
  pitch: number
  focus: number // metres to what the view is about
  // how far the head may turn here, left and right and up and down, in radians
  panYaw: number
  panPitch: number
}

const view = (x: number, y: number, z: number, yaw: number, pitch: number, focus: number, panYaw: number, panPitch: number): View => ({
  position: new THREE.Vector3(x, y, z),
  yaw,
  pitch,
  focus,
  panYaw,
  panPitch,
})

// at the centre the head turns without end, round and round
export const CENTRE = view(-0.3, 1.62, 9.6, Math.PI * 2, 0.03, 20, Infinity, 0.24)

export type Place = 'rack' | 'pond' | 'shrine'

// the close views: the plaque rack as it is framed at the end of the old
// walk, the pond from its bank, the hall from the foot of the steps
export const PLACES: Record<Place, View> = {
  rack: view(EMA_RACK.x - 1.87, groundHeight(EMA_RACK.x, EMA_RACK.z) + 1.5, EMA_RACK.z + 1.5, 5.385, -0.083, 2.4, 0.3, 0.1),
  pond: view(-3.2, 1.6, 6.6, 0.94, -0.27, 7, 0.45, 0.14),
  shrine: view(0, 2.3, -6.0, Math.PI * 2, 0.1, 10, 0.4, 0.14),
}

const FLIGHT = 1.4 // seconds

export interface Pose {
  position: THREE.Vector3
  yaw: number
  pitch: number
  focus: number
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

// how hard the pointer pushes at an edge: nothing over the middle of the
// screen, rising towards the border
function edge(a: number): number {
  const m = Math.abs(a)
  return m < 0.62 ? 0 : Math.sign(a) * ((m - 0.62) / 0.38) ** 2
}

export class Look {
  place: Place | null = null
  private from: Pose = { position: new THREE.Vector3(), yaw: 0, pitch: 0, focus: 10 }
  private flight = 1 // 0..1 through the current flight
  private pose: Pose = { position: new THREE.Vector3(), yaw: 0, pitch: 0, focus: 10 }
  private aim = new THREE.Vector2() // the pointer, -1..1
  private aimed = new THREE.Vector2()
  private drag = 0 // radians the head is turned by edges and drags
  private dragged = 0
  private tilt = 0
  private tilted = 0
  private reduced: boolean

  constructor(reduced: boolean) {
    this.reduced = reduced
    this.copyView(CENTRE, this.pose)
  }

  get view(): View {
    return this.place ? PLACES[this.place] : CENTRE
  }

  // 0 at the centre, 1 in a close view, eased through a flight
  get closeness(): number {
    const k = THREE.MathUtils.smootherstep(this.flight, 0, 1)
    return this.place ? k : 1 - k
  }

  get settled(): boolean {
    return this.flight >= 1 && Math.abs(this.drag - this.dragged) < 1e-3 && Math.abs(this.tilt - this.tilted) < 1e-3 && this.aim.distanceTo(this.aimed) < 1e-3 && edge(this.aim.x) === 0
  }

  // where the pointer is, in -1..1 across the screen; null when it left
  setAim(x: number | null, y = 0): void {
    // the bottom band holds the page's few words and the sound switch:
    // reaching for them must not turn the head
    if (x === null || y < -0.8) this.aim.set(0, 0)
    else this.aim.set(x, y)
  }

  // a drag across the screen, in screen widths
  dragBy(dx: number, dy = 0): void {
    const v = this.view
    this.drag = THREE.MathUtils.clamp(this.drag + dx * 2.6, -v.panYaw, v.panYaw)
    this.tilt = THREE.MathUtils.clamp(this.tilt + dy * 1.2, -v.panPitch, v.panPitch)
  }

  go(place: Place | null, immediate = false): void {
    if (place === this.place && this.flight >= 1) return
    this.from.position.copy(this.pose.position)
    this.from.yaw = this.pose.yaw
    this.from.pitch = this.pose.pitch
    this.from.focus = this.pose.focus
    this.place = place
    this.flight = immediate || this.reduced ? 1 : 0
    // a turn belongs to the view it was made in; the flight starts from
    // wherever the head is and takes the short way round
    this.drag = 0
    this.tilt = 0
    this.dragged = 0
    this.tilted = 0
  }

  update(dt: number): Pose {
    const v = this.view
    this.flight = Math.min(1, this.flight + dt / FLIGHT)
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 3)
    this.aimed.lerp(this.aim, k)
    // at the centre the edges of the screen turn the head, faster towards the
    // very edge; in a close view the head holds still, so whatever is near the
    // side stays where the pointer is
    if (this.flight >= 1 && !this.place) {
      this.drag += edge(this.aim.x) * 1.4 * dt
      this.tilt = THREE.MathUtils.clamp(this.tilt + edge(this.aim.y) * 0.5 * dt, -v.panPitch, v.panPitch)
    }
    const ease = this.reduced ? 1 : 1 - Math.exp(-dt * 5)
    this.dragged += (this.drag - this.dragged) * ease
    this.tilted += (this.tilt - this.tilted) * ease
    // and a breath of parallax, small enough that a pointed place stays put
    const yaw = v.yaw - this.aimed.x * 0.04 - this.dragged
    const pitch = v.pitch + this.aimed.y * 0.025 + this.tilted
    if (this.flight >= 1) {
      this.pose.position.copy(v.position)
      this.pose.yaw = yaw
      this.pose.pitch = pitch
      this.pose.focus = v.focus
      return this.pose
    }
    // the flight: eased, rising a little in the middle like a step forward
    const t = THREE.MathUtils.smootherstep(this.flight, 0, 1)
    this.pose.position.lerpVectors(this.from.position, v.position, t)
    this.pose.position.y += Math.sin(Math.PI * t) * 0.25
    this.pose.yaw = this.from.yaw + wrap(yaw - this.from.yaw) * t
    this.pose.pitch = THREE.MathUtils.lerp(this.from.pitch, pitch, t)
    this.pose.focus = THREE.MathUtils.lerp(this.from.focus, v.focus, t)
    return this.pose
  }

  private copyView(v: View, out: Pose): void {
    out.position.copy(v.position)
    out.yaw = v.yaw
    out.pitch = v.pitch
    out.focus = v.focus
  }
}

// heading and pitch to a direction: yaw 0 looks down -z, yaw -pi/2 looks
// down +x
export function heading(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
}
