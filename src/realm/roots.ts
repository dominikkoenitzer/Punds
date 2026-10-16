import * as THREE from 'three'
import { loadPbr, type PbrSet } from './assets'
import { realmUniforms, WIND_GLSL } from './atmosphere'
import { CHERRY, MAPLES, OUTFLOW, rng } from './layout'
import { rimTopPoint, undersideFraction, undersidePoint } from './terrain'
import type { RealmPart, Tier } from './types'

// Roots and hanging moss at the island's edge. Roots come out of the soil,
// bend over the lip and hang down: straight under their own weight where the
// rock falls away beneath them, draped over it where a ledge stands out, a
// few long enough to reach far down the stone. Thin strands of moss hang in
// curtains from the blocks of the lip. Both sway a little in the wind, more
// the further they hang from where they hold.

const TAU = Math.PI * 2
const FALL_ANGLE = Math.atan2(OUTFLOW.z1, OUTFLOW.x1)

interface Strand {
  curve: THREE.CatmullRomCurve3
  a: number // bearing, for the frame around the strand
  r0: number // radius at the root, metres
  hold: number // arc length at which it leaves the soil and starts to hang
}

const P = new THREE.Vector3()
const Q = new THREE.Vector3()

function angleDist(a: number, b: number): number {
  const d = (((a - b) % TAU) + TAU) % TAU
  return Math.min(d, TAU - d)
}

// Hangs a strand from `pts` (whose last point is the hold) for `length`
// metres. Each step it falls straight, unless the rock below stands out
// further than it hangs; `hug` (per metre) draws it back onto the face.
function hangDown(pts: THREE.Vector3[], a: number, length: number, hug: number, clearance: number, wander: number, seed: number): void {
  const start = pts[pts.length - 1]
  if (!start) return
  const step = 0.3
  let hang = Math.hypot(start.x, start.z)
  for (let y = start.y - step, fallen = step; fallen <= length; y -= step, fallen += step) {
    const b = a + (Math.sin(fallen * 0.7 + seed) * 0.6 + Math.sin(fallen * 1.9 + seed * 3.1) * 0.4) * wander
    undersidePoint(b, undersideFraction(b, y), P)
    const face = Math.max(Math.hypot(P.x, P.z), 1e-3) + clearance
    hang = Math.max(face, hang + (face - hang) * Math.min(1, hug * step))
    const s = hang / Math.max(Math.hypot(P.x, P.z), 1e-3)
    pts.push(new THREE.Vector3(P.x * s, y, P.z * s))
  }
}

function addTube(
  strand: Strand,
  sides: number,
  perMetre: number,
  out: { pos: number[]; nor: number[]; uv: number[]; hang: number[]; index: number[] },
): void {
  const length = strand.curve.getLength()
  const segs = Math.max(4, Math.min(48, Math.ceil(length * perMetre)))
  const pts = strand.curve.getSpacedPoints(segs)
  const tang = new THREE.Vector3(-Math.sin(strand.a), 0, Math.cos(strand.a))
  const T = new THREE.Vector3()
  const N = new THREE.Vector3()
  const B = new THREE.Vector3()
  const base = out.pos.length / 3
  for (let i = 0; i <= segs; i++) {
    const p = pts[i]
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(segs, i + 1)]
    if (!p || !prev || !next) continue
    T.subVectors(next, prev).normalize()
    N.copy(tang).addScaledVector(T, -tang.dot(T)).normalize()
    B.crossVectors(T, N)
    const u = i / segs
    const s = u * length
    // thins to a hair at the tip, with a few knots along the way
    const r = (strand.r0 * Math.pow(1 - u, 0.85) + 0.0025) * (1 + 0.12 * Math.sin(s * 3.1 + strand.a * 40))
    for (let j = 0; j <= sides; j++) {
      const t = (j / sides) * TAU
      const cx = Math.cos(t)
      const cy = Math.sin(t)
      const nx = N.x * cx + B.x * cy
      const ny = N.y * cx + B.y * cy
      const nz = N.z * cx + B.z * cy
      out.pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r)
      out.nor.push(nx, ny, nz)
      out.uv.push(j / sides, s / 0.45)
      out.hang.push(Math.max(0, s - strand.hold))
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j
      const b = a + sides + 1
      out.index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
}

