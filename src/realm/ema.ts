import * as THREE from 'three'
import { EMA_RACK, TERRACE_Y, rng } from './layout'
import { LINKS, type Link } from '../links'
import { loadPbr, pbrMaterial, type PbrSet } from './assets'
import { bevelBox, merge, transformed, worldUv } from './geo'
import type { Frame, RealmPart, Tier } from './types'

// The plaque rack beside the shrine. Older plaques hang in overlapping rows,
// weathered grey; in front of them hang three new ones in pale wood, one per
// link. Those three hang turned a little away on their cords; pointing at one
// (or the first tap on a phone) turns it to face the visitor, a click (or a
// second tap) opens its link.

const RACK_W = 2.1
const POST_H = 2.0
const RAILS = [1.62, 1.3, 0.98] // above the terrace
const LINK_W = 0.34
const LINK_H = 0.24
const OLD_W = 0.18
const OLD_H = 0.12
// how far each link plaque hangs turned away on its cord, in radians
const LINK_REST = [-0.95, 0.8, 1.05]

function plaqueShape(w: number, h: number): THREE.Shape {
  // a rectangle with a shallow gabled top
  const s = new THREE.Shape()
  const shoulder = h * 0.72
  s.moveTo(-w / 2, 0)
  s.lineTo(w / 2, 0)
  s.lineTo(w / 2, shoulder)
  s.lineTo(0, h)
  s.lineTo(-w / 2, shoulder)
  s.closePath()
  return s
}

function plaqueGeometry(w: number, h: number, t: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(plaqueShape(w, h), {
    depth: t,
    bevelEnabled: true,
    bevelThickness: 0.0015,
    bevelSize: 0.002,
    bevelSegments: 2,
    curveSegments: 1,
  })
  // hang from the apex: the cord hole sits at the origin
  geo.translate(0, -h + 0.012, -t / 2)
  geo.clearGroups()
  return geo
}

