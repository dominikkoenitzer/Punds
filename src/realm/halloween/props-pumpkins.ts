import * as THREE from 'three'
import { lawnWeight, rng } from '../layout'
import { realmUniforms } from '../atmosphere'
import type { Frame, RealmPart, Tier } from '../types'
import { PUMPKINS, surfaceY, type PumpkinSpot } from './props-place'

// Carved pumpkins with a candle inside. Each shell is a ribbed, slightly
// lopsided body with a twisted stem; the face is cut clean through it, so the
// cut walls show the thickness of the skin and the pale flesh, and the
// candle's light comes out through the cuts and glows through the skin near
// them. All of them are one mesh with one program; the candle breathes in the
// shader. Their light on the ground is a painted pool, not a light, so no
// other program in the garden changes.

// the candle's colour, linear
const CANDLE = new THREE.Color(1.0, 0.5, 0.15)

const seedOf = (i: number) => 0.07 + i * 0.131

// the candle's breath and colour, for a program that declares uTime and
// uMotion itself
const CANDLE_FN = /* glsl */ `
float pkHash1(float n) { return fract(sin(n) * 43758.5453); }
float pkNoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(pkHash1(i), pkHash1(i + 1.0), f);
}
// a candle's breath: slow swells and a faint quicker shiver, still under
// reduced motion
float candle(float seed) {
  float t = uTime + seed * 61.0;
  float n = pkNoise1(t * 1.1) * 0.55 + pkNoise1(t * 2.9 + 7.0) * 0.3 + pkNoise1(t * 7.3 + 3.0) * 0.15;
  return 1.0 + (n - 0.5) * 0.36 * uMotion;
}
const vec3 CANDLE = vec3(${CANDLE.r.toFixed(3)}, ${CANDLE.g.toFixed(3)}, ${CANDLE.b.toFixed(3)});
`

// shared by the shells, the pools and the hand at the graves
export const CANDLE_GLSL = /* glsl */ `
uniform float uTime;
uniform float uMotion;
${CANDLE_FN}`

export const candleUniforms = {
  uTime: realmUniforms.uTime,
  uMotion: { value: 1 },
}

// --- the candles' light on the lawn ------------------------------------------------

// What the lawn takes from the candles: each blade near a pumpkin is lit by
// its flame, per vertex, so the pool of light climbs the blades instead of
// lying flat under them. The same breath as the painted pool.
export interface GrassDress {
  uniforms: Record<string, THREE.IUniform>
  vertexPars: string
  vertex: string
  fragmentPars: string
  fragment: string
}

const POOL_SLOTS = 7

const grassUniforms = {
  uPools: { value: PUMPKINS.map((p) => new THREE.Vector4(p.x, surfaceY(p.x, p.z) + 0.13, p.z, p.r * 6)) },
  uPoolSeeds: { value: PUMPKINS.map((_, i) => seedOf(i)) },
  uMotion: candleUniforms.uMotion,
}

export const grass: GrassDress = {
  uniforms: grassUniforms,
  vertexPars: /* glsl */ `
uniform vec4 uPools[${POOL_SLOTS}];
uniform float uPoolSeeds[${POOL_SLOTS}];
uniform float uMotion;
varying vec3 vCandle;
${CANDLE_FN}`,
  vertex: /* glsl */ `
vCandle = vec3(0.0);
for (int i = 0; i < ${POOL_SLOTS}; i++) {
  vec4 pl = uPools[i];
  if (pl.w <= 0.0) continue;
  vec3 l = pl.xyz - grassWorld;
  float d2 = dot(l, l);
  float r2 = pl.w * pl.w;
  if (d2 > r2) continue;
  float fall = 1.0 - d2 / r2;
  fall *= fall * (0.3 + 0.7 * exp(-d2 / r2 * 5.0));
  vCandle += CANDLE * vec3(1.0, 0.8, 0.65) * fall * candle(uPoolSeeds[i]) * 1.1;
}`,
  fragmentPars: 'varying vec3 vCandle;',
  fragment: 'outgoingLight += vCandle * diffuseColor.rgb;',
}

// --- the face ------------------------------------------------------------------

type P2 = [number, number]

