import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  rng,
  noise2,
  groundHeight,
  islandSdf,
  PATH_HALF_WIDTH,
  LANDING,
  GRAVEL_HALF_WIDTH,
  TERRACE_FRONT_Z,
  TERRACE_Y,
  STEPS,
  SHRINE,
} from './layout'
import { loadPbr, pbrMaterial, type PbrSet } from './assets'
import type { RealmPart, Tier } from './types'

// Hand-cut granite: the paved approach, the kerbs that hold the gravel, the
// steps up to the shrine terrace and the stones of the wall that carries it.
// Every stone is its own small mesh with rounded, chipped arrises, its own
// tint, height and a hair of tilt, all merged into one draw call. A vertex
// attribute carries how far each point is from the stone's edge and from the
// ground at its foot, so the shader can put soil, moss and lichen where they
// gather on real stone.

interface Rect {
  a0: number // along the rows
  a1: number
  c0: number // across the rows
  c1: number
}

// Irregular coursed packing of the band a0..a1 by c0..c1: rows of varying
// depth, stones of varying width, joints kept away from the joints of the row
// before, and now and then a stone that runs on through the next row, so the
// pattern never settles into a bond.
function pack(
  a0: number,
  a1: number,
  c0: number,
  c1: number,
  rowMin: number,
  rowMax: number,
  wMin: number,
  wMax: number,
  longChance: number,
  rand: () => number,
): Rect[] {
  const out: Rect[] = []
  let carry: Rect[] = []
  let prevJoints: number[] = []
  let a = a0
  while (a < a1 - 0.02) {
    let d = rowMin + rand() * (rowMax - rowMin)
    if (a1 - a - d < rowMin * 0.7) d = a1 - a
    const last = a + d >= a1 - 0.02
    const occupied = carry.slice().sort((p, q) => p.c0 - q.c0)
    for (const r of occupied) r.a1 = a + d
    const spans: [number, number][] = []
    let x = c0
    for (const r of occupied) {
      if (r.c0 > x + 0.01) spans.push([x, r.c0])
      x = r.c1
    }
    if (c1 > x + 0.01) spans.push([x, c1])
    const row: Rect[] = []
    for (const [s0, s1] of spans) {
      let x0 = s0
      while (s1 - x0 > 0.01) {
        const rem = s1 - x0
        let w = rem
        if (rem > wMax) {
          for (let tries = 0; tries < 6; tries++) {
            w = wMin + rand() * (wMax - wMin)
            if (rem - w < wMin) w = rem - wMin
            const j = x0 + w
            if (!prevJoints.some((p) => Math.abs(p - j) < 0.11)) break
          }
          if (w < wMin * 0.6) w = rem / 2
        }
        row.push({ a0: a, a1: a + d, c0: x0, c1: x0 + w })
        x0 += w
      }
    }
    out.push(...row)
    const joints: number[] = []
    for (const r of [...row, ...occupied]) {
      if (r.c0 > c0 + 0.01) joints.push(r.c0)
      if (r.c1 < c1 - 0.01) joints.push(r.c1)
    }
    prevJoints = joints
    carry = []
    if (!last) {
      for (const r of row) if (r.c1 - r.c0 < wMax * 0.8 && rand() < longChance) carry.push(r)
    }
    a += d
  }
  return out
}

interface BlockSpec {
  w: number // local x
  h: number // local y; the dressed face is +y
  d: number // local z
  round: number // radius of the rounded arris
  chip: number // how much deeper the arris breaks where it is chipped
  bulge: number // a pillowed face, rough split stone
  rough: number // undulation of the dressed face
  tint: [number, number, number]
  ground: number // world height of the ground at the stone's foot
  matrix: THREE.Matrix4
  wear: (x: number, z: number) => number
}

