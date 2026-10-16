import * as THREE from 'three'
import { TORII_Z, TORII_SPAN } from './layout'
import { loadPbr, type PbrSet } from './assets'
import { paintedMaterial } from './materials'
import { bevelBox, merge, transformed, worldUv } from './geo'
import type { RealmPart, Tier } from './types'

// A wooden myojin torii at the island's front landing, proportioned from a
// measured gate: kasagi and shimaki that lift towards slanted ends, a nuki
// that runs through the pillars and out past them with wedges, a short strut
// between, pillars that lean in a little and stand in black sleeves.

const HEIGHT = 4.55 // top of the kasagi
const PILLAR_D = 0.36
const LEAN = 0.026 // inward lean as a share of the height

// A beam along x whose centre line rises towards the ends by `rise` and whose
// end faces lean outwards by `slant`. The section is a rectangle with small
// chamfers; each of its faces is a separate strip so the edges stay crisp.
function curvedBeam(len: number, h: number, d: number, rise: number, slant: number, chamfer: number): THREE.BufferGeometry {
  const segs = 48
  const c = chamfer
  // section outline in (z, y), counter-clockwise from the bottom front
  const sec: [number, number][] = [
    [d / 2 - c, -h / 2],
    [d / 2, -h / 2 + c],
    [d / 2, h / 2 - c],
    [d / 2 - c, h / 2],
    [-d / 2 + c, h / 2],
    [-d / 2, h / 2 - c],
    [-d / 2, -h / 2 + c],
    [-d / 2 + c, -h / 2],
  ]
  const yAt = (x: number) => {
    const t = Math.abs(x) / (len / 2)
    return rise * Math.pow(t, 3.2)
  }
  const pos: number[] = []
  const index: number[] = []
  const ring = (i: number) => {
    const t = i / segs
    return -len / 2 + t * len
  }
  for (let f = 0; f < sec.length; f++) {
    const a = sec[f]
    const b = sec[(f + 1) % sec.length]
    const base = pos.length / 3
    for (let i = 0; i <= segs; i++) {
      const x = ring(i)
      // the slant: end faces lean out, more at the top than at the bottom
      const endT = i === 0 ? -1 : i === segs ? 1 : 0
      const xa = x + endT * slant * (a[1] / h + 0.5)
      const xb = x + endT * slant * (b[1] / h + 0.5)
      const y = yAt(x)
      pos.push(xa, y + a[1], a[0], xb, y + b[1], b[0])
    }
    for (let i = 0; i < segs; i++) {
      const p = base + i * 2
      index.push(p, p + 2, p + 1, p + 1, p + 2, p + 3)
    }
  }
  // end caps
  for (const end of [0, segs]) {
    const x = ring(end)
    const y = yAt(x)
    const endT = end === 0 ? -1 : 1
    const base = pos.length / 3
    for (const [z, yy] of sec) pos.push(x + endT * slant * (yy / h + 0.5), y + yy, z)
    for (let k = 1; k < sec.length - 1; k++) {
      if (endT > 0) index.push(base, base + k, base + k + 1)
      else index.push(base, base + k + 1, base + k)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setIndex(index)
  const flat = geo.toNonIndexed()
  geo.dispose()
  flat.computeVertexNormals()
  return flat
}

function pillar(side: -1 | 1, top: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(PILLAR_D * 0.46, PILLAR_D * 0.5, top, 40, 8)
  geo.translate(0, top / 2, 0)
  // lean the top inwards
  const p = geo.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    p.setX(i, p.getX(i) - side * LEAN * y)
  }
  geo.computeVertexNormals()
  return transformed(geo, (side * TORII_SPAN) / 2, 0, TORII_Z)
}

export class Torii implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Torii> {
    const [paint, stone] = await Promise.all([loadPbr('painted_wood', tier), loadPbr('stone', tier)])
    return new Torii(paint, stone)
  }

  private constructor(paint: PbrSet, stone: PbrSet) {
    const kasagiH = 0.27
    const shimakiH = 0.21
    const kasagiY = HEIGHT - kasagiH / 2
    const shimakiY = HEIGHT - kasagiH - shimakiH / 2 + 0.005
    const nukiY = HEIGHT - 0.98
    const pillarTop = HEIGHT - kasagiH - shimakiH + 0.02

    const red: THREE.BufferGeometry[] = []
    const black: THREE.BufferGeometry[] = []

    red.push(pillar(-1, pillarTop), pillar(1, pillarTop))

    const shimaki = curvedBeam(TORII_SPAN + 1.75, shimakiH, 0.3, 0.12, 0.05, 0.012)
    red.push(transformed(shimaki, 0, shimakiY, TORII_Z))
    const kasagi = curvedBeam(TORII_SPAN + 2.25, kasagiH - 0.05, 0.36, 0.17, 0.09, 0.014)
    red.push(transformed(kasagi, 0, kasagiY - 0.025, TORII_Z))
    // the black cap on the kasagi follows the same curve
    const cap = curvedBeam(TORII_SPAN + 2.3, 0.06, 0.4, 0.17, 0.1, 0.01)
    black.push(transformed(cap, 0, HEIGHT - 0.03, TORII_Z))

    // nuki through the pillars, out past them
    const nukiLen = TORII_SPAN + PILLAR_D + 0.72
    red.push(transformed(bevelBox(nukiLen, 0.2, 0.13, 0.012, 2), 0, nukiY, TORII_Z))
    // wedges on the outer faces of the pillars
    for (const side of [-1, 1]) {
      const wx = side * (TORII_SPAN / 2 - LEAN * nukiY + PILLAR_D * 0.5 + 0.035)
      red.push(transformed(bevelBox(0.07, 0.24, 0.17, 0.008, 1), wx, nukiY, TORII_Z))
    }
    // the strut between nuki and shimaki
    const strutH = shimakiY - shimakiH / 2 - (nukiY + 0.1)
    red.push(transformed(bevelBox(0.22, strutH, 0.14, 0.01, 2), 0, nukiY + 0.1 + strutH / 2, TORII_Z))

    // black sleeves at the pillar feet
    for (const side of [-1, 1]) {
      const sleeve = new THREE.CylinderGeometry(PILLAR_D * 0.56, PILLAR_D * 0.58, 0.62, 40, 1)
      black.push(transformed(sleeve, (side * TORII_SPAN) / 2 - side * LEAN * 0.31, 0.31 + 0.12, TORII_Z))
      const ring = new THREE.TorusGeometry(PILLAR_D * 0.56, 0.018, 8, 40)
      black.push(transformed(ring, (side * TORII_SPAN) / 2 - side * LEAN * 0.62, 0.74, TORII_Z, Math.PI / 2))
    }

    const redGeo = merge(red.map((g) => worldUv(g, 1.6)))
    const vermilion = new THREE.Color('#c9462a').convertSRGBToLinear()
    const redMat = paintedMaterial(paint, vermilion, { roughness: 0.82, metalness: 0 })
    redMat.metalnessMap = null
    const redMesh = new THREE.Mesh(redGeo, redMat)

    const blackGeo = merge(black.map((g) => worldUv(g, 1.6)))
    const blackMat = paintedMaterial(paint, new THREE.Color(0.018, 0.016, 0.015), { roughness: 0.55, metalness: 0 })
    blackMat.metalnessMap = null
    const blackMesh = new THREE.Mesh(blackGeo, blackMat)

    // rounded stone plinths
    const plinths: THREE.BufferGeometry[] = []
    for (const side of [-1, 1]) {
      const g = new THREE.CylinderGeometry(PILLAR_D * 0.9, PILLAR_D * 1.05, 0.16, 40, 2)
      plinths.push(transformed(g, (side * TORII_SPAN) / 2, 0.08 + 0.035, TORII_Z))
    }
    const plinthGeo = merge(plinths.map((g) => worldUv(g, 1.0)))
    const plinthMat = new THREE.MeshStandardMaterial({
      map: stone.map,
      normalMap: stone.normalMap,
      roughnessMap: stone.arm,
      aoMap: stone.arm,
      roughness: 1,
      metalness: 0,
      color: new THREE.Color(0.8, 0.8, 0.78),
    })
    const plinthMesh = new THREE.Mesh(plinthGeo, plinthMat)

    for (const m of [redMesh, blackMesh, plinthMesh]) {
      m.castShadow = true
      m.receiveShadow = true
      this.object.add(m)
    }
    this.disposables.push(redGeo, redMat, blackGeo, blackMat, plinthGeo, plinthMat)
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