// signed distance to a polygon, < 0 inside
function sdPoly(px: number, py: number, v: readonly P2[]): number {
  let d = (px - v[0][0]) ** 2 + (py - v[0][1]) ** 2
  let s = 1
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const ex = v[j][0] - v[i][0]
    const ey = v[j][1] - v[i][1]
    const wx = px - v[i][0]
    const wy = py - v[i][1]
    const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
    const bx = wx - ex * h
    const by = wy - ey * h
    d = Math.min(d, bx * bx + by * by)
    const c1 = py >= v[i][1]
    const c2 = py < v[j][1]
    const c3 = ex * wy > ey * wx
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
  }
  return s * Math.sqrt(d)
}

const mirror = (p: readonly P2[]): P2[] => p.map(([x, y]) => [-x, y] as P2).reverse()

function curve(n: number, f: (u: number) => P2): P2[] {
  const out: P2[] = []
  for (let i = 0; i <= n; i++) out.push(f(i / n))
  return out
}

// A face in units of the pumpkin's radius: s across (to the viewer's right),
// t up from the face's middle. Each is a union of cut-outs, minus the teeth.
interface Face {
  cuts: P2[][]
  keep: P2[][]
}

function faces(): Face[] {
  // kind but uneasy: eyes tilted down to the nose, a small crooked mouth
  const eyeA: P2[] = [[-0.5, 0.06], [-0.15, 0.13], [-0.19, 0.22], [-0.31, 0.32], [-0.45, 0.25]]
  const mouthA: P2[] = [
    ...curve(14, (u) => { const s = -0.5 + u; return [s, -0.15 - 0.2 * (1 - (s / 0.5) ** 2) + s * 0.03] as P2 }),
    ...curve(14, (u) => { const s = 0.5 - u; return [s, -0.13 - 0.08 * (1 - (s / 0.5) ** 2) + s * 0.03] as P2 }),
  ]
  const toothA: P2[] = [[0.08, -0.17], [0.18, -0.17], [0.17, -0.26], [0.09, -0.27]]
  const toothA2: P2[] = [[-0.24, -0.36], [-0.14, -0.38], [-0.15, -0.27], [-0.23, -0.25]]
  // drowsy: half-moon eyes with flat lids, a long thin wavering mouth
  const halfMoon = (cx: number, cy: number, r: number, tilt: number): P2[] =>
    curve(16, (u) => {
      const a = Math.PI + u * Math.PI
      const x = Math.cos(a) * r
      const y = Math.sin(a) * r * 0.85
      return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)] as P2
    })
  const mouthB: P2[] = [
    ...curve(20, (u) => { const s = -0.46 + u * 0.92; const w = 0.035 * Math.sin(u * Math.PI); return [s, -0.2 + 0.035 * Math.sin(s * 9) - w - 0.01] as P2 }),
    ...curve(20, (u) => { const s = 0.46 - u * 0.92; const w = 0.035 * Math.sin((1 - u) * Math.PI); return [s, -0.2 + 0.035 * Math.sin(s * 9) + w] as P2 }),
  ]
  // an old pumpkin's: upright triangle eyes, a small nose, three teeth
  const eyeC: P2[] = [[-0.47, 0.08], [-0.14, 0.09], [-0.29, 0.36]]
  const noseC: P2[] = [[-0.06, -0.06], [0.06, -0.06], [0.0, 0.06]]
  const mouthC: P2[] = [
    ...curve(14, (u) => { const s = -0.54 + u * 1.08; return [s, -0.12 - 0.26 * (1 - (s / 0.54) ** 2)] as P2 }),
    ...curve(14, (u) => { const s = 0.54 - u * 1.08; return [s, -0.1 - 0.12 * (1 - (s / 0.54) ** 2)] as P2 }),
  ]
  const toothC = (s: number, top: boolean): P2[] => {
    const y = top ? -0.1 - 0.12 * (1 - (s / 0.54) ** 2) : -0.12 - 0.26 * (1 - (s / 0.54) ** 2)
    const d = top ? -0.085 : 0.085
    return [[s - 0.045, y - d * 0.3], [s + 0.045, y - d * 0.3], [s + 0.04, y + d], [s - 0.04, y + d]]
  }
  return [
    { cuts: [eyeA, mirror(eyeA), mouthA], keep: [toothA, toothA2] },
    { cuts: [halfMoon(-0.3, 0.24, 0.15, 0.12), halfMoon(0.3, 0.24, 0.15, -0.12), mouthB], keep: [] },
    { cuts: [eyeC, mirror(eyeC), noseC, mouthC], keep: [toothC(-0.2, true), toothC(0.19, true), toothC(0.02, false)] },
  ]
}