function axis(len: number, r: number, step: number, fine: boolean): number[] {
  const half = len / 2
  const edge = (fine ? [0, r * 0.28, r * 0.65, r * 1.15] : [0, r * 0.5, r * 1.2]).filter((e) => e < half * 0.45)
  const inner = edge[edge.length - 1]
  const n = Math.max(1, Math.round((len - 2 * inner) / step))
  const out: number[] = []
  for (const e of edge) out.push(-half + e)
  for (let i = 1; i < n; i++) out.push(-half + inner + ((len - 2 * inner) * i) / n)
  for (let i = edge.length - 1; i >= 0; i--) out.push(half - edge[i])
  return out
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const _v = new THREE.Vector3()
const _n = new THREE.Matrix3()

// One stone: a dressed face on a grid that is dense at the arrises, where the
// face rolls over into the sides along a quarter circle whose radius grows
// where noise says the stone has been knocked, and a skirt down the sides to
// the base.
function block(s: BlockSpec, rand: () => number, step: number, fine: boolean): THREE.BufferGeometry {
  const r = s.round
  const xs = axis(s.w, r + s.chip * 0.5, step, fine)
  const zs = axis(s.d, r + s.chip * 0.5, step, fine)
  const nx = xs.length
  const nz = zs.length
  const hw = s.w / 2
  const hd = s.d / 2
  const top = s.h / 2
  const seed = rand() * 100
  const pos: number[] = []
  const uv: number[] = []
  const edge: number[] = []
  const index: number[] = []
  const rot = rand() * Math.PI * 2
  const cr = Math.cos(rot)
  const sr = Math.sin(rot)
  const ou = rand() * 9
  const ov = rand() * 9
  const UV = 1.25
  const rc = r * 1.3
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      let u = xs[i]
      let v = zs[j]
      const ex = hw - Math.abs(u)
      const ez = hd - Math.abs(v)
      const e = Math.max(0, rc - Math.hypot(Math.max(rc - ex, 0), Math.max(rc - ez, 0)))
      // chips: sparse bites along the arris, larger at the corners
      const cn = noise2(u * 11 + seed, v * 11 - seed) * 0.7 + noise2(u * 29 - seed, v * 29 + seed) * 0.3
      const corner = (1 - smooth(0, 0.12, ex)) * (1 - smooth(0, 0.12, ez))
      const bite = Math.max(0, cn - 0.52) * 2.1 + corner * 0.35
      const re = r + s.chip * bite
      const t = Math.min(e, re)
      const drop = re - Math.sqrt(Math.max(re * re - (re - t) * (re - t), 0))
      // the outline wanders in by a few millimetres where the stone is broken
      const inward = (s.chip * 0.45 * bite + 0.002 * noise2(u * 5 + seed, v * 5)) * (1 - smooth(0, re * 1.5, e))
      const wx = 1 - smooth(0, rc * 1.5, ex)
      const wz = 1 - smooth(0, rc * 1.5, ez)
      u -= Math.sign(u) * inward * wx
      v -= Math.sign(v) * inward * wz
      const face =
        (noise2(u * 3.1 + seed, v * 3.1) - 0.5) * s.rough +
        (noise2(u * 9.3 - seed, v * 9.3) - 0.5) * s.rough * 0.35 +
        s.bulge * (1 - (u / hw) ** 2) * (1 - (v / hd) ** 2)
      pos.push(u, top - drop + face * smooth(0, re, e), v)
      uv.push((cr * u - sr * v) / UV + ou, (sr * u + cr * v) / UV + ov)
      edge.push(e)
    }
  }
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1)
    }
  }
  // the perimeter of the face, counter-clockwise seen from above
  const ring: number[] = []
  for (let i = 0; i < nx - 1; i++) ring.push(i)
  for (let j = 0; j < nz - 1; j++) ring.push(j * nx + nx - 1)
  for (let i = nx - 1; i > 0; i--) ring.push((nz - 1) * nx + i)
  for (let j = nz - 1; j > 0; j--) ring.push(j * nx)
  const base = pos.length / 3
  const levels = 3
  let per = 0
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k]
    const px = pos[p * 3]
    const py = pos[p * 3 + 1]
    const pz = pos[p * 3 + 2]
    if (k > 0) {
      const q = ring[k - 1]
      per += Math.hypot(px - pos[q * 3], pz - pos[q * 3 + 2])
    }
    const lo = -top
    const mid = Math.max(py - Math.min(0.035, (py - lo) * 0.4), lo + 0.001)
    const jit = (noise2(per * 13 + seed, 0.5) - 0.5) * 0.006
    const len = Math.hypot(px, pz) || 1
    for (const [y, out] of [
      [py, 0],
      [mid, jit],
      [lo, jit * 0.5],
    ] as const) {
      pos.push(px + (px / len) * out, y, pz + (pz / len) * out)
      uv.push(per / UV + ou, y / UV + ov)
      edge.push(0)
    }
  }
  const nr = ring.length
  for (let k = 0; k < nr; k++) {
    const a = base + k * levels
    const b = base + ((k + 1) % nr) * levels
    for (let l = 0; l < levels - 1; l++) index.push(a + l, b + l, a + l + 1, a + l + 1, b + l, b + l + 1)
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.applyMatrix4(s.matrix)
  geo.computeVertexNormals()
  _n.getNormalMatrix(s.matrix)
  const p = geo.getAttribute('position')
  const count = p.count
  const stone = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    _v.fromBufferAttribute(p, i)
    stone[i * 3] = Math.min(edge[i], 0.25)
    stone[i * 3 + 1] = _v.y - s.ground
    stone[i * 3 + 2] = s.wear(_v.x, _v.z)
    color[i * 3] = s.tint[0]
    color[i * 3 + 1] = s.tint[1]
    color[i * 3 + 2] = s.tint[2]
  }
  geo.setAttribute('aStone', new THREE.BufferAttribute(stone, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(color, 3))
  return geo
}

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
function place(x: number, y: number, z: number, rx: number, ry: number, rz: number): THREE.Matrix4 {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'))
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(1, 1, 1))
}

