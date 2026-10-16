import * as THREE from 'three'

// The visitor's walk. Scrolling, swiping or the keys move a target along the
// walk; the camera glides after it on a critically damped spring, so a hard
// flick of the wheel still lands like a dolly move. Poses are keyframes of
// position, heading and pitch, interpolated with Catmull-Rom so the camera
// turns and walks in one continuous motion.
//
// The walk opens at the island's front landing looking out over the rim at
// the sea of clouds, turns to face the gate, passes under it and follows the
// path to the shrine terrace, ending in front of the plaque rack.

interface Key {
  x: number
  y: number
  z: number
  yaw: number // heading(): 0 looks down -z, -pi/2 down +x
  pitch: number
  focus: number // metres to the point of interest
}

const KEYS: Key[] = [
  { x: 1.6, y: 1.55, z: 21.0, yaw: Math.PI + 0.5, pitch: -0.3, focus: 9 },
  { x: 1.5, y: 1.6, z: 21.2, yaw: 4.25, pitch: -0.1, focus: 40 },
  { x: 0.9, y: 1.62, z: 20.6, yaw: 5.95, pitch: 0.02, focus: 14 },
  { x: 0.2, y: 1.62, z: 16.4, yaw: 6.27, pitch: 0.035, focus: 18 },
  { x: -0.3, y: 1.62, z: 9.0, yaw: 6.3, pitch: 0.035, focus: 20 },
  { x: -0.35, y: 1.62, z: 0.8, yaw: 6.24, pitch: 0.06, focus: 16 },
  { x: 0.05, y: 1.66, z: -6.0, yaw: 6.2, pitch: 0.15, focus: 10 },
  { x: 4.15, y: 2.82, z: -10.15, yaw: 5.5, pitch: -0.1, focus: 3.4 },
]

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t
  const t3 = t2 * t
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

export interface Pose {
  position: THREE.Vector3
  yaw: number
  pitch: number
  roll: number
  focus: number
}

export class Walk {
  progress = 0 // where the camera is, 0..1
  target = 0 // where the input says it should be
  private velocity = 0
  private touchY: number | null = null
  private touchVel = 0
  private lastTouchT = 0
  private element: HTMLElement
  private reduced: boolean
  private onAdvance: () => void
  private pose: Pose = { position: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, focus: 10 }

  constructor(element: HTMLElement, reduced: boolean, onAdvance: () => void) {
    this.element = element
    this.reduced = reduced
    this.onAdvance = onAdvance
    element.addEventListener('wheel', this.onWheel, { passive: false })
    element.addEventListener('touchstart', this.onTouchStart, { passive: true })
    element.addEventListener('touchmove', this.onTouchMove, { passive: false })
    element.addEventListener('touchend', this.onTouchEnd, { passive: true })
    window.addEventListener('keydown', this.onKey)
  }

  private nudge(d: number): void {
    this.target = THREE.MathUtils.clamp(this.target + d, 0, 1)
    this.onAdvance()
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY
    this.nudge(px / 2600)
  }

  private onTouchStart = (e: TouchEvent) => {
    if (e.touches.length !== 1) return
    this.touchY = e.touches[0].clientY
    this.touchVel = 0
    this.lastTouchT = performance.now()
  }

  private onTouchMove = (e: TouchEvent) => {
    if (this.touchY === null || e.touches.length !== 1) return
    e.preventDefault()
    const y = e.touches[0].clientY
    const now = performance.now()
    const dy = this.touchY - y
    const dt = Math.max(1, now - this.lastTouchT)
    // a swipe the height of the screen walks about a third of the way
    const d = dy / (window.innerHeight * 3)
    this.touchVel = this.touchVel * 0.6 + (d / dt) * 1000 * 0.4
    this.touchY = y
    this.lastTouchT = now
    this.nudge(d)
  }

  private onTouchEnd = () => {
    if (this.touchY === null) return
    this.touchY = null
    // carry the swipe on, like a flick of a list
    this.velocity = THREE.MathUtils.clamp(this.touchVel, -1.2, 1.2)
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'A' || t.tagName === 'BUTTON' || t.tagName === 'INPUT')) {
      if (e.key === ' ' || e.key === 'Enter') return
    }
    switch (e.key) {
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        this.nudge(e.key === 'ArrowDown' ? 0.04 : 0.12)
        break
      case 'ArrowUp':
      case 'PageUp':
        this.nudge(e.key === 'ArrowUp' ? -0.04 : -0.12)
        break
      case 'Home':
        this.nudge(-1)
        break
      case 'End':
        this.nudge(1)
        break
      default:
        return
    }
    e.preventDefault()
  }

  update(dt: number): Pose {
    if (this.velocity !== 0) {
      this.target = THREE.MathUtils.clamp(this.target + this.velocity * dt, 0, 1)
      this.velocity *= Math.exp(-dt * 3.2)
      if (Math.abs(this.velocity) < 1e-3) this.velocity = 0
    }
    // a damped approach; reduced motion jumps
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * 2.4)
    this.progress += (this.target - this.progress) * k
    return this.sample(this.progress)
  }

  sample(p: number): Pose {
    const n = KEYS.length - 1
    const f = THREE.MathUtils.clamp(p, 0, 1) * n
    const i = Math.min(Math.floor(f), n - 1)
    const t = f - i
    // ease within each span a little so the keys feel like beats, not corners
    const k0 = KEYS[Math.max(i - 1, 0)]
    const k1 = KEYS[i]
    const k2 = KEYS[i + 1]
    const k3 = KEYS[Math.min(i + 2, n)]
    const pick = (key: keyof Key) => catmull(k0[key], k1[key], k2[key], k3[key], t)
    this.pose.position.set(pick('x'), pick('y'), pick('z'))
    this.pose.yaw = pick('yaw')
    this.pose.pitch = pick('pitch')
    this.pose.roll = 0
    this.pose.focus = Math.max(1, pick('focus'))
    return this.pose
  }

  dispose(): void {
    const el = this.element
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('touchstart', this.onTouchStart)
    el.removeEventListener('touchmove', this.onTouchMove)
    el.removeEventListener('touchend', this.onTouchEnd)
    window.removeEventListener('keydown', this.onKey)
  }
}

// heading and pitch to a direction: yaw 0 looks down -z, yaw -pi/2 looks
// down +x
export function heading(yaw: number, pitch: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
}