function faceSdf(face: Face, s: number, t: number): number {
  let d = Infinity
  for (const c of face.cuts) d = Math.min(d, sdPoly(s, t, c))
  for (const k of face.keep) d = Math.max(d, -sdPoly(s, t, k))
  return d
}

// --- one pumpkin -------------------------------------------------------------------

// vertex streams of the merged mesh; aPk: region (0 skin, 1 cut wall, 2 inside,
// 3 flame, 4 stem, 5 wax), a value per region (rib phase, wall depth, height),
// nearness to a cut, and the pumpkin's seed
class Streams {
  pos: number[] = []
  nor: number[] = []
  pk: number[] = []
  idx: number[] = []
  get count(): number {
    return this.pos.length / 3
  }
  vert(p: THREE.Vector3, n: THREE.Vector3, region: number, a: number, cut: number, seed: number): number {
    this.pos.push(p.x, p.y, p.z)
    this.nor.push(n.x, n.y, n.z)
    this.pk.push(region, a, cut, seed)
    return this.count - 1
  }
  // copy an indexed three geometry in, as one region
  geometry(g: THREE.BufferGeometry, region: number, seed: number, value: (p: THREE.Vector3) => number): void {
    const base = this.count
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const v = new THREE.Vector3()
    const w = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
      w.fromBufferAttribute(n, i)
      this.vert(v, w, region, value(v), 0, seed)
    }
    const index = g.getIndex()
    if (index) for (let i = 0; i < index.count; i++) this.idx.push(base + index.getX(i))
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i)
  }
  // move the vertices from `from` on by a matrix
  transform(from: number, m: THREE.Matrix4): void {
    const nm = new THREE.Matrix3().getNormalMatrix(m)
    const v = new THREE.Vector3()
    for (let i = from; i < this.count; i++) {
      v.fromArray(this.pos, i * 3).applyMatrix4(m).toArray(this.pos, i * 3)
      v.fromArray(this.nor, i * 3).applyMatrix3(nm).normalize().toArray(this.nor, i * 3)
    }
  }
}

interface Shape {
  R: number
  H: number
  ribs: number
  ribDepth: number
  lean: [number, number]
  seed: number
  face: Face
  thick: number
}

// the grid's spacing crowds the face: dense around phi 0 and the equator
const warp = (u: number, a: number) => u * (a + (1 - a) * u * u)