// granite greys, a few stones warmer, cooler or darker than the rest
function granite(rand: () => number, lo: number, span: number): [number, number, number] {
  const v = lo + rand() * span
  const warm = (rand() - 0.5) * 0.07
  return [v + warm, v + 0.005, v + 0.03 - warm]
}

const noWear = (): number => 0
// feet keep to a band down the middle of the approach; it wanders a little
function pathWear(x: number, z: number): number {
  const c = (noise2(z * 0.35, 4.1) - 0.5) * 0.25
  const w = Math.exp(-(((x - c) / 0.55) ** 2))
  return w * (0.75 + noise2(x * 2.3, z * 2.3) * 0.25)
}

class Builder {
  readonly pieces: THREE.BufferGeometry[] = []
  constructor(
    private rand: () => number,
    private step: number,
    private fine: boolean,
  ) {}

  add(spec: Omit<BlockSpec, 'matrix'>, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    this.pieces.push(block({ ...spec, matrix: place(x, y, z, rx, ry, rz) }, this.rand, this.step, this.fine))
  }

  // a paved field of slabs between z0 (front) and z1, x from -half to half
  paving(
    z0: number,
    z1: number,
    half: number,
    level: (z: number) => number,
    rows: [number, number],
    widths: [number, number],
  ): void {
    const rand = this.rand
    const rects = pack(-z0, -z1, -half, half, rows[0], rows[1], widths[0], widths[1], 0.2, rand)
    for (const r of rects) {
      // joints vary from tight to a finger's width, wider here and there for the moss
      const jw = () => 0.004 + rand() * 0.008 + (rand() < 0.15 ? 0.012 : 0)
      const ja0 = jw()
      const ja1 = jw()
      const jc0 = r.c0 <= -half + 0.01 ? 0.002 : jw()
      const jc1 = r.c1 >= half - 0.01 ? 0.002 : jw()
      const w = r.c1 - r.c0 - jc0 - jc1
      const d = r.a1 - r.a0 - ja0 - ja1
      const cx = (r.c0 + jc0 + r.c1 - jc1) / 2
      const cz = -(r.a0 + ja0 + r.a1 - ja1) / 2
      const y = level(cz) + (rand() - 0.5) * 0.007
      const h = 0.12
      this.add(
        {
          w,
          h,
          d,
          round: 0.01 + rand() * 0.01,
          chip: 0.012 + rand() * 0.02,
          bulge: 0.0015,
          rough: 0.004,
          tint: granite(rand, 0.56, 0.3),
          ground: y - 0.035,
          wear: pathWear,
        },
        cx,
        y - h / 2,
        cz,
        (rand() - 0.5) * 0.012,
        (rand() - 0.5) * 0.01,
        (rand() - 0.5) * 0.012,
      )
    }
    this.pieces.push(bed(z0, z1, half, level))
  }

