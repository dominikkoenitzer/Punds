import * as THREE from 'three'
import { LANTERNS, groundHeight, TERRACE_FRONT_Z, TERRACE_Y } from './layout'
import { loadPbr } from './assets'
import { weatheredStone } from './materials'
import { lathe, merge, transformed, worldUv } from './geo'
import type { Frame, RealmPart, Tier } from './types'
import { dress } from './season'

// Kasuga lanterns along the approach, proportioned from a measured shrine
// lantern: hexagonal from base to roof except the round, banded pillar, each
// part a separate stone with a hair of offset. They light one by one as the
// visitor walks on and the sun goes down: a flame flickers up behind the
// paper of the fire box and spills a little warm light on the stones.

const H = 2.05 / 1.795 // scale of the measured 1.795 m lantern

// [radius to the hexagon corner, height] profiles, measured lantern scaled
function parts(): { geo: THREE.BufferGeometry; y: number }[] {
  const s = H
  const out: { geo: THREE.BufferGeometry; y: number }[] = []
  // kiso: a low hexagonal plinth with a stepped top
  out.push({
    geo: lathe([[0.0, 0], [0.3, 0], [0.3, 0.13], [0.285, 0.15], [0.22, 0.185], [0.16, 0.2], [0.14, 0.21], [0.0, 0.21]].map(([r, y]) => [r * s, y * s] as [number, number]), 6),
    y: 0,
  })
  // sao: the round pillar with three raised bands
  const sao: [number, number][] = [[0, 0]]
  const bands = [0.0, 0.3, 0.6]
  const len = 0.63
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i] * len
    sao.push([0.15, b], [0.15, b + 0.035], [0.125, b + 0.05])
    const next = i + 1 < bands.length ? bands[i + 1] * len - 0.015 : len - 0.06
    sao.push([0.12, next])
  }
  sao.push([0.15, len - 0.045], [0.15, len], [0, len])
  out.push({ geo: lathe(sao.map(([r, y]) => [r * s, y * s]), 36), y: 0.21 * s })
  // chudai: the platform, flaring out above a lotus collar
  out.push({
    geo: lathe([[0, 0], [0.14, 0], [0.17, 0.03], [0.2, 0.075], [0.235, 0.105], [0.25, 0.115], [0.25, 0.18], [0.0, 0.18]].map(([r, y]) => [r * s, y * s] as [number, number]), 6),
    y: 0.84 * s,
  })
  // kasa: the roof, a thin eave band and a concave slope up to the centre
  out.push({
    geo: lathe(
      [[0, 0], [0.14, 0], [0.3, 0.035], [0.34, 0.04], [0.345, 0.055], [0.34, 0.075], [0.28, 0.09], [0.19, 0.12], [0.11, 0.155], [0.07, 0.17], [0.0, 0.175]].map(
        ([r, y]) => [r * s, y * s] as [number, number],
      ),
      6,
    ),
    y: 1.24 * s,
  })
  // ukebana and hoju: a lotus cup and the pointed jewel
  out.push({
    geo: lathe(
      [[0, 0], [0.06, 0], [0.075, 0.03], [0.07, 0.055], [0.045, 0.065], [0.075, 0.1], [0.085, 0.14], [0.07, 0.19], [0.04, 0.23], [0.015, 0.26], [0.0, 0.275]].map(
        ([r, y]) => [r * s, y * s] as [number, number],
      ),
      32,
    ),
    y: 1.415 * s,
  })
  return out
}