function buildGeometry(strands: Strand[], sides: number, perMetre: number): THREE.BufferGeometry {
  const out = { pos: [] as number[], nor: [] as number[], uv: [] as number[], hang: [] as number[], index: [] as number[] }
  for (const s of strands) addTube(s, sides, perMetre, out)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2))
  geo.setAttribute('aHang', new THREE.Float32BufferAttribute(out.hang, 1))
  geo.setIndex(out.index)
  return geo
}

// a bearing on the rim away from the waterfall
function bearing(rand: () => number, around: number | null, spread: number): number {
  for (let tries = 0; tries < 12; tries++) {
    const a = around === null ? rand() * TAU : around + (rand() - 0.5) * 2 * spread
    if (angleDist(a, FALL_ANGLE) > 0.14) return a
  }
  return FALL_ANGLE + Math.PI
}

function makeRoots(tier: Tier): Strand[] {
  const rand = rng(4711)
  const phone = tier === 'phone'
  const strands: Strand[] = []
  // roots gather in clumps where something grows near the edge, thickest
  // on the side of each tree
  const trees = [CHERRY, ...MAPLES].map((t) => Math.atan2(t.z, t.x))
  const clumps = [...trees, ...Array.from({ length: phone ? 8 : 17 }, () => bearing(rand, null, 0))]
  const count = phone ? 56 : 160
  for (let i = 0; i < count; i++) {
    const clump = clumps[i % clumps.length] ?? 0
    const a = rand() < 0.8 ? bearing(rand, clump, 0.09) : bearing(rand, null, 0)
    const long = rand() < (i % clumps.length < trees.length ? 0.3 : 0.08)
    const length = long ? 4.5 + rand() * 7 : 0.4 + Math.pow(rand(), 2.2) * 3.2
    const r0 = long ? 0.05 + rand() * 0.04 : 0.02 + rand() * 0.045
    const pts: THREE.Vector3[] = []
    // out of the soil a little way in, over the rounded lip
    rimTopPoint(a, 0.968 + rand() * 0.012, P)
    pts.push(P.clone().setY(P.y - r0 * 0.6))
    rimTopPoint(a, 0.996, P)
    pts.push(P.clone().setY(P.y + r0 * 0.5))
    undersidePoint(a, 0, Q)
    const out = 1 + (0.04 + rand() * 0.18) / Math.max(Math.hypot(Q.x, Q.z), 1)
    pts.push(new THREE.Vector3(Q.x * out, Q.y - 0.08, Q.z * out))
    const hold = pts[0] && pts[1] ? pts[0].distanceTo(pts[1]) + 0.1 : 0.3
    const hug = rand() < 0.6 ? 0.8 + rand() * 1.5 : 0
    hangDown(pts, a, length, hug, r0 + 0.015, 0.0015 + rand() * 0.003, rand() * 100)
    if (pts.length < 4) continue
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    strands.push({ curve, a, r0, hold })
    // a thinner rootlet splits off partway down
    for (let n = phone ? 1 : 2; n > 0; n--) {
      if (rand() > (phone ? 0.3 : 0.55) || length < 0.8) continue
      curve.getPointAt(0.25 + rand() * 0.35, Q)
      const side = (rand() - 0.5) * 0.08
      const b = a + side
      const sub = [Q.clone()]
      const k = 1 + (0.05 + rand() * 0.12) / Math.max(Math.hypot(Q.x, Q.z), 1)
      sub.push(new THREE.Vector3(Q.x * k, Q.y - 0.12, Q.z * k).applyAxisAngle(new THREE.Vector3(0, 1, 0), -side * 0.5))
      hangDown(sub, b, 0.3 + rand() * 1.4, hug * 0.5, 0.02, 0.01, rand() * 100)
      if (sub.length >= 4) strands.push({ curve: new THREE.CatmullRomCurve3(sub, false, 'centripetal'), a: b, r0: r0 * 0.45, hold: 0 })
    }
  }
  return strands
}