  kerbRun(x: number, z0: number, z1: number, top: number): void {
    const rand = this.rand
    let z = z0
    while (z > z1 + 0.1) {
      let len = 0.7 + rand() * 0.9
      if (z - len - z1 < 0.4) len = z - z1
      const j = 0.006 + rand() * 0.008
      const w = 0.16 + rand() * 0.025
      const h = 0.3
      const y = top + (rand() - 0.5) * 0.01
      this.add(
        {
          w,
          h,
          d: len - j,
          round: 0.014 + rand() * 0.01,
          chip: 0.02 + rand() * 0.02,
          bulge: 0.002,
          rough: 0.004,
          tint: granite(rand, 0.68, 0.2),
          ground: groundHeight(x, z - len / 2),
          wear: noWear,
        },
        x + (rand() - 0.5) * 0.012,
        y - h / 2,
        z - len / 2,
        (rand() - 0.5) * 0.008,
        (rand() - 0.5) * 0.01,
        (rand() - 0.5) * 0.012,
      )
      z -= len
    }
  }

  kerbAcross(z: number, x0: number, x1: number, top: number): void {
    const rand = this.rand
    let x = x0
    while (x < x1 - 0.1) {
      let len = 0.7 + rand() * 0.7
      if (x1 - x - len < 0.4) len = x1 - x
      const j = 0.006 + rand() * 0.008
      const h = 0.3
      this.add(
        {
          w: len - j,
          h,
          d: 0.16 + rand() * 0.025,
          round: 0.014 + rand() * 0.01,
          chip: 0.02 + rand() * 0.02,
          bulge: 0.002,
          rough: 0.004,
          tint: granite(rand, 0.68, 0.2),
          ground: groundHeight(x + len / 2, z),
          wear: noWear,
        },
        x + len / 2,
        top + (rand() - 0.5) * 0.01 - h / 2,
        z + (rand() - 0.5) * 0.01,
        (rand() - 0.5) * 0.008,
        (rand() - 0.5) * 0.01,
        (rand() - 0.5) * 0.008,
      )
      x += len
    }
  }

