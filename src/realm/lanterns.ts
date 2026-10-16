import * as THREE from 'three'
import { LANTERNS, groundHeight, TERRACE_FRONT_Z, TERRACE_Y } from './layout'
import { loadPbr } from './assets'
import { weatheredStone } from './materials'
import { lathe, merge, transformed, worldUv } from './geo'
import type { Frame, RealmPart, Tier } from './types'

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

// the fire box: four solid panels and two with openings (front and back),
// built as frames around their windows
function hibukuro(): { stone: THREE.BufferGeometry; paper: THREE.BufferGeometry } {
  const s = H
  const r = 0.165 * s // corner radius of the hexagon
  const h = 0.22 * s
  const apothem = r * Math.cos(Math.PI / 6)
  const side = r
  const stone: THREE.BufferGeometry[] = []
  const paper: THREE.BufferGeometry[] = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const cx = Math.sin(a) * apothem
    const cz = Math.cos(a) * apothem
    const open = i === 0 || i === 3
    const t = 0.03 * s
    if (open) {
      // frame: top and bottom rails and two stiles
      const rail = 0.045 * s
      const stile = 0.04 * s
      for (const [w, hh, oy, ox] of [
        [side, rail, h - rail / 2, 0],
        [side, rail, rail / 2, 0],
        [stile, h, h / 2, -side / 2 + stile / 2],
        [stile, h, h / 2, side / 2 - stile / 2],
      ] as [number, number, number, number][]) {
        const g = new THREE.BoxGeometry(w, hh, t)
        g.translate(ox, oy, 0)
        g.rotateY(a)
        g.translate(cx, 0, cz)
        stone.push(g)
      }
      // paper behind the opening
      const p = new THREE.PlaneGeometry(side - stile * 2, h - rail * 2)
      p.translate(0, h / 2, -t * 0.6)
      p.rotateY(a)
      p.translate(cx, 0, cz)
      paper.push(p)
    } else {
      const g = new THREE.BoxGeometry(side * 1.02, h, t)
      g.translate(0, h / 2, 0)
      g.rotateY(a)
      g.translate(cx, 0, cz)
      stone.push(g)
      // the sun and moon windows on the two side panels nearest the path
      if (i === 1 || i === 4) {
        const disc = new THREE.CircleGeometry(0.045 * s, 24)
        disc.translate(0, h * 0.55, t * 0.52)
        disc.rotateY(a)
        disc.translate(cx, 0, cz)
        paper.push(disc)
      }
    }
  }
  // the inner glow surface, slightly inset
  const core = new THREE.CylinderGeometry(r * 0.72, r * 0.72, h * 0.8, 6, 1, true)
  core.translate(0, h / 2, 0)
  paper.push(core)
  return {
    stone: merge(stone.map((g) => g.toNonIndexed())),
    paper: merge(paper),
  }
}

export interface LanternLight {
  level: number // 0 dark .. 1 fully lit
  target: number
  light: THREE.PointLight
  flicker: number
}

export class Lanterns implements RealmPart {
  readonly object = new THREE.Group()
  readonly lights: LanternLight[] = []
  private paperMat: THREE.MeshStandardMaterial
  private paperMats: THREE.MeshStandardMaterial[] = []
  private disposables: { dispose(): void }[] = []
  private tier: Tier

  static async create(tier: Tier): Promise<Lanterns> {
    const stone = await loadPbr('stone', tier)
    return new Lanterns(tier, stone)
  }

  private constructor(tier: Tier, stone: Awaited<ReturnType<typeof loadPbr>>) {
    this.tier = tier
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
      const knob = new THREE.TorusGeometry(0.022 * H, 0.012 * H, 6, 12, Math.PI * 1.4)
      knob.rotateY(-a + Math.PI / 2)
      knob.translate(Math.sin(a) * 0.335 * H, 1.24 * H + 0.075 * H, Math.cos(a) * 0.335 * H)
      stoneParts.push(knob.toNonIndexed())
      knob.dispose()
    }
    for (const g of stoneParts) g.computeVertexNormals()
    const unit = merge(stoneParts)
    box.stone.dispose()

    const stoneMat = weatheredStone(stone, new THREE.Color(0.11, 0.16, 0.05), { color: new THREE.Color(0.86, 0.85, 0.82) })
    this.paperMat = new THREE.MeshStandardMaterial({
      // dark while unlit, so the windows read as openings in the stone
      color: new THREE.Color(0.07, 0.06, 0.05),
      emissive: new THREE.Color(1.0, 0.55, 0.2),
      emissiveIntensity: 0,
      roughness: 0.9,
      side: THREE.DoubleSide,
    })

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

      const light = new THREE.PointLight(new THREE.Color(1.0, 0.62, 0.32), 0, tier === 'phone' ? 5 : 7, 2)
      light.position.set(l.x, y + 1.15 * H, l.z)
      this.object.add(light)
      this.lights.push({ level: 0, target: 0, light, flicker: rand(i + 7) * 100 })
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
    this.setLit(THREE.MathUtils.clamp((frame.progress - 0.36) / 0.56, 0, 1) * this.lights.length)
    this.lights.forEach((l, i) => {
      // a lantern catches over about a second, then breathes
      l.level += (l.target - l.level) * Math.min(1, frame.dt * 1.6)
      l.flicker += frame.dt * (2.1 + i * 0.13)
      const f = 1 + (Math.sin(l.flicker * 3.1) * 0.04 + Math.sin(l.flicker * 7.7) * 0.03 + Math.sin(l.flicker * 13.3) * 0.02) * frame.motion
      const v = l.level * f
      l.light.intensity = v * (this.tier === 'phone' ? 2.2 : 2.8)
      this.paperMats[i].emissiveIntensity = v * 6
    })
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