// returns the height of the lowest point of the shell
function buildPumpkin(out: Streams, shape: Shape, fine: boolean): number {
  const { R, H, ribs, ribDepth, lean, seed, face, thick } = shape
  const rand = rng(Math.floor(seed * 1e5))
  const ribVar = Array.from({ length: ribs }, () => (rand() - 0.5) * 2)
  const fullSide = rand() * Math.PI * 2
  const nOff = rand() * 50
  const N = fine ? 168 : 112
  const M = fine ? 96 : 64

  // the smooth body without ribs: radius and height by latitude
  const rho0 = (th: number) => R * Math.pow(Math.max(Math.sin(th), 0), 0.8)
  const y0 = (th: number) => {
    const c = Math.cos(th)
    return H / 2 + (H / 2) * Math.sign(c) * Math.pow(Math.abs(c), 0.9) - 0.16 * H * Math.exp(-((th / 0.42) ** 2)) + 0.06 * H * Math.exp(-(((Math.PI - th) / 0.5) ** 2))
  }
  const ribAt = (ph: number) => {
    const g = Math.abs(Math.sin((ribs * ph) / 2))
    return Math.pow(g, 0.55)
  }
  const ribIndex = (ph: number) => ((Math.floor(((ph + Math.PI) * ribs) / (Math.PI * 2)) % ribs) + ribs) % ribs
  const point = (ph: number, th: number, target: THREE.Vector3) => {
    const st = Math.max(Math.sin(th), 0)
    const lobe = ribAt(ph)
    const amp = ribDepth * Math.pow(st, 0.7)
    const n = (Math.sin(ph * 3 + nOff) * Math.sin(th * 4 + nOff * 0.7) + Math.sin(ph * 7 - nOff) * Math.sin(th * 6) * 0.4) * 0.018
    let rho = rho0(th) * (1 - amp * (1 - lobe)) * (1 + ribVar[ribIndex(ph)] * 0.035 * st + n) * (1 + 0.05 * Math.cos(ph - fullSide))
    // a lobe bulges a little more at its middle than a sphere would
    rho *= 1 + 0.025 * lobe * st
    let y = y0(th) + n * H * 0.4
    y += (1 - lobe) * Math.exp(-((th / 0.6) ** 2)) * H * 0.04
    const k = (y / H) ** 2
    target.set(rho * Math.sin(ph) + lean[0] * k * H, y, rho * Math.cos(ph) + lean[1] * k * H)
    return target
  }
  // the face reads in radius units on the smooth body
  const yFace = y0(Math.PI / 2) * 1.04
  const mask = (ph: number, th: number) => faceSdf(face, (ph * rho0(th)) / R, (y0(th) - yFace) / R)

  const phis: number[] = []
  const thetas: number[] = []
  for (let j = 0; j <= N; j++) phis.push(Math.PI * warp(-1 + (2 * j) / N, 0.4))
  for (let k = 0; k <= M; k++) thetas.push(Math.PI / 2 + (Math.PI / 2) * warp(-1 + (2 * k) / M, 0.45))
  const W = N + 1
  const hole = new Uint8Array(N * M)
  for (let j = 0; j < N; j++) {
    for (let k = 0; k < M; k++) {
      const ph = (phis[j] + phis[j + 1]) / 2
      const th = (thetas[k] + thetas[k + 1]) / 2
      if (Math.abs(ph) < 1.3 && th > 0.7 && th < 2.5 && mask(ph, th) < 0) hole[j * M + k] = 1
    }
  }
  const isHole = (j: number, k: number) => j >= 0 && j < N && k >= 0 && k < M && hole[j * M + k] === 1
  // grid parameters, the boundary ones snapped onto the cut's outline
  const gp = new Float32Array(W * (M + 1) * 2)
  for (let j = 0; j <= N; j++) {
    for (let k = 0; k <= M; k++) {
      let ph = phis[j]
      let th = thetas[k]
      const around = [isHole(j - 1, k - 1), isHole(j, k - 1), isHole(j - 1, k), isHole(j, k)]
      const holes = around.filter(Boolean).length
      if (holes > 0 && holes < 4) {
        const cell = Math.min(phis[Math.min(j + 1, N)] - phis[Math.max(j - 1, 0)], thetas[Math.min(k + 1, M)] - thetas[Math.max(k - 1, 0)]) * 0.5
        const ph0 = ph
        const th0 = th
        for (let it = 0; it < 5; it++) {
          const e = 1e-4
          const m = mask(ph, th)
          const gx = (mask(ph + e, th) - mask(ph - e, th)) / (2 * e)
          const gy = (mask(ph, th + e) - mask(ph, th - e)) / (2 * e)
          const g2 = gx * gx + gy * gy
          if (g2 < 1e-10) break
          ph -= (m * gx) / g2
          th -= (m * gy) / g2
        }
        const d = Math.hypot(ph - ph0, th - th0)
        if (d > cell * 0.75) {
          ph = ph0 + ((ph - ph0) * cell * 0.75) / d
          th = th0 + ((th - th0) * cell * 0.75) / d
        }
      }
      gp[(j * (M + 1) + k) * 2] = ph
      gp[(j * (M + 1) + k) * 2 + 1] = th
    }
  }
  const at = (j: number, k: number) => (j * (M + 1) + k) * 2

  // the outer skin as its own geometry first, for its normals
  const skinPos = new Float32Array(W * (M + 1) * 3)
  const v = new THREE.Vector3()
  for (let j = 0; j <= N; j++) {
    for (let k = 0; k <= M; k++) {
      point(gp[at(j, k)], gp[at(j, k) + 1], v)
      v.toArray(skinPos, (j * (M + 1) + k) * 3)
    }
  }
  const skinIdx: number[] = []
  for (let j = 0; j < N; j++) {
    for (let k = 0; k < M; k++) {
      if (isHole(j, k)) continue
      const a = j * (M + 1) + k
      const b = (j + 1) * (M + 1) + k
      skinIdx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const skin = new THREE.BufferGeometry()
  skin.setAttribute('position', new THREE.BufferAttribute(skinPos, 3))
  skin.setIndex(skinIdx)
  skin.computeVertexNormals()
  // the seam columns share their normals
  const sn = skin.getAttribute('normal') as THREE.BufferAttribute
  for (let k = 0; k <= M; k++) {
    const a = k
    const b = N * (M + 1) + k
    const nx = sn.getX(a) + sn.getX(b)
    const ny = sn.getY(a) + sn.getY(b)
    const nz = sn.getZ(a) + sn.getZ(b)
    const l = Math.hypot(nx, ny, nz) || 1
    sn.setXYZ(a, nx / l, ny / l, nz / l)
    sn.setXYZ(b, nx / l, ny / l, nz / l)
  }
  const base = out.count
  const n = new THREE.Vector3()
  for (let j = 0; j <= N; j++) {
    for (let k = 0; k <= M; k++) {
      const i = j * (M + 1) + k
      const ph = gp[at(j, k)]
      const th = gp[at(j, k) + 1]
      v.fromArray(skinPos, i * 3)
      n.fromBufferAttribute(sn, i)
      const dist = Math.abs(ph) < 1.4 ? Math.max(0, mask(ph, th)) * R : 1
      out.vert(v, n, 0, ribAt(ph), Math.exp(-dist / 0.016), seed)
    }
  }
  for (const i of skinIdx) out.idx.push(base + i)

  // the cut walls, from the skin straight in by the shell's thickness
  const inner = (i: number, target: THREE.Vector3) => {
    target.fromArray(skinPos, i * 3)
    n.fromBufferAttribute(sn, i)
    return target.addScaledVector(n, -thick)
  }
  const a0 = new THREE.Vector3()
  const b0 = new THREE.Vector3()
  const a1 = new THREE.Vector3()
  const b1 = new THREE.Vector3()
  const wn = new THREE.Vector3()
  const into = new THREE.Vector3()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const wall = (ia: number, ib: number, holeJ: number, holeK: number) => {
    a0.fromArray(skinPos, ia * 3)
    b0.fromArray(skinPos, ib * 3)
    // the hole's middle, to face the wall into it
    const hc = holeJ * (M + 1) + holeK
    into.fromArray(skinPos, hc * 3).add(v.fromArray(skinPos, (hc + M + 2) * 3)).multiplyScalar(0.5).sub(a0).sub(b0.clone().sub(a0).multiplyScalar(0.5))
    inner(ia, a1)
    inner(ib, b1)
    e1.subVectors(b0, a0)
    e2.subVectors(a1, a0)
    wn.crossVectors(e1, e2)
    if (wn.dot(into) < 0) {
      ;[ia, ib] = [ib, ia]
      a0.fromArray(skinPos, ia * 3)
      b0.fromArray(skinPos, ib * 3)
      inner(ia, a1)
      inner(ib, b1)
      wn.negate()
    }
    wn.normalize()
    const q0 = out.vert(a0, wn, 1, 0, 0, seed)
    const q1 = out.vert(b0, wn, 1, 0, 0, seed)
    const q2 = out.vert(b1, wn, 1, 1, 0, seed)
    const q3 = out.vert(a1, wn, 1, 1, 0, seed)
    out.idx.push(q0, q1, q2, q0, q2, q3)
  }
  for (let j = 0; j < N; j++) {
    for (let k = 0; k < M; k++) {
      const h = isHole(j, k)
      if (j + 1 < N && h !== isHole(j + 1, k)) {
        const hj = h ? j : j + 1
        wall((j + 1) * (M + 1) + k, (j + 1) * (M + 1) + k + 1, hj, k)
      }
      if (k + 1 < M && h !== isHole(j, k + 1)) {
        const hk = h ? k : k + 1
        wall(j * (M + 1) + k + 1, (j + 1) * (M + 1) + k + 1, j, hk)
      }
    }
  }
  skin.dispose()

  // the inside: a smooth shell inside the ribs, facing in
  const Ni = 40
  const Mi = 22
  const yc = H * 0.5
  const shrink = 1 - ribDepth - thick / R - 0.01
  const innerBase = out.count
  let floorY = Infinity
  for (let j = 0; j <= Ni; j++) {
    for (let k = 0; k <= Mi; k++) {
      const ph = -Math.PI + (2 * Math.PI * j) / Ni
      const th = (Math.PI * k) / Mi
      const rho = rho0(th) * shrink
      const y = yc + (y0(th) - yc) * (1 - thick / (H * 0.5)) * 0.97
      const kk = (y / H) ** 2
      v.set(rho * Math.sin(ph) + lean[0] * kk * H, y, rho * Math.cos(ph) + lean[1] * kk * H)
      n.set(-Math.sin(th) * Math.sin(ph), -Math.cos(th), -Math.sin(th) * Math.cos(ph))
      if (rho < R * 0.25) floorY = Math.min(floorY, y)
      out.vert(v, n, 2, y / H, 0, seed)
    }
  }
  for (let j = 0; j < Ni; j++) {
    for (let k = 0; k < Mi; k++) {
      const a = innerBase + j * (Mi + 1) + k
      const b = innerBase + (j + 1) * (Mi + 1) + k
      out.idx.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }

  // the candle, a stub of wax with its flame
  const wax = new THREE.CylinderGeometry(0.02, 0.022, 0.04, 14, 1)
  wax.translate(0, floorY + 0.02, 0)
  out.geometry(wax, 5, seed, () => 0)
  wax.dispose()
  const flame = new THREE.LatheGeometry(
    [[0, 0], [0.005, 0.004], [0.0075, 0.012], [0.006, 0.022], [0.003, 0.031], [0.0001, 0.038]].map(([x, y]) => new THREE.Vector2(x, y)),
    10,
  )
  flame.translate(0, floorY + 0.044, 0)
  out.geometry(flame, 3, seed, (p) => (p.y - floorY - 0.044) / 0.038)
  flame.dispose()

  // the stem: fluted, twisting as it rises and bending to one side, flared
  // where it grows out of the dimple
  const top = point(0, 0, new THREE.Vector3()).clone()
  const L = R * (0.3 + rand() * 0.18)
  const bend = (rand() - 0.5) * 0.5 * L
  const bendDir = rand() * Math.PI * 2
  const twist = 1.2 + rand() * 1.2
  const rings = 10
  const around = 20
  const stemPos: number[] = []
  const stemIdx: number[] = []
  for (let r = 0; r <= rings; r++) {
    const t = r / rings
    const cx = top.x + Math.cos(bendDir) * bend * t * t
    const cz = top.z + Math.sin(bendDir) * bend * t * t
    const cy = top.y - 0.012 + L * t
    const rad = R * (0.085 - 0.022 * t) * (1 + 0.7 * Math.exp(-t * 7))
    for (let a = 0; a <= around; a++) {
      const ang = (a / around) * Math.PI * 2
      const flute = 1 + 0.17 * Math.cos(5 * ang + twist * t)
      stemPos.push(cx + Math.cos(ang) * rad * flute, cy, cz + Math.sin(ang) * rad * flute)
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let a = 0; a < around; a++) {
      const i0 = r * (around + 1) + a
      const i1 = i0 + around + 1
      stemIdx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1)
    }
  }
  // the cut end, a little dished
  const capC = stemPos.length / 3
  const last = rings * (around + 1)
  stemPos.push(0, top.y - 0.012 + L - 0.004, 0)
  {
    let sx = 0
    let sz = 0
    for (let a = 0; a < around; a++) {
      sx += stemPos[(last + a) * 3]
      sz += stemPos[(last + a) * 3 + 2]
    }
    stemPos[capC * 3] = sx / around
    stemPos[capC * 3 + 2] = sz / around
  }
  for (let a = 0; a < around; a++) stemIdx.push(last + a, last + a + 1, capC)
  const stem = new THREE.BufferGeometry()
  stem.setAttribute('position', new THREE.Float32BufferAttribute(stemPos, 3))
  stem.setIndex(stemIdx)
  stem.computeVertexNormals()
  out.geometry(stem, 4, seed, (p) => (p.y - top.y) / L)
  stem.dispose()
  let low = Infinity
  for (let i = 1; i < skinPos.length; i += 3) low = Math.min(low, skinPos[i])
  return low
}

// --- the material ------------------------------------------------------------------

function pumpkinMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, candleUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aPk;\nvarying vec4 vPk;\nvarying vec3 vPkPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPk = aPk;\nvPkPos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vPk;
        varying vec3 vPkPos;
        ${CANDLE_GLSL}
        float pkHash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        float pkNoise3(vec3 x) {
          vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(pkHash3(i), pkHash3(i + vec3(1, 0, 0)), f.x), mix(pkHash3(i + vec3(0, 1, 0)), pkHash3(i + vec3(1, 1, 0)), f.x), f.y),
                     mix(mix(pkHash3(i + vec3(0, 0, 1)), pkHash3(i + vec3(1, 0, 1)), f.x), mix(pkHash3(i + vec3(0, 1, 1)), pkHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
        }
        float pkRegion;
        float pkMottle;
        float pkFlick;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        pkRegion = floor(vPk.x + 0.5);
        pkFlick = candle(vPk.w);
        pkMottle = pkNoise3(vPkPos * vec3(14.0, 4.0, 14.0) + vPk.w * 30.0) * 0.6 + pkNoise3(vPkPos * 61.0) * 0.4;
        if (pkRegion < 0.5) {
          // waxy orange, deeper in the grooves, streaked along the ribs
          vec3 orange = mix(vec3(0.6, 0.15, 0.012), vec3(0.72, 0.23, 0.02), fract(vPk.w * 7.31));
          vec3 skin = orange * (0.78 + 0.4 * pkMottle);
          skin = mix(vec3(0.24, 0.055, 0.008), skin, smoothstep(0.0, 0.5, vPk.y));
          // a few pale scars and a dull blush where it lay on the ground
          skin = mix(skin, vec3(0.55, 0.32, 0.12), smoothstep(0.83, 0.9, pkNoise3(vPkPos * 23.0 + 4.0)) * 0.5);
          diffuseColor.rgb = skin;
        } else if (pkRegion < 1.5) {
          diffuseColor.rgb = mix(vec3(0.62, 0.22, 0.03), vec3(0.85, 0.55, 0.2), smoothstep(0.0, 0.35, vPk.y));
        } else if (pkRegion < 2.5) {
          diffuseColor.rgb = vec3(0.7, 0.38, 0.1) * (0.8 + 0.3 * pkMottle);
        } else if (pkRegion < 3.5) {
          diffuseColor.rgb = vec3(0.0);
        } else if (pkRegion < 4.5) {
          float streak = pkNoise3(vec3(vPkPos.x * 90.0, vPkPos.y * 12.0, vPkPos.z * 90.0));
          diffuseColor.rgb = mix(vec3(0.16, 0.14, 0.06), vec3(0.32, 0.27, 0.15), streak) * mix(1.0, 0.6, smoothstep(0.85, 1.0, vPk.y));
        } else {
          diffuseColor.rgb = vec3(0.85, 0.78, 0.6);
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        if (pkRegion < 0.5) roughnessFactor = mix(0.66, 0.5 + 0.2 * pkMottle, smoothstep(0.0, 0.5, vPk.y));
        else if (pkRegion < 1.5) roughnessFactor = 0.75;
        else if (pkRegion < 3.5) roughnessFactor = 0.9;
        else if (pkRegion < 4.5) roughnessFactor = 0.85;
        else roughnessFactor = 0.5;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (pkRegion < 0.5 || (pkRegion > 3.5 && pkRegion < 4.5)) {
          // fine pits in the skin, coarse fibres in the stem
          float bh = pkRegion < 0.5
            ? pkNoise3(vPkPos * 210.0) * 0.6 + pkNoise3(vPkPos * 70.0) * 0.4
            : pkNoise3(vec3(vPkPos.x * 400.0, vPkPos.y * 40.0, vPkPos.z * 400.0));
          float scale = pkRegion < 0.5 ? 0.0009 : 0.0016;
          vec3 sx = dFdx(-vViewPosition);
          vec3 sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal);
          vec3 r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec3 grad = sign(det) * (dFdx(bh) * r1 + dFdy(bh) * r2) * scale;
          normal = normalize(abs(det) * normal - grad);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 c = CANDLE * pkFlick;
          if (pkRegion < 0.5) {
            // the light through thin skin: strong at the cut's lip, a breath in the grooves
            totalEmissiveRadiance = c * diffuseColor.rgb * (0.03 + 1.6 * vPk.z * vPk.z + 0.05 * (1.0 - vPk.y));
          } else if (pkRegion < 1.5) {
            totalEmissiveRadiance = c * diffuseColor.rgb * (0.35 + 3.2 * vPk.y * vPk.y);
          } else if (pkRegion < 2.5) {
            totalEmissiveRadiance = c * diffuseColor.rgb * (2.6 + 3.0 * (1.0 - vPk.y));
          } else if (pkRegion < 3.5) {
            totalEmissiveRadiance = c * vec3(1.0, 0.8, 0.55) * mix(40.0, 14.0, vPk.y);
          } else if (pkRegion > 4.5) {
            totalEmissiveRadiance = c * diffuseColor.rgb * 2.5;
          }
        }`,
      )
  }
  mat.customProgramCacheKey = () => 'hallow-pumpkin'
  return mat
}

// --- the light pools -----------------------------------------------------------------

function poolMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...candleUniforms, uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute vec4 aPool;
      attribute vec2 aFace;
      varying vec2 vRel;
      varying float vR;
      varying vec2 vFace;
      varying float vSeed;
      void main() {
        vRel = position.xz - aPool.xy;
        vR = aPool.z;
        vFace = aFace;
        vSeed = aPool.w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uGain;
      varying vec2 vRel;
      varying float vR;
      varying vec2 vFace;
      varying float vSeed;
      ${CANDLE_GLSL}
      void main() {
        float l = length(vRel);
        float d = l / vR;
        if (d > 1.0) discard;
        float fall = 1.0 - d * d;
        fall = fall * fall * (0.35 + 0.65 * exp(-d * 3.2));
        // most of the light leaves through the face
        float front = dot(vRel / max(l, 1e-4), vFace);
        float k = mix(1.0, 0.3 + 0.7 * smoothstep(-0.5, 0.8, front), smoothstep(0.08, 0.35, d));
        gl_FragColor = vec4(CANDLE * vec3(1.0, 0.8, 0.65) * uGain * fall * k * candle(vSeed), 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

function poolGeometry(spots: readonly PumpkinSpot[], seeds: readonly number[]): THREE.BufferGeometry {
  const pos: number[] = []
  const pool: number[] = []
  const faceDir: number[] = []
  const idx: number[] = []
  const S = 18
  spots.forEach((p, i) => {
    const radius = p.r * 6
    const base = pos.length / 3
    for (let a = 0; a <= S; a++) {
      for (let b = 0; b <= S; b++) {
        const x = p.x + (a / S - 0.5) * 2 * radius
        const z = p.z + (b / S - 0.5) * 2 * radius
        // over grass the glow sits among the blades rather than under them
        const lift = lawnWeight(x, z) > 0.5 ? 0.04 : 0.012
        pos.push(x, surfaceY(x, z) + lift, z)
        pool.push(p.x, p.z, radius, seeds[i]!)
        faceDir.push(Math.sin(p.yaw), Math.cos(p.yaw))
      }
    }
    for (let a = 0; a < S; a++) {
      for (let b = 0; b < S; b++) {
        const i0 = base + a * (S + 1) + b
        const i1 = i0 + S + 1
        idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1)
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aPool', new THREE.Float32BufferAttribute(pool, 4))
  g.setAttribute('aFace', new THREE.Float32BufferAttribute(faceDir, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

// --- the part ------------------------------------------------------------------------

export class Pumpkins implements RealmPart {
  readonly object = new THREE.Group()
  readonly kind = 'Pumpkins'
  private disposables: { dispose(): void }[] = []

  constructor(tier: Tier) {
    const spots = PUMPKINS.filter((p) => tier !== 'phone' || p.phone)
    // the lawn is lit only by the candles that burn on this tier
    PUMPKINS.forEach((p, i) => {
      if (!spots.includes(p)) grassUniforms.uPools.value[i]!.w = 0
    })
    const rand = rng(4410)
    const all = faces()
    const out = new Streams()
    spots.forEach((p, i) => {
      const from = out.count
      const squash = 0.68 + rand() * 0.16
      const low = buildPumpkin(
        out,
        {
          R: p.r,
          H: p.r * 2 * squash,
          ribs: 8 + Math.floor(rand() * 5),
          ribDepth: 0.06 + rand() * 0.04,
          lean: [(rand() - 0.5) * 0.12, (rand() - 0.5) * 0.12],
          seed: seedOf(PUMPKINS.indexOf(p)),
          face: all[i % all.length]!,
          thick: Math.max(0.016, p.r * 0.13),
        },
        tier !== 'phone',
      )
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, surfaceY(p.x, p.z) - 0.012 - low, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rand() - 0.5) * 0.08, p.yaw, (rand() - 0.5) * 0.08, 'YXZ')),
        new THREE.Vector3(1, 1, 1),
      )
      out.transform(from, m)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(out.nor, 3))
    g.setAttribute('aPk', new THREE.Float32BufferAttribute(out.pk, 4))
    g.setIndex(out.idx)
    g.computeBoundingSphere()
    const mat = pumpkinMaterial()
    const mesh = new THREE.Mesh(g, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.object.add(mesh)

    // seeds by the place in the full list, so a pool breathes with its pumpkin
    const pg = poolGeometry(spots, spots.map((p) => seedOf(PUMPKINS.indexOf(p))))
    const pm = poolMaterial()
    pm.uniforms.uGain!.value = 0.45
    const pools = new THREE.Mesh(pg, pm)
    pools.renderOrder = 1
    this.object.add(pools)
    this.disposables.push(g, mat, pg, pm)
  }

  update(frame: Frame): void {
    candleUniforms.uMotion.value = frame.motion
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