  steps(): void {
    const rand = this.rand
    const rise = TERRACE_Y / STEPS.count
    const tread = (STEPS.zFront - STEPS.zBack) / STEPS.count
    let prev: number[] = []
    for (let i = 0; i < STEPS.count; i++) {
      const top = rise * (i + 1)
      const zf = STEPS.zFront - tread * i
      // two or three long blocks per step, the joints never over the ones below
      const cuts = [-STEPS.halfWidth]
      for (let tries = 0; tries < 12; tries++) {
        cuts.length = 1
        let x = -STEPS.halfWidth
        while (STEPS.halfWidth - x > 1.5) {
          x += 0.8 + rand() * 0.9
          cuts.push(x)
        }
        if (!cuts.slice(1).some((c) => prev.some((p) => Math.abs(p - c) < 0.25))) break
      }
      cuts.push(STEPS.halfWidth)
      prev = cuts.slice(1, -1)
      // each block runs down to below the ground, so no step floats over the slope
      const bottom = -0.3
      for (let c = 0; c < cuts.length - 1; c++) {
        const j0 = c === 0 ? 0 : 0.005 + rand() * 0.006
        const j1 = c === cuts.length - 2 ? 0 : 0.005 + rand() * 0.006
        const x0 = cuts[c] + j0
        const x1 = cuts[c + 1] - j1
        const depth = tread + 0.3
        const t = top + (rand() - 0.5) * 0.008
        const h = t - bottom
        this.add(
          {
            w: x1 - x0,
            h,
            d: depth,
            round: 0.018 + rand() * 0.012,
            chip: 0.025 + rand() * 0.02,
            bulge: 0.002,
            rough: 0.005,
            tint: granite(rand, 0.66, 0.2),
            ground: top - rise,
            wear: (x) => Math.exp(-((x / 0.6) ** 2)) * 0.8,
          },
          (x0 + x1) / 2,
          t - h / 2,
          zf - depth / 2 + 0.02 + (rand() - 0.5) * 0.014,
          (rand() - 0.5) * 0.008,
          (rand() - 0.5) * 0.01,
          (rand() - 0.5) * 0.008,
        )
      }
      // the cheek stones either side
      for (const side of [-1, 1]) {
        const h = top + 0.5
        this.add(
          {
            w: 0.34,
            h,
            d: tread - 0.008,
            round: 0.02 + rand() * 0.01,
            chip: 0.03,
            bulge: 0.002,
            rough: 0.005,
            tint: granite(rand, 0.6, 0.18),
            ground: groundHeight(side * (STEPS.halfWidth + 0.5), zf - tread / 2),
            wear: noWear,
          },
          side * (STEPS.halfWidth + 0.17) + (rand() - 0.5) * 0.01,
          top + 0.02 + (rand() - 0.5) * 0.01 - h / 2,
          zf - tread / 2,
          (rand() - 0.5) * 0.006,
          (rand() - 0.5) * 0.01,
          (rand() - 0.5) * 0.006,
        )
      }
    }
  }

  // The terrace wall: roughly squared granite in irregular courses on a
  // battered face, each stone pillowed and set a little proud or back.
  wall(side: -1 | 1): void {
    const rand = this.rand
    const z = TERRACE_FRONT_Z
    const x0 = STEPS.halfWidth + 0.34
    let x1 = x0
    while (islandSdf(side * (x1 + 0.2), z) > 0.6) x1 += 0.2
    let yStart = 0
    for (let x = x0; x <= x1; x += 0.3) yStart = Math.min(yStart, groundHeight(side * x, z + 0.6))
    yStart -= 0.2
    const yTop = TERRACE_Y - 0.02
    const rects = pack(yStart, yTop, x0, x1, 0.22, 0.56, 0.36, 1.25, 0.26, rand)
    for (const r of rects) {
      const j = () => 0.008 + rand() * 0.012
      const ja0 = j()
      const ja1 = r.a1 >= yTop - 0.01 ? 0.004 : j()
      const jc0 = j()
      const jc1 = j()
      const hgt = r.a1 - r.a0 - ja0 - ja1
      const wid = r.c1 - r.c0 - jc0 - jc1
      const yc = (r.a0 + ja0 + r.a1 - ja1) / 2
      const xc = side * (r.c0 + jc0 + r.c1 - jc1) / 2
      const thick = 0.3
      const n = wallNormal()
      const proud = (rand() - 0.3) * 0.025
      const zf = wallPlane(yc) + proud
      this.add(
        {
          w: wid,
          h: thick,
          d: hgt,
          round: 0.03 + rand() * 0.015,
          chip: 0.03 + rand() * 0.03,
          bulge: 0.01 + rand() * 0.012,
          rough: 0.012,
          tint: granite(rand, 0.7, 0.34),
          ground: groundHeight(xc, z + 0.6),
          wear: noWear,
        },
        xc,
        yc - n.y * thick * 0.5,
        zf - n.z * thick * 0.5,
        Math.PI / 2 - WALL_BATTER + (rand() - 0.5) * 0.05,
        (rand() - 0.5) * 0.05,
        (rand() - 0.5) * 0.04,
      )
    }
    // the cap stones, uneven in length, height and set
    let x = x0
    while (islandSdf(side * (x + 0.6), z) > 0.8) {
      const len = 0.55 + rand() * 0.8
      const j = 0.006 + rand() * 0.01
      const h = 0.15 + rand() * 0.05
      const d = 0.46 + rand() * 0.08
      this.add(
        {
          w: len - j,
          h,
          d,
          round: 0.02 + rand() * 0.015,
          chip: 0.03 + rand() * 0.03,
          bulge: 0.004,
          rough: 0.006,
          tint: granite(rand, 0.58, 0.22),
          ground: -10,
          wear: noWear,
        },
        side * (x + len / 2),
        TERRACE_Y - 0.02 + h / 2 + (rand() - 0.5) * 0.012,
        wallPlane(TERRACE_Y) + 0.04 - d / 2 + (rand() - 0.5) * 0.03,
        (rand() - 0.5) * 0.012,
        (rand() - 0.5) * 0.03,
        (rand() - 0.5) * 0.014,
      )
      x += len
    }
  }
}