// The fire box: one hexagonal stone, its six faces carved. The front and
// back faces open onto paper, the two side faces nearest the path carry the
// sun (a round window) and the moon (a crescent). The openings are thin
// inset faces that stay dark until the lantern burns.
function hibukuro(): { stone: THREE.BufferGeometry; paper: THREE.BufferGeometry } {
  const s = H
  const r = 0.165 * s // corner radius of the hexagon
  const h = 0.22 * s
  const stone = lathe(
    [
      [0, 0],
      [r * 0.98, 0],
      [r, 0.012 * s],
      [r, h - 0.012 * s],
      [r * 0.98, h],
      [0, h],
    ],
    6,
  )
  const apothem = r * Math.cos(Math.PI / 6)
  const side = r
  const paper: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    let g: THREE.BufferGeometry | null = null
    if (i === 0 || i === 3) {
      // the fire opening: a tall window with a slight arch
      const w = side * 0.58
      const hh = h * 0.66
      const shape = new THREE.Shape()
      shape.moveTo(-w / 2, -hh / 2)
      shape.lineTo(w / 2, -hh / 2)
      shape.lineTo(w / 2, hh / 2 - w * 0.18)
      shape.quadraticCurveTo(0, hh / 2 + w * 0.12, -w / 2, hh / 2 - w * 0.18)
      shape.closePath()
      g = new THREE.ShapeGeometry(shape, 8)
    } else if (i === 1) {
      g = new THREE.CircleGeometry(0.046 * s, 28)
    } else if (i === 4) {
      const R = 0.05 * s
      const shape = new THREE.Shape()
      shape.absarc(0, 0, R, Math.PI * 0.5, Math.PI * 1.5, false)
      shape.absarc(R * 0.45, 0, R * 0.82, Math.PI * 1.38, Math.PI * 0.62, true)
      g = new THREE.ShapeGeometry(shape, 16)
    }
    if (!g) continue
    g.translate(0, h * 0.52, apothem + 0.0015)
    g.rotateY(a)
    paper.push(g)
  }
  return { stone: stone.toNonIndexed(), paper: merge(paper) }
}

export interface LanternLight {
  level: number // 0 dark .. 1 fully lit
  target: number
  flicker: number
}

export class Lanterns implements RealmPart {
  readonly object = new THREE.Group()
  readonly lights: LanternLight[] = []
  private paperMat: THREE.MeshStandardMaterial
  private paperMats: THREE.MeshStandardMaterial[] = []
  // how bright a burning window is
  private glow = 3.2
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Lanterns> {
    const stone = await loadPbr('stone', tier)
    return new Lanterns(stone)
  }