function makeMoss(tier: Tier): Strand[] {
  const rand = rng(90210)
  const phone = tier === 'phone'
  const strands: Strand[] = []
  const curtains = phone ? 7 : 16
  for (let c = 0; c < curtains; c++) {
    const centre = bearing(rand, null, 0)
    const n = phone ? 6 : 12
    for (let i = 0; i < n; i++) {
      const a = bearing(rand, centre, 0.035)
      const length = 0.25 + Math.pow(rand(), 1.8) * 1.6
      undersidePoint(a, 0.004 + rand() * 0.01, Q)
      const pts = [Q.clone()]
      const out = 1 + 0.03 / Math.max(Math.hypot(Q.x, Q.z), 1)
      pts.push(new THREE.Vector3(Q.x * out, Q.y - 0.06, Q.z * out))
      hangDown(pts, a, length, 0, 0.02, 0.002, rand() * 100)
      if (pts.length < 3) continue
      strands.push({ curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), a, r0: 0.012 + rand() * 0.012, hold: 0 })
    }
  }
  return strands
}

const SWAY_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uGust;
uniform float uSway;
attribute float aHang;
${WIND_GLSL}
`

function patchSway(mat: THREE.MeshStandardMaterial, sway: number, key: string): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = realmUniforms.uTime
    shader.uniforms.uWind = realmUniforms.uWind
    shader.uniforms.uGust = realmUniforms.uGust
    shader.uniforms.uSway = { value: sway }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${SWAY_PARS}`).replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        // the free length swings; a stiff root barely, moss more
        vec3 w = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float free = aHang * aHang / (1.0 + aHang);
        transformed += windSway(w, 1.0) * uSway * free;
      }`,
    )
    // they hang against the rock, which hides half the sky from them
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <aomap_fragment>',
      `#include <aomap_fragment>
      reflectedLight.indirectDiffuse *= 0.6;
      reflectedLight.indirectSpecular *= 0.3;`,
    )
  }
  mat.customProgramCacheKey = () => key
}

export class Roots implements RealmPart {
  readonly object = new THREE.Group()
  private geometries: THREE.BufferGeometry[] = []
  private materials: THREE.Material[] = []

  static async create(tier: Tier): Promise<Roots> {
    const [bark, moss] = await Promise.all([loadPbr('maple_bark', tier), loadPbr('moss', tier)])
    return new Roots(tier, bark, moss)
  }

  private constructor(tier: Tier, bark: PbrSet, moss: PbrSet) {
    const phone = tier === 'phone'
    const rootGeo = buildGeometry(makeRoots(tier), phone ? 4 : 6, phone ? 2.5 : 4)
    const rootMat = new THREE.MeshStandardMaterial({
      map: bark.map,
      normalMap: bark.normalMap,
      roughnessMap: bark.arm,
      color: new THREE.Color(1.0, 0.8, 0.62),
      roughness: 1,
      metalness: 0,
    })
    patchSway(rootMat, 0.02, 'realm-roots')
    const roots = new THREE.Mesh(rootGeo, rootMat)
    roots.name = 'roots'
    roots.receiveShadow = true
    // they move, so they stay out of the static shadow map
    roots.castShadow = false

    const mossGeo = buildGeometry(makeMoss(tier), phone ? 3 : 4, phone ? 3 : 5)
    const mossMat = new THREE.MeshStandardMaterial({
      map: moss.map,
      color: new THREE.Color(0.4, 0.46, 0.3),
      roughness: 1,
      metalness: 0,
    })
    patchSway(mossMat, 0.09, 'realm-roots-moss')
    const curtains = new THREE.Mesh(mossGeo, mossMat)
    curtains.name = 'moss-curtains'
    curtains.receiveShadow = true
    curtains.castShadow = false

    this.object.add(roots, curtains)
    this.geometries.push(rootGeo, mossGeo)
    this.materials.push(rootMat, mossMat)
  }

  update(): void {}

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
  }
}