// The bed under a paved field: dark soil and moss that shows in the joints,
// set just below the slab tops so the ground beneath never reads through.
function bed(z0: number, z1: number, half: number, level: (z: number) => number): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((z0 - z1) / 0.5))
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (let j = 0; j <= n; j++) {
    const z = z0 + ((z1 - z0) * j) / n
    const y = level(z) - 0.024
    pos.push(-half, y, z, half, y, z)
    uv.push(-half, z, half, z)
    if (j < n) index.push(j * 2, j * 2 + 1, j * 2 + 2, j * 2 + 1, j * 2 + 3, j * 2 + 2)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const count = pos.length / 3
  geo.setAttribute('aStone', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
  const c = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) c.set([0.42, 0.38, 0.32], i * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return geo
}

// the batter: the wall face leans back 0.28 m over its height
const WALL_Y0 = -0.35
const WALL_BATTER = Math.atan2(0.28, TERRACE_Y + 0.02 - WALL_Y0)
function wallPlane(y: number): number {
  return TERRACE_FRONT_Z + 0.32 - ((y - WALL_Y0) / (TERRACE_Y + 0.02 - WALL_Y0)) * 0.28
}
const _wn = new THREE.Vector3()
function wallNormal(): THREE.Vector3 {
  return _wn.set(0, Math.sin(WALL_BATTER), Math.cos(WALL_BATTER))
}

// The backing behind the wall stones: a dark, set-back face of soil and
// rubble that shows in the deeper joints.
function wallBacking(side: -1 | 1): THREE.BufferGeometry {
  const x0 = side * (STEPS.halfWidth + 0.34)
  let x1 = x0
  const z = TERRACE_FRONT_Z
  while (islandSdf(x1 + side * 0.2, z) > 0.6) x1 += side * 0.2
  const cols = Math.max(2, Math.round(Math.abs(x1 - x0) / 0.5))
  const rows = 4
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (let i = 0; i <= cols; i++) {
    const x = x0 + ((x1 - x0) * i) / cols
    const bottom = Math.min(groundHeight(x, z + 0.6), 0) - 0.35
    for (let j = 0; j <= rows; j++) {
      const f = j / rows
      const y = bottom + (TERRACE_Y + 0.02 - bottom) * f
      pos.push(x, y, wallPlane(y) - 0.035)
      uv.push(x / 2.4, y / 2.4)
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j
      const b = a + rows + 1
      if (side > 0) index.push(a, b, a + 1, a + 1, b, b + 1)
      else index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

const STONE_VERT_PARS = /* glsl */ `
attribute vec3 aStone;
varying vec3 vStone;
varying vec3 vSWorld;
varying vec3 vSNormal;
`

const STONE_FRAG_PARS = /* glsl */ `
uniform sampler2D tStoneMoss;
varying vec3 vStone;
varying vec3 vSWorld;
varying vec3 vSNormal;
float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y);
}
float sMoss;
float sWear;
`

// soil in the broken arrises, moss creeping in from the joints and up from
// the foot, lichen on the faces the weather reaches, and a darker, smoother
// band where feet have polished the stone
const STONE_MAP = /* glsl */ `
#include <map_fragment>
{
  vec3 wp = vSWorld;
  vec3 wn = normalize(vSNormal);
  float up = smoothstep(0.55, 0.9, wn.y);
  // a 2D domain that works on tops (xz) and on faces (along the face, y)
  vec2 dom = mix(vec2(wp.x + wp.z, wp.y * 1.3), wp.xz, up);
  float edgeD = vStone.x;
  float foot = vStone.y;
  sWear = vStone.z;
  // the scan is a warm stone; granite is a cool, speckled grey
  float lum = dot(diffuseColor.rgb, vec3(0.3, 0.55, 0.15));
  diffuseColor.rgb = mix(vec3(lum), diffuseColor.rgb, 0.4) * vec3(0.98, 1.0, 1.03);
  float n1 = sNoise(dom * 5.0);
  float n2 = sNoise(dom * 17.0 + 3.1);
  float n3 = sNoise(dom * 1.3 - 7.7);
  // grime in the rolled arris and down the sides in the joints
  float arris = 1.0 - smoothstep(0.0, 0.012 + 0.02 * n2, edgeD);
  diffuseColor.rgb *= mix(1.0, 0.6, arris * (1.0 - 0.6 * sWear));
  // dark staining that rises from the ground and runs down the faces
  float streak = sNoise(vec2((wp.x + wp.z) * 6.0, wp.y * 0.7));
  float stain = (1.0 - smoothstep(0.0, 0.25 + 0.35 * streak, foot)) * (1.0 - up * 0.7);
  diffuseColor.rgb *= mix(1.0, 0.68, stain);
  // moss: from the joints, in from the edges where it is damp, and at the foot
  float damp = smoothstep(0.35, 0.75, n3);
  float creep = (1.0 - smoothstep(0.0, 0.01 + 0.07 * n1 * damp, edgeD)) * (0.35 + 0.65 * damp);
  float rise = 1.0 - smoothstep(0.0, 0.02 + 0.12 * n1 * (0.4 + damp), foot);
  sMoss = clamp(max(creep, rise) * smoothstep(0.25, 0.55, n2 * 0.5 + n1 * 0.5) * (1.0 - sWear), 0.0, 1.0);
  // moss keeps the scan's structure but takes a cushion green, darker where it is dense
  float mt = dot(texture2D(tStoneMoss, dom * 1.4).rgb, vec3(0.33));
  vec3 mossCol = mix(vec3(0.05, 0.07, 0.025), vec3(0.2, 0.26, 0.07), clamp(mt * 1.8, 0.0, 1.0));
  // dark soil at the very foot, under the moss
  float soil = 1.0 - smoothstep(0.0, 0.02 + 0.03 * n2, foot);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.06, 0.05), soil * 0.8);
  // lichen: pale rosettes and a few dark spots on the open faces
  float ln = sNoise(dom * 21.0 + 11.0) * 0.6 + sNoise(dom * 63.0) * 0.4;
  float spread = smoothstep(0.45, 0.8, sNoise(dom * 2.1 + 4.0));
  float pale = smoothstep(0.66, 0.8, ln) * spread * (1.0 - sWear) * (0.5 + 0.5 * up);
  float dark = smoothstep(0.78, 0.8, sNoise(dom * 29.0 - 5.0) * 0.7 + n2 * 0.3) * (1.0 - sWear) * (0.3 + 0.7 * spread);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.71, 0.63), pale * 0.32);
  diffuseColor.rgb *= 1.0 - dark * 0.22;
  // where feet go the stone is a shade darker and polished smooth
  diffuseColor.rgb *= mix(1.0, 0.76, sWear * (0.7 + 0.3 * n3));
  diffuseColor.rgb = mix(diffuseColor.rgb, mossCol, sMoss);
}
`

function patchStone(mat: THREE.MeshStandardMaterial, moss: THREE.Texture): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tStoneMoss = { value: moss }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${STONE_VERT_PARS}`).replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vStone = aStone;
      vSWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vSNormal = normalize(mat3(modelMatrix) * objectNormal);`,
    )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${STONE_FRAG_PARS}`)
      .replace('#include <map_fragment>', STONE_MAP)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * mix(1.0, 0.8, sWear), 0.95, sMoss);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, sMoss * 0.6 + sWear * 0.3));`,
      )
  }
  mat.customProgramCacheKey = () => 'realm-stonework'
}