  private constructor(stone: Awaited<ReturnType<typeof loadPbr>>) {
    const box = hibukuro()
    const pieces = parts()
    const stoneParts: THREE.BufferGeometry[] = []
    for (const p of pieces) {
      const g = p.geo
      g.translate(0, p.y, 0)
      stoneParts.push(g.toNonIndexed())
      g.dispose()
    }
    const boxStone = box.stone.clone()
    boxStone.translate(0, 1.02 * H, 0)
    stoneParts.push(boxStone)
    // the warabite: small curled knobs at the six roof corners
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2
      // a rolled stone knob lifting off the corner, not a ring
      const knob = new THREE.SphereGeometry(0.024 * H, 10, 8)
      knob.scale(0.8, 0.75, 1.35)
      knob.rotateX(-0.5)
      knob.rotateY(a)
      knob.translate(Math.sin(a) * 0.335 * H, 1.24 * H + 0.08 * H, Math.cos(a) * 0.335 * H)
      stoneParts.push(knob.toNonIndexed())
      knob.dispose()
    }
    // lotus petals: a ring turned down over the base and one cupping the
    // underside of the platform, each petal a swollen, pointed lobe
    const petalRing = (count: number, radius: number, y: number, tilt: number, size: number) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + Math.PI / count
        const petal = new THREE.SphereGeometry(size, 10, 6)
        petal.scale(0.55, 0.32, 1)
        petal.translate(0, 0, size * 0.6)
        petal.rotateX(tilt)
        petal.rotateY(a)
        petal.translate(Math.sin(a) * radius, y, Math.cos(a) * radius)
        stoneParts.push(petal.toNonIndexed())
        petal.dispose()
      }
    }
    petalRing(12, 0.19 * H, 0.2 * H, 0.55, 0.055 * H)
    petalRing(12, 0.17 * H, 0.87 * H, -0.7, 0.05 * H)
    for (const g of stoneParts) g.computeVertexNormals()
    const unit = merge(stoneParts)
    box.stone.dispose()

    const stoneMat = weatheredStone(stone, new THREE.Color(0.11, 0.16, 0.05), { color: new THREE.Color(0.86, 0.85, 0.82) })
    this.paperMat = new THREE.MeshStandardMaterial({
      // dark while unlit, so the windows read as openings in the stone
      color: new THREE.Color(0.07, 0.06, 0.05),
      emissive: new THREE.Color(1.0, 0.48, 0.16),
      emissiveIntensity: 0,
      roughness: 0.9,
      side: THREE.DoubleSide,
    })
    // under a season's night the flame burns a deeper amber and a little
    // lower, so it stays warm against the red light rather than clipping white
    if (dress()?.light) {
      this.paperMat.emissive.setRGB(1.0, 0.4, 0.09)
      this.glow = 2.3
    }

    const rand = (i: number) => {
      const s = Math.sin(i * 91.7) * 43758.5453
      return s - Math.floor(s)
    }
    LANTERNS.forEach((l, i) => {
      const onTerrace = l.z < TERRACE_FRONT_Z
      const y = onTerrace ? TERRACE_Y : groundHeight(l.x, l.z)
      const g = unit.clone()
      // turn the open panels (at 30 and 210 degrees) to look across the path
      const face = Math.PI / 3
      transformed(g, l.x, y, l.z, 0, face + (rand(i) - 0.5) * 0.06, 0)
      worldUv(g, 0.9, rand(i) * 5, rand(i + 3) * 5)
      const mesh = new THREE.Mesh(g, stoneMat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.object.add(mesh)
      this.disposables.push(g)

      const mat = this.paperMat.clone()
      this.paperMats.push(mat)
      const paperGeo = box.paper.clone()
      transformed(paperGeo, l.x, y + 1.02 * H, l.z, 0, face + (rand(i) - 0.5) * 0.06, 0)
      const paper = new THREE.Mesh(paperGeo, mat)
      this.object.add(paper)
      this.disposables.push(paperGeo, mat)

      // no real light: in daylight a lantern's flame shows only in its paper,
      // and eight point lights would weigh on every shader in the scene
      this.lights.push({ level: 0, target: 0, flicker: rand(i + 7) * 100 })
    })
    unit.dispose()
    box.paper.dispose()
    this.disposables.push(stoneMat, this.paperMat)
  }

  // how many lanterns burn, as a fraction 0..LANTERNS.length; the host
  // derives it from the walk
  setLit(count: number): void {
    this.lights.forEach((l, i) => {
      l.target = THREE.MathUtils.clamp(count - i, 0, 1)
    })
  }

  update(frame: Frame): void {
    // the first lantern catches once the visitor has passed the gate, the
    // last two on the terrace just before the end of the walk
    // at night (a season's dark hour) they all burn
    const night = dress()?.light ? 1 : 0
    this.setLit(Math.max(night, THREE.MathUtils.clamp((frame.progress - 0.36) / 0.56, 0, 1)) * this.lights.length)
    this.lights.forEach((l, i) => {
      // a lantern catches over about a second, then breathes
      l.level += (l.target - l.level) * Math.min(1, frame.dt * 1.6)
      l.flicker += frame.dt * (2.1 + i * 0.13)
      const f = 1 + (Math.sin(l.flicker * 3.1) * 0.04 + Math.sin(l.flicker * 7.7) * 0.03 + Math.sin(l.flicker * 13.3) * 0.02) * frame.motion
      const v = l.level * f
      this.paperMats[i].emissiveIntensity = v * this.glow
    })
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