// the name, brushed in ink on the plaque face, as a transparent texture
function nameTexture(name: string, w: number, h: number): THREE.CanvasTexture {
  const px = 1024
  const c = document.createElement('canvas')
  c.width = px
  c.height = Math.round((px * h) / w)
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  g.fillStyle = 'rgba(18, 14, 11, 0.94)'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const size = Math.round(c.height * 0.3)
  g.font = `600 ${size}px 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif`
  // ink pools a little: draw twice, the second slightly offset and fainter
  g.shadowColor = 'rgba(18, 14, 11, 0.35)'
  g.shadowBlur = size * 0.04
  g.fillText(name, c.width / 2, c.height * 0.56)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

interface Plaque {
  pivot: THREE.Group
  link: Link | null
  rest: number // resting turn on the cord
  turn: number
  turnVel: number
  swing: number
  phase: number
  hit: THREE.Mesh | null
  glow: THREE.MeshStandardMaterial | null
  focus: number
}

export class EmaRack implements RealmPart {
  readonly object = new THREE.Group()
  private plaques: Plaque[] = []
  private hits: THREE.Object3D[] = []
  private hovered: Plaque | null = null
  private armed: Plaque | null = null
  private disposables: { dispose(): void }[] = []
  private raycaster = new THREE.Raycaster()
  private camLocal = new THREE.Vector3()

  static async create(tier: Tier): Promise<EmaRack> {
    const [aged, cedar, copper] = await Promise.all([loadPbr('wood_aged', tier), loadPbr('cedar_planks', tier), loadPbr('copper', tier)])
    return new EmaRack(aged, cedar, copper)
  }

  private constructor(aged: PbrSet, cedar: PbrSet, copper: PbrSet) {
    const rand = rng(31)
    const frame: THREE.BufferGeometry[] = []
    for (const side of [-1, 1]) {
      frame.push(transformed(bevelBox(0.09, POST_H, 0.09, 0.008, 1), (side * RACK_W) / 2, POST_H / 2, 0))
    }
    for (const y of RAILS) frame.push(transformed(new THREE.CylinderGeometry(0.018, 0.018, RACK_W, 12), 0, y, 0, 0, 0, Math.PI / 2))
    // the little gabled roof
    for (const side of [-1, 1]) {
      frame.push(transformed(bevelBox(RACK_W + 0.55, 0.035, 0.42, 0.006, 1), 0, POST_H + 0.1, side * 0.17, side * -0.42))
    }
    frame.push(transformed(bevelBox(RACK_W + 0.1, 0.08, 0.08, 0.008, 1), 0, POST_H - 0.02, 0))
    const frameGeo = merge(frame.map((g) => worldUv(g, 1.2)))
    const frameMat = pbrMaterial(aged, { color: new THREE.Color(0.5, 0.42, 0.34), metalness: 0 })
    frameMat.metalnessMap = null
    const frameMesh = new THREE.Mesh(frameGeo, frameMat)
    frameMesh.castShadow = true
    frameMesh.receiveShadow = true
    this.object.add(frameMesh)
    const capGeo = transformed(bevelBox(RACK_W + 0.6, 0.05, 0.1, 0.01, 1), 0, POST_H + 0.25, 0)
    worldUv(capGeo, 1)
    const capMat = pbrMaterial(copper, { color: new THREE.Color(0.32, 0.55, 0.48), metalness: 0.2 })
    capMat.metalnessMap = null
    this.object.add(new THREE.Mesh(capGeo, capMat))
    this.disposables.push(frameGeo, frameMat, capGeo, capMat)

    // older plaques: weathered, overlapping, a few hung back to front
    const oldGeo = plaqueGeometry(OLD_W, OLD_H, 0.007)
    worldUv(oldGeo, 0.5)
    const oldMat = pbrMaterial(aged, { color: new THREE.Color(1.35, 1.22, 1.05), metalness: 0 })
    oldMat.metalnessMap = null
    const cordGeo = new THREE.TorusGeometry(0.018, 0.0025, 4, 12)
    const cordMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.5, 0.04, 0.03), roughness: 0.7 })
    this.disposables.push(oldGeo, oldMat, cordGeo, cordMat)
    for (let r = 0; r < RAILS.length; r++) {
      const count = 11 - r
      for (let i = 0; i < count; i++) {
        const x = -RACK_W / 2 + 0.12 + ((RACK_W - 0.24) * (i + 0.5 + (rand() - 0.5) * 0.5)) / count
        // the centre of the top rail is kept for the three new plaques
        if (r === 0 && Math.abs(x) < 0.6) continue
        const pivot = new THREE.Group()
        pivot.position.set(x, RAILS[r] - 0.012, 0.02 + rand() * 0.02)
        const m = new THREE.Mesh(oldGeo, oldMat)
        m.rotation.z = (rand() - 0.5) * 0.08
        if (rand() < 0.25) m.rotation.y = Math.PI
        m.castShadow = true
        m.receiveShadow = true
        pivot.add(m)
        const cord = new THREE.Mesh(cordGeo, cordMat)
        cord.scale.set(1, 1.3, 1)
        pivot.add(cord)
        this.object.add(pivot)
        this.plaques.push({ pivot, link: null, rest: (rand() - 0.5) * 0.5, turn: 0, turnVel: 0, swing: 0, phase: rand() * 10, hit: null, glow: null, focus: 0 })
      }
    }

    // the three link plaques
    const linkGeo = plaqueGeometry(LINK_W, LINK_H, 0.009)
    worldUv(linkGeo, 0.6)
    const faceGeo = new THREE.ShapeGeometry(plaqueShape(LINK_W * 0.97, LINK_H * 0.97))
    faceGeo.translate(0, -LINK_H * 0.97 + 0.012, 0.0062)
    // map the face's texture coordinates to the plaque's bounds
    {
      const p = faceGeo.getAttribute('position')
      const uv = faceGeo.getAttribute('uv')
      for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (LINK_W * 0.97) + 0.5, (p.getY(i) + LINK_H * 0.97 - 0.012) / (LINK_H * 0.97))
    }
    const hitGeo = new THREE.BoxGeometry(LINK_W * 1.25, LINK_H * 1.35, 0.06)
    hitGeo.translate(0, -LINK_H / 2, 0)
    const hitMat = new THREE.MeshBasicMaterial({ visible: false })
    this.disposables.push(linkGeo, faceGeo, hitGeo, hitMat)
    LINKS.forEach((link, i) => {
      const pivot = new THREE.Group()
      const x = (i - (LINKS.length - 1) / 2) * 0.44
      pivot.position.set(x, RAILS[0] - 0.012, 0.05)
      const mat = pbrMaterial(cedar, { color: new THREE.Color(1.0, 0.86, 0.68), metalness: 0, emissive: new THREE.Color(1, 0.7, 0.4), emissiveIntensity: 0 })
      mat.metalnessMap = null
      const body = new THREE.Mesh(linkGeo, mat)
      body.castShadow = true
      body.receiveShadow = true
      pivot.add(body)
      const tex = nameTexture(link.name, LINK_W, LINK_H)
      const faceMat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 })
      const face = new THREE.Mesh(faceGeo, faceMat)
      pivot.add(face)
      const cord = new THREE.Mesh(cordGeo, cordMat)
      cord.scale.set(1.3, 1.6, 1.3)
      pivot.add(cord)
      const hit = new THREE.Mesh(hitGeo, hitMat)
      hit.userData.plaque = this.plaques.length
      pivot.add(hit)
      this.hits.push(hit)
      this.object.add(pivot)
      this.disposables.push(mat, tex, faceMat)
      this.plaques.push({ pivot, link, rest: LINK_REST[i % LINK_REST.length], turn: 0, turnVel: 0, swing: 0, phase: i * 2.1, hit, glow: mat, focus: 0 })
    })
    for (const p of this.plaques) p.turn = p.rest

    this.object.position.set(EMA_RACK.x, TERRACE_Y, EMA_RACK.z)
    this.object.rotation.y = EMA_RACK.rotation
  }

  private pick(ray: THREE.Ray | null): Plaque | null {
    if (!ray) return null
    this.raycaster.ray.copy(ray)
    const hit = this.raycaster.intersectObjects(this.hits, false)[0]
    return hit ? this.plaques[hit.object.userData.plaque as number] : null
  }

  // the cursor the host should show over the canvas
  get pointing(): boolean {
    return this.hovered !== null
  }

  // a mouse hover; touches go through tap()
  hover(ray: THREE.Ray | null): void {
    this.hovered = this.pick(ray)
  }

  // A click or tap. Mouse: opens the plaque under the pointer. Touch: the
  // first tap turns a plaque to face the visitor, a second tap on it opens.
  // Returns whether the tap landed on a plaque.
  tap(ray: THREE.Ray, touch: boolean): boolean {
    const p = this.pick(ray)
    if (!p || !p.link) {
      if (touch) this.armed = null
      return false
    }
    if (touch && this.armed !== p) {
      this.armed = p
      this.hovered = p
      return true
    }
    window.open(p.link.href, '_blank', 'noopener,noreferrer')
    this.armed = null
    return true
  }

  update(frame: Frame): void {
    const dt = frame.dt
    // the turn that makes a plaque face the camera, in rack space
    this.camLocal.copy(frame.camera.position)
    this.object.worldToLocal(this.camLocal)
    for (const p of this.plaques) {
      const facing = Math.atan2(this.camLocal.x - p.pivot.position.x, this.camLocal.z - p.pivot.position.z)
      const active = p === this.hovered || p === this.armed
      p.focus += ((active ? 1 : 0) - p.focus) * Math.min(1, dt * 6)
      const target = p.link ? THREE.MathUtils.lerp(p.rest, facing, p.focus) : p.rest
      // a damped spring on the cord: a turn overshoots a little and settles
      const k = 22
      const c = 7
      p.turnVel += ((target - p.turn) * k - p.turnVel * c) * dt
      p.turn += p.turnVel * dt
      p.phase += dt
      const breeze = frame.motion * (Math.sin(p.phase * 1.3) * 0.05 + Math.sin(p.phase * 2.9) * 0.02)
      p.pivot.rotation.set(Math.sin(p.phase * 1.7) * 0.03 * frame.motion, p.turn + breeze, 0)
      if (p.glow) p.glow.emissiveIntensity = p.focus * 0.12
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