export class Stonework implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Stonework> {
    const [stone, wall, moss] = await Promise.all([loadPbr('stone', tier), loadPbr('wall', tier), loadPbr('moss', tier)])
    return new Stonework(tier, stone, wall, moss)
  }

  private constructor(tier: Tier, stone: PbrSet, wall: PbrSet, moss: PbrSet) {
    const rand = rng(7)
    const fine = tier !== 'phone'
    const b = new Builder(rand, fine ? 0.08 : 0.16, fine)
    const lower = (cz: number) => groundHeight(0, cz) + 0.035
    // the landing: larger slabs across its whole width
    b.paving(LANDING.zFront, LANDING.zBack, LANDING.halfWidth, () => 0.035, [0.42, 0.72], [0.55, 1.25])
    b.paving(LANDING.zBack, STEPS.zFront, PATH_HALF_WIDTH, lower, [0.28, 0.66], [0.34, 1.1])
    b.paving(STEPS.zBack, SHRINE.z + SHRINE.depth / 2 + 0.6, PATH_HALF_WIDTH, () => TERRACE_Y + 0.035, [0.28, 0.66], [0.34, 1.1])

    // kerbs along the path and the gravel's outer edge
    const pathTop = 0.06
    for (const side of [-1, 1]) {
      b.kerbRun(side * (PATH_HALF_WIDTH + 0.085), LANDING.zBack, STEPS.zFront + 0.02, pathTop)
      b.kerbRun(side * (GRAVEL_HALF_WIDTH + 0.085), LANDING.zBack, STEPS.zFront + 0.3, pathTop - 0.01)
      b.kerbRun(side * (PATH_HALF_WIDTH + 0.085), STEPS.zBack, SHRINE.z + SHRINE.depth / 2 + 0.6, TERRACE_Y + 0.06)
    }
    b.kerbAcross(LANDING.zBack - 0.085, -GRAVEL_HALF_WIDTH - 0.17, -PATH_HALF_WIDTH - 0.17, pathTop)
    b.kerbAcross(LANDING.zBack - 0.085, PATH_HALF_WIDTH + 0.17, GRAVEL_HALF_WIDTH + 0.17, pathTop)
    b.steps()
    b.wall(-1)
    b.wall(1)

    const stoneGeo = mergeGeometries(b.pieces, false)
    for (const g of b.pieces) g.dispose()
    if (!stoneGeo) throw new Error('stonework merge failed')
    const stoneMat = pbrMaterial(stone, { vertexColors: true })
    patchStone(stoneMat, moss.map)
    const stoneMesh = new THREE.Mesh(stoneGeo, stoneMat)
    stoneMesh.castShadow = true
    stoneMesh.receiveShadow = true

    const backs = [wallBacking(-1), wallBacking(1)]
    const backGeo = mergeGeometries(backs, false)
    for (const g of backs) g.dispose()
    if (!backGeo) throw new Error('wall backing merge failed')
    const backMat = pbrMaterial(wall, { color: new THREE.Color(0.32, 0.3, 0.27) })
    const backMesh = new THREE.Mesh(backGeo, backMat)
    backMesh.receiveShadow = true

    this.object.add(stoneMesh, backMesh)
    this.disposables.push(stoneGeo, stoneMat, backGeo, backMat)
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
