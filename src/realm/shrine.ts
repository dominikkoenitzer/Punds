import * as THREE from 'three'
import { SHRINE, TERRACE_Y } from './layout'
import { loadPbr, pbrMaterial, type PbrSet } from './assets'
import { weatheredStone } from './materials'
import { bevelBox, lathe, merge, tint, transformed, weather, worldUv } from './geo'
import { realmUniforms, WIND_GLSL } from './atmosphere'
import type { RealmPart, Tier } from './types'

// The worship hall in the nagare style of small shrines: a raised floor on a
// cut granite plinth, a veranda with a railing on three sides, vermilion
// posts and bracket sets framing white plaster, latticed doors at the front,
// and a long concave copper roof whose front slope flows out over the steps
// on its own pair of posts. Straw rope with folded paper hangs across the
// front; the bell and its braided rope hang over the offering box.

type Geo = THREE.BufferGeometry
type P2 = [number, number] // z, y in the hall's own frame

const BODY_W = 5.6
const BODY_D = 3.8
const HW = BODY_W / 2
const HD = BODY_D / 2
const BAY = BODY_W / 3
const PLINTH = 0.45
const FLOOR = 0.95
const WALL_TOP = 3.05 // post heads of the body
const POST_R = 0.125
const STACK = 0.42 // bearing block, bracket arm and small blocks
const RIDGE = { z: -0.2, y: 6.05 }
const EAVE_F = { z: 4.4, y: 3.1 }
const EAVE_B = { z: -2.95, y: 3.8 }
const ROOF_HW = HW + 1.05
const SLAB = 0.2 // copper skin over the boards, as thick as the layered edge
const DROP = 0.12 // base rafters sit one course below the flying rafters
const RW = 0.075
const RH = 0.09
const KOHAI_Z = 3.4 // the posts that carry the long front slope
const KOKI_F = 3.95
const KOKI_B = -2.55
const LIFT = 0.15
// the eave edge in courses, [height, setback], from the top down
const COURSES: P2[] = [
  [0.045, 0],
  [0.035, 0.014],
  [0.045, 0.028],
  [0.035, 0.042],
  [0.04, 0.056],
]
const LIP_IN = 0.056
const VEL_X = HW + 0.65 // veranda edge at the sides
const VEL_Z = HD + 0.7 // veranda edge at the front
const STAIR_HW = 1.2

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

// concave: steep under the ridge, almost level at the eave
function curve(s: number): number {
  return 0.8 * (1 - (1 - s) * (1 - s)) + 0.2 * s
}

function slopeS(z: number): number {
  return z >= RIDGE.z ? clamp01((z - RIDGE.z) / (EAVE_F.z - RIDGE.z)) : clamp01((RIDGE.z - z) / (RIDGE.z - EAVE_B.z))
}

function roofTop(z: number): number {
  const e = z >= RIDGE.z ? EAVE_F : EAVE_B
  return RIDGE.y + (e.y - RIDGE.y) * curve(slopeS(z))
}

const under = (z: number) => roofTop(z) - SLAB

// the eave line lifts a little towards the corners, never the dramatic sweep
// of continental roofs
function lift(x: number, z: number): number {
  const c = clamp01((Math.abs(x) - (ROOF_HW - 1.7)) / 1.7)
  const s = slopeS(z)
  return LIFT * c * c * s * s * s
}

// the base rafters and their soffit run straight from the wall plate to the
// rafter-end beam, one course below the roof boards
function lowChord(x: number, z: number): number {
  const front = z > 0
  const za = front ? HD - 0.15 : -HD + 0.15
  const zb = front ? KOKI_F : KOKI_B
  const ya = under(za) - DROP + lift(x, za)
  const yb = under(zb) - DROP + lift(x, zb)
  return ya + ((yb - ya) * (z - za)) / (zb - za)
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _c = new THREE.Vector3()
const _m4 = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s1 = new THREE.Vector3(1, 1, 1)
const UP = new THREE.Vector3(0, 1, 0)

// flip the winding if the faces do not turn towards `hint`, then shade
function orient(geo: Geo, hint: THREE.Vector3): Geo {
  const pos = geo.getAttribute('position')
  const idx = geo.index
  if (!idx) return geo
  let sum = 0
  for (let i = 0; i < idx.count; i += 3) {
    _a.fromBufferAttribute(pos, idx.getX(i))
    _b.fromBufferAttribute(pos, idx.getX(i + 1)).sub(_a)
    _c.fromBufferAttribute(pos, idx.getX(i + 2)).sub(_a)
    sum += _b.cross(_c).dot(hint)
  }
  if (sum < 0) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1)
      idx.setX(i + 1, idx.getX(i + 2))
      idx.setX(i + 2, t)
    }
  }
  geo.computeVertexNormals()
  return geo
}

function surface(nu: number, nv: number, at: (i: number, j: number, out: THREE.Vector3) => void, uvAt: (i: number, j: number) => P2, hint: THREE.Vector3): Geo {
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const p = new THREE.Vector3()
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      at(i, j, p)
      pos.push(p.x, p.y, p.z)
      const [u, v] = uvAt(i, j)
      uv.push(u, v)
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      const b = a + nu + 1
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  return orient(geo, hint)
}

// one smooth run of the roof profile, swept across the full roof width
function roofRun(pts: P2[], hint: THREE.Vector3, along0 = 0): Geo {
  const along: number[] = [along0]
  for (let k = 1; k < pts.length; k++) along.push(along[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]))
  const nx = 44
  const xAt = (i: number) => -ROOF_HW + (2 * ROOF_HW * i) / nx
  return surface(
    nx,
    pts.length - 1,
    (i, j, out) => {
      const x = xAt(i)
      out.set(x, pts[j][1] + lift(x, pts[j][0]), pts[j][0])
    },
    (i, j) => [xAt(i), along[j]],
    hint,
  )
}

function sampleZ(z0: number, z1: number, n: number, f: (z: number) => number): P2[] {
  const out: P2[] = []
  for (let k = 0; k <= n; k++) {
    const z = z0 + ((z1 - z0) * k) / n
    out.push([z, f(z)])
  }
  return out
}

function lipPoints(front: boolean): P2[] {
  const e = front ? EAVE_F : EAVE_B
  const dir = front ? 1 : -1
  const pts: P2[] = [[e.z, e.y]]
  let y = e.y
  for (const [h, inset] of COURSES) {
    const z = e.z - dir * inset
    if (inset > 0) pts.push([z, y])
    y -= h
    pts.push([z, y])
  }
  const last = pts[pts.length - 1]
  last[1] = under(last[0])
  return pts
}

// a section swept along a path; flat across the section's edges, smooth
// along the path; `side` gives the section's first axis
function sweep(path: THREE.Vector3[], section: P2[], side: THREE.Vector3, caps = true): Geo {
  const n = path.length
  const ss: THREE.Vector3[] = []
  const us: THREE.Vector3[] = []
  const ts: THREE.Vector3[] = []
  const along: number[] = [0]
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3().subVectors(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)]).normalize()
    const s = side.clone().addScaledVector(t, -side.dot(t)).normalize()
    const u = new THREE.Vector3().crossVectors(t, s)
    if (u.y < -1e-6) {
      u.negate()
      s.negate()
    }
    ts.push(t)
    ss.push(s)
    us.push(u)
    if (i > 0) along.push(along[i - 1] + path[i].distanceTo(path[i - 1]))
  }
  let area = 0
  for (let k = 0; k < section.length; k++) {
    const [a0, b0] = section[k]
    const [a1, b1] = section[(k + 1) % section.length]
    area += a0 * b1 - a1 * b0
  }
  const ccw = area > 0
  const parts: Geo[] = []
  const mid = Math.floor(n / 2)
  for (let k = 0; k < section.length; k++) {
    const p0 = section[k]
    const p1 = section[(k + 1) % section.length]
    const da = p1[0] - p0[0]
    const db = p1[1] - p0[1]
    const na = ccw ? db : -db
    const nb = ccw ? -da : da
    const hint = ss[mid].clone().multiplyScalar(na).addScaledVector(us[mid], nb)
    parts.push(
      surface(
        n - 1,
        1,
        (i, j, out) => {
          const q = j === 0 ? p0 : p1
          out.copy(path[i]).addScaledVector(ss[i], q[0]).addScaledVector(us[i], q[1])
        },
        (i, j) => [along[i], j === 0 ? k * 0.1 : (k + 1) * 0.1],
        hint,
      ),
    )
  }
  if (caps) {
    const contour = section.map(([a, b]) => new THREE.Vector2(a, b))
    const tris = THREE.ShapeUtils.triangulateShape(contour, [])
    for (const end of [0, n - 1]) {
      const pos: number[] = []
      const uv: number[] = []
      for (const [a, b] of section) {
        const p = path[end].clone().addScaledVector(ss[end], a).addScaledVector(us[end], b)
        pos.push(p.x, p.y, p.z)
        uv.push(a, b)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(tris.flat())
      parts.push(orient(g, end === 0 ? ts[0].clone().negate() : ts[n - 1]))
    }
  }
  return merge(parts)
}

// a rectangle with chamfered arrises, for swept beams
function chamfered(w: number, h: number, c: number, b0 = -h / 2): P2[] {
  const a = w / 2
  const b1 = b0 + h
  return [
    [-a + c, b0],
    [a - c, b0],
    [a, b0 + c],
    [a, b1 - c],
    [a - c, b1],
    [-a + c, b1],
    [-a, b1 - c],
    [-a, b0 + c],
  ]
}

// a bevelled timber from a to b; its width lies across `up`
function bar(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, bevel = 0.008, up = UP): Geo {
  const len = a.distanceTo(b)
  const g = bevelBox(w, h, len, bevel, 1)
  _m4.lookAt(a, b, up)
  _m4.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return g.applyMatrix4(_m4)
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 14): Geo {
  const len = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1)
  _q.setFromUnitVectors(UP, _c.subVectors(b, a).normalize())
  _m4.compose(_a.addVectors(a, b).multiplyScalar(0.5), _q, _s1)
  return g.applyMatrix4(_m4)
}

function flat(g: Geo): Geo {
  const out = g.toNonIndexed()
  g.dispose()
  out.computeVertexNormals()
  return out
}

function setWear(g: Geo, f: (x: number, y: number, z: number, ny: number) => number, name = 'aWear'): Geo {
  const pos = g.getAttribute('position')
  const nor = g.getAttribute('normal')
  const w = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) w[i] = f(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i))
  g.setAttribute(name, new THREE.BufferAttribute(w, 1))
  return g
}

// knock a corner off a block: vertices near the corner pulled in, a small
// flat break where something heavy once caught it
function chip(g: Geo, cx: number, cy: number, cz: number, r: number): void {
  const pos = g.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const dx = pos.getX(i) - cx
    const dy = pos.getY(i) - cy
    const dz = pos.getZ(i) - cz
    const d = Math.hypot(dx, dy, dz)
    if (d >= r) continue
    const k = ((r - d) / Math.max(d, 1e-4)) * 0.55
    pos.setXYZ(i, pos.getX(i) - dx * k * 0.6, pos.getY(i) - dy * k, pos.getZ(i) - dz * k * 0.6)
  }
  pos.needsUpdate = true
  g.computeVertexNormals()
}

// a flat colour in the colour attribute
function paintAll(g: Geo, c: [number, number, number]): Geo {
  return tint(g, c[0], c[1], c[2])
}

// texture coordinates wrapped around a round post, the seam turned to the back
function postUv(g: Geo, r: number, scale: number): Geo {
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (uv.getX(i) * Math.PI * 2 * r) / scale, pos.getY(i) / scale)
  g.rotateY(Math.PI)
  g.userData.keepUv = true
  return g
}

// bearing block: a square cap over a tapered neck
function block(x: number, y: number, z: number, top: number, h: number): Geo {
  const r0 = (top * 0.74) / Math.SQRT2
  const r1 = top / Math.SQRT2
  const neck = flat(
    lathe(
      [
        [0.001, 0],
        [r0, 0],
        [r1, h * 0.5],
        [0.001, h * 0.5],
      ],
      4,
      Math.PI / 4,
    ),
  )
  const cap = bevelBox(top, h * 0.5, top, 0.008, 1)
  cap.translate(0, h * 0.75, 0)
  return transformed(merge([neck, cap]), x, y, z)
}

let armTemplate: Geo | null = null
// bracket arm: the underside sweeps up at both ends
function arm(): Geo {
  if (!armTemplate) {
    const L = 0.5
    const H = 0.14
    const s = new THREE.Shape()
    s.moveTo(-L, H)
    s.lineTo(L, H)
    s.lineTo(L, H * 0.55)
    s.quadraticCurveTo(L * 0.74, 0, L * 0.42, 0)
    s.lineTo(-L * 0.42, 0)
    s.quadraticCurveTo(-L * 0.74, 0, -L, H * 0.55)
    s.closePath()
    armTemplate = new THREE.ExtrudeGeometry(s, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 8 })
    armTemplate.translate(0, 0, -0.06)
    armTemplate.deleteAttribute('uv')
    armTemplate.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(armTemplate.getAttribute('position').count * 2), 2))
  }
  return armTemplate.clone()
}

// one bracket set on a post head: bearing block, arm, three small blocks
function bracket(out: Geo[], x: number, base: number, z: number, alongX: boolean, alongZ: boolean): void {
  out.push(block(x, base, z, 0.32, 0.2))
  const ya = base + 0.2
  const dirs: boolean[] = []
  if (alongX) dirs.push(true)
  if (alongZ) dirs.push(false)
  dirs.forEach((dx, k) => {
    out.push(transformed(arm(), x, ya, z, 0, dx ? 0 : Math.PI / 2, 0))
    for (const u of [-0.38, 0, 0.38]) {
      if (u === 0 && k > 0) continue
      out.push(block(x + (dx ? u : 0), ya + 0.14, z + (dx ? 0 : u), 0.17, 0.08))
    }
  })
}

// a sagging rope of three twisted strands, thick in the middle
function twistedRope(a: THREE.Vector3, b: THREE.Vector3, sag: number, rMid: number, rEnd: number, twists: number): Geo {
  const centre = (t: number, out: THREE.Vector3) => {
    out.lerpVectors(a, b, t)
    out.y -= sag * 4 * t * (1 - t)
    return out
  }
  const radius = (t: number) => rEnd + (rMid - rEnd) * Math.pow(Math.sin(Math.PI * t), 0.7)
  const dir = new THREE.Vector3().subVectors(b, a).normalize()
  const n2 = new THREE.Vector3().crossVectors(dir, UP).normalize()
  const parts: Geo[] = []
  const N = 160
  for (let s = 0; s < 3; s++) {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= N; i++) {
      const t = i / N
      const c = centre(t, new THREE.Vector3())
      const th = t * twists * Math.PI * 2 + (s * Math.PI * 2) / 3
      const r = radius(t) * 0.42
      c.addScaledVector(UP, Math.cos(th) * r).addScaledVector(n2, Math.sin(th) * r)
      pts.push(c)
    }
    const curveS = new THREE.CatmullRomCurve3(pts)
    const g = new THREE.TubeGeometry(curveS, 240, 1, 10, false)
    const pos = g.getAttribute('position')
    const nor = g.getAttribute('normal')
    const uv = g.getAttribute('uv')
    for (let i = 0; i < pos.count; i++) {
      const r = radius(uv.getX(i)) * 0.62
      const x = pos.getX(i) - nor.getX(i)
      const y = pos.getY(i) - nor.getY(i)
      const z = pos.getZ(i) - nor.getZ(i)
      pos.setXYZ(i, x + nor.getX(i) * r, y + nor.getY(i) * r, z + nor.getZ(i) * r)
    }
    g.computeVertexNormals()
    parts.push(g)
  }
  return merge(parts)
}

// folded paper streamers: four steps zig-zagging down; uv.y carries how far
// down the strip a vertex hangs, for the wind
function shideGeo(at: THREE.Vector3[]): Geo {
  const parts: Geo[] = []
  const w = 0.07
  const h = 0.09
  for (const p of at) {
    for (let i = 0; i < 4; i++) {
      const g = new THREE.BoxGeometry(w, h, 0.0025, 1, 2, 1)
      const pos = g.getAttribute('position')
      const uv = g.getAttribute('uv')
      for (let k = 0; k < pos.count; k++) uv.setXY(k, pos.getX(k), (i * h * 0.95 + h / 2 - pos.getY(k)) / (4 * h))
      g.rotateY(i % 2 === 0 ? 0.28 : -0.28)
      g.translate(p.x + (i % 2 === 0 ? -w * 0.25 : w * 0.25), p.y - h / 2 - i * h * 0.95, p.z + (i % 2) * 0.008)
      parts.push(g)
    }
  }
  return merge(parts)
}

const NOISE_GLSL = `
float nHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float nNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(nHash(i), nHash(i + vec3(1, 0, 0)), f.x), mix(nHash(i + vec3(0, 1, 0)), nHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(nHash(i + vec3(0, 0, 1)), nHash(i + vec3(1, 0, 1)), f.x), mix(nHash(i + vec3(0, 1, 1)), nHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`

export class Shrine implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Shrine> {
    const [paint, plaster, cedar, aged, copper, stone] = await Promise.all([
      loadPbr('painted_wood', tier),
      loadPbr('plaster', tier),
      loadPbr('cedar_planks', tier),
      loadPbr('wood_aged', tier),
      loadPbr('copper', tier),
      loadPbr('stone', tier),
    ])
    return new Shrine(paint, plaster, cedar, aged, copper, stone)
  }

  private constructor(paint: PbrSet, plaster: PbrSet, cedar: PbrSet, aged: PbrSet, copper: PbrSet, stone: PbrSet) {
    const red: Geo[] = []
    const ochre: Geo[] = []
    const gold: Geo[] = []
    const wood: Geo[] = []
    const dark: Geo[] = []
    const walls: Geo[] = []
    const cu: Geo[] = []
    const stones: Geo[] = []
    const inside: Geo[] = []

    this.buildPlinth(stones)
    this.buildBody(red, gold, wood, walls, inside)
    this.buildRoof(cu, red, ochre, gold, walls)
    this.buildFront(red, gold, dark, inside)

    const redMat = this.redMaterial(paint)
    const goldMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.34, 0.21, 0.06),
      metalness: 1,
      roughness: 0.48,
      // dull brass: it should not mirror the bright sky as a pale block
      envMapIntensity: 0.35,
      normalMap: copper.normalMap,
      normalScale: new THREE.Vector2(0.25, 0.25),
    })
    const woodMat = pbrMaterial(cedar, { color: new THREE.Color().setRGB(0.62, 0.5, 0.38), metalness: 0 })
    woodMat.metalnessMap = null
    const darkMat = pbrMaterial(aged, { color: new THREE.Color().setRGB(0.62, 0.48, 0.34), metalness: 0 })
    darkMat.metalnessMap = null
    const wallMat = this.plasterMaterial(plaster)
    const stoneMat = weatheredStone(stone, new THREE.Color(0.1, 0.14, 0.05), { color: new THREE.Color(0.84, 0.83, 0.8), vertexColors: true, metalness: 0 })
    stoneMat.metalnessMap = null
    const copperMat = this.copperMaterial(copper)
    const interiorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.012, 0.009, 0.007), roughness: 0.92, side: THREE.DoubleSide })

    // painted end grain shares the vermilion material, flagged per vertex
    for (const g of ochre) red.push(setWear(g, () => 1, 'aPaint'))
    this.addMesh(red, redMat, 1.4, ['aWear', 'aPaint'], true)
    this.addMesh(gold, goldMat, 0.5, [])
    this.addMesh(wood, woodMat, 1.6, [])
    this.addMesh(dark, darkMat, 1.2, [])
    this.addMesh(walls, wallMat, 2.0, ['aWear'])
    this.addMesh(stones, stoneMat, 1.1, [])
    this.addMesh(cu, copperMat, 0, [])
    this.addMesh(inside, interiorMat, 1, [])

    this.buildRopes()

    this.object.position.set(SHRINE.x, TERRACE_Y, SHRINE.z)
    this.object.rotation.y = SHRINE.rotation
  }

  private addMesh(parts: Geo[], mat: THREE.Material, uvScale: number, attrs: string[], edgeWear = false): void {
    for (const g of parts) {
      if (uvScale > 0 && !g.userData.keepUv) worldUv(g, uvScale)
      // round parts carry their own wear; only boxed and swept timber
      // takes the arris wear below
      const boxed = edgeWear && !g.getAttribute('aWear')
      for (const a of attrs) {
        if (!g.getAttribute(a)) g.setAttribute(a, new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count), 1))
      }
      if (boxed) {
        // paint wears first on the arrises, where the normal turns
        const w = g.getAttribute('aWear')
        const nor = g.getAttribute('normal')
        for (let i = 0; i < w.count; i++) {
          const m = Math.max(Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i)))
          w.setX(i, Math.max(w.getX(i), clamp01((1 - m - 0.05) / 0.2) * 0.58))
        }
      }
    }
    const geo = merge(parts)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.object.add(mesh)
    this.disposables.push(geo, mat)
  }

  // cut granite in two courses with a projecting coping, every block its own
  // size and shade, the arrises softened and chipped
  private buildPlinth(stones: Geo[]): void {
    let seed = 7
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    const PX = HW + 0.8
    const PZB = -HD - 0.4
    const PZF = HD + 0.95
    const course = (y0: number, h: number, d: number, out: number, minL: number, maxL: number) => {
      const lay = (x0: number, x1: number, fixed: number, alongX: boolean, sign: number) => {
        let p = x0
        while (p < x1 - 0.05) {
          let L = minL + rnd() * (maxL - minL)
          if (x1 - (p + L) < minL * 0.6) L = x1 - p
          const g = alongX ? bevelBox(L - 0.008, h - 0.006, d, 0.024, 3) : bevelBox(d, h - 0.006, L - 0.008, 0.024, 3)
          weather(g, 0.014, 6 + rnd() * 4, rnd() * 10)
          const bw = alongX ? L : d
          const bd = alongX ? d : L
          for (let c = 0; c < 2; c++) chip(g, (rnd() < 0.5 ? -1 : 1) * bw * 0.5, h * 0.5, (rnd() < 0.5 ? -1 : 1) * bd * 0.5, 0.05 + rnd() * 0.05)
          const c = (fixed + sign * (out - d / 2))
          if (alongX) transformed(g, p + L / 2, y0 + h / 2, c)
          else transformed(g, c, y0 + h / 2, p + L / 2)
          const k = 0.86 + rnd() * 0.2
          tint(g, k, k * (0.98 + rnd() * 0.03), k * (0.95 + rnd() * 0.04))
          stones.push(g)
          p += L
        }
      }
      lay(-PX - out, PX + out, PZF, true, 1)
      lay(-PX - out, PX + out, PZB, true, -1)
      lay(PZB - out + d, PZF + out - d, PX, false, 1)
      lay(PZB - out + d, PZF + out - d, -PX, false, -1)
    }
    course(0, 0.27, 0.34, 0, 0.7, 1.25)
    course(0.27, PLINTH - 0.27, 0.44, 0.035, 0.9, 1.6)
    const fill = bevelBox(2 * PX - 0.6, 0.12, PZF - PZB - 0.6, 0.01, 1)
    stones.push(tint(transformed(fill, 0, PLINTH - 0.07, (PZF + PZB) / 2), 0.7, 0.69, 0.66))
    // round stones under the front posts, a step at the foot of the stair
    for (const x of [-HW, HW]) {
      const g = lathe(
        [
          [0.001, 0],
          [0.28, 0],
          [0.29, 0.06],
          [0.25, 0.13],
          [0.18, 0.15],
          [0.001, 0.15],
        ],
        20,
      )
      weather(g, 0.008, 9, x)
      stones.push(tint(transformed(g, x, 0, KOHAI_Z), 0.9, 0.89, 0.86))
    }
    const step = bevelBox(2 * STAIR_HW + 0.5, 0.17, 0.34, 0.025, 3)
    weather(step, 0.008, 7, 3)
    stones.push(tint(transformed(step, 0, 0.085, VEL_Z + 0.81 + 0.17), 0.92, 0.91, 0.88))
  }

  private buildBody(red: Geo[], gold: Geo[], wood: Geo[], walls: Geo[], inside: Geo[]): void {
    const footWear = (base: number) => (_x: number, y: number) => 1 - clamp01((y - base) / 0.3)
    const post = (x: number, z: number, y0: number, y1: number) => {
      const g = postUv(new THREE.CylinderGeometry(POST_R, POST_R * 1.02, y1 - y0, 24, 16), POST_R, 1.4)
      return setWear(transformed(g, x, (y0 + y1) / 2, z), footWear(y0))
    }
    const xs = [-HW, -HW + BAY, HW - BAY, HW]
    for (const x of xs) for (const z of [-HD, HD]) red.push(post(x, z, PLINTH, WALL_TOP))
    for (const x of [-HW, HW]) red.push(post(x, 0, PLINTH, WALL_TOP))

    // tie beams and applied rails, ends capped in brass
    const beamX = (y: number, h: number, z: number, d: number, x0: number, x1: number) => transformed(bevelBox(x1 - x0, h, d, 0.012, 1), (x0 + x1) / 2, y + h / 2, z)
    const beamZ = (y: number, h: number, x: number, d: number, z0: number, z1: number) => transformed(bevelBox(d, h, z1 - z0, 0.012, 1), x, y + h / 2, (z0 + z1) / 2)
    const capX = (x: number, y: number, z: number, h: number, d: number) => gold.push(transformed(bevelBox(0.035, h + 0.01, d + 0.01, 0.004, 1), x, y + h / 2, z))
    const capZ = (x: number, y: number, z: number, h: number, d: number) => gold.push(transformed(bevelBox(d + 0.01, h + 0.01, 0.035, 0.004, 1), x, y + h / 2, z))
    const nuY = WALL_TOP - 0.18
    for (const z of [-HD, HD]) {
      red.push(beamX(nuY, 0.17, z, 0.13, -HW - 0.26, HW + 0.26))
      capX(-HW - 0.26, nuY, z, 0.17, 0.13)
      capX(HW + 0.26, nuY, z, 0.17, 0.13)
    }
    for (const x of [-HW, HW]) {
      red.push(beamZ(nuY - 0.005, 0.17, x, 0.12, -HD - 0.26, HD + 0.26))
      capZ(x, nuY - 0.005, -HD - 0.26, 0.17, 0.12)
      capZ(x, nuY - 0.005, HD + 0.26, 0.17, 0.12)
    }
    const NAGE = 2.5 // lintel rail over the doors
    const sill = FLOOR
    for (const [z, s] of [
      [-HD, -1],
      [HD, 1],
    ] as const) {
      red.push(beamX(NAGE, 0.15, z + s * (POST_R + 0.02), 0.08, -HW - 0.14, HW + 0.14))
      red.push(beamX(sill, 0.15, z + s * (POST_R + 0.02), 0.08, -HW - 0.14, HW + 0.14))
      // brass rosettes where the lintel rail crosses each post
      for (const x of xs) {
        const r = lathe(
          [
            [0.056, 0],
            [0.052, 0.008],
            [0.03, 0.024],
            [0.001, 0.028],
          ],
          6,
        )
        gold.push(transformed(r, x, NAGE + 0.075, z + s * (POST_R + 0.06), s * Math.PI / 2, 0, 0))
      }
    }
    for (const [x, s] of [
      [-HW, -1],
      [HW, 1],
    ] as const) {
      red.push(beamZ(NAGE, 0.15, x + s * (POST_R + 0.02), 0.08, -HD - 0.14, HD + 0.14))
      red.push(beamZ(sill, 0.15, x + s * (POST_R + 0.02), 0.08, -HD - 0.14, HD + 0.14))
      for (const z of [-HD, 0, HD]) {
        const r = lathe(
          [
            [0.056, 0],
            [0.052, 0.008],
            [0.03, 0.024],
            [0.001, 0.028],
          ],
          6,
        )
        gold.push(transformed(r, x + s * (POST_R + 0.06), NAGE + 0.075, z, 0, 0, -s * Math.PI / 2))
      }
    }

    // plaster on the back and the sides, set just behind the post faces
    const panel = (w: number, y0: number, y1: number, x: number, z: number, ry: number) => {
      const g = transformed(new THREE.PlaneGeometry(w, y1 - y0, 2, 6), x, (y0 + y1) / 2, z, 0, ry, 0)
      return setWear(g, (_x, y) => clamp01((y - y0) / (y1 - y0)))
    }
    for (let i = 0; i < 3; i++) walls.push(panel(BAY - 0.2, sill + 0.15, nuY, -HW + BAY * (i + 0.5), -HD - 0.03, Math.PI))
    for (const s of [-1, 1]) {
      for (const zc of [-HD / 2, HD / 2]) walls.push(panel(HD - 0.2, sill + 0.15, nuY, s * (HW + 0.03), zc, (s * Math.PI) / 2))
    }
    // front: a plaster band above the lintel, latticed doors below it
    for (let i = 0; i < 3; i++) walls.push(panel(BAY - 0.2, NAGE + 0.15, nuY, -HW + BAY * (i + 0.5), HD + 0.03, 0))

    for (let i = 0; i < 3; i++) {
      const cx = -HW + BAY * (i + 0.5)
      const w = BAY - 2 * POST_R - 0.02
      const z = HD
      const y0 = sill + 0.15
      const y1 = NAGE
      // frame, a solid lower panel, then the lattice
      red.push(transformed(bevelBox(0.07, y1 - y0, 0.07, 0.008, 1), cx - w / 2 + 0.035, (y0 + y1) / 2, z))
      red.push(transformed(bevelBox(0.07, y1 - y0, 0.07, 0.008, 1), cx + w / 2 - 0.035, (y0 + y1) / 2, z))
      red.push(transformed(bevelBox(0.06, y1 - y0, 0.07, 0.008, 1), cx, (y0 + y1) / 2, z))
      red.push(transformed(bevelBox(w, 0.06, 0.07, 0.008, 1), cx, y1 - 0.03, z))
      const kosh = y0 + 0.3
      red.push(transformed(bevelBox(w - 0.1, kosh - y0, 0.03, 0.006, 1), cx, (y0 + kosh) / 2, z))
      red.push(transformed(bevelBox(w, 0.06, 0.07, 0.008, 1), cx, kosh, z))
      const ly0 = kosh + 0.03
      const ly1 = y1 - 0.06
      const cols = 14
      for (let c = 1; c < cols; c++) {
        if (c === cols / 2) continue
        red.push(transformed(bevelBox(0.022, ly1 - ly0, 0.038, 0.004, 1), cx - w / 2 + 0.07 + ((w - 0.14) * c) / cols, (ly0 + ly1) / 2, z))
      }
      const rows = 11
      for (let r = 1; r < rows; r++) {
        red.push(transformed(bevelBox(w - 0.1, 0.022, 0.03, 0.004, 1), cx, ly0 + ((ly1 - ly0) * r) / rows, z - 0.004))
      }
      // brass pulls on the meeting stiles and hinge plates on the outer ones
      for (const s of [-1, 1]) {
        const ring = new THREE.TorusGeometry(0.034, 0.007, 8, 20)
        gold.push(transformed(ring, cx + s * 0.06, (ly0 + ly1) / 2 - 0.1, z + 0.045))
        const plate = lathe(
          [
            [0.032, 0],
            [0.03, 0.006],
            [0.001, 0.008],
          ],
          12,
        )
        gold.push(transformed(plate, cx + s * 0.06, (ly0 + ly1) / 2 - 0.066, z + 0.036, Math.PI / 2, 0, 0))
        for (const yy of [y0 + 0.12, y1 - 0.15]) {
          gold.push(transformed(bevelBox(0.14, 0.05, 0.012, 0.003, 1), cx + s * (w / 2 - 0.07), yy, z + 0.04))
        }
      }
    }

    // the dark room behind the lattice, with a mirror catching what light
    // gets in
    const D = 0.08
    const room = [
      transformed(new THREE.PlaneGeometry(BODY_W - 0.2, BODY_D - 0.2), 0, FLOOR + 0.01, 0, -Math.PI / 2, 0, 0),
      transformed(new THREE.PlaneGeometry(BODY_W - 0.2, nuY - FLOOR), 0, (FLOOR + nuY) / 2, -HD + D, 0, 0, 0),
      transformed(new THREE.PlaneGeometry(BODY_D - 0.2, nuY - FLOOR), -HW + D, (FLOOR + nuY) / 2, 0, 0, Math.PI / 2, 0),
      transformed(new THREE.PlaneGeometry(BODY_D - 0.2, nuY - FLOOR), HW - D, (FLOOR + nuY) / 2, 0, 0, -Math.PI / 2, 0),
      transformed(new THREE.PlaneGeometry(BODY_W - 0.2, BODY_D - 0.2), 0, nuY - 0.02, 0, Math.PI / 2, 0, 0),
      transformed(bevelBox(1.6, 0.5, 0.6, 0.01, 1), 0, FLOOR + 0.25, -HD + 0.5),
    ]
    inside.push(...room)
    gold.push(transformed(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 32, 1), 0, FLOOR + 0.82, -HD + 0.45, Math.PI / 2, 0, 0))

    // veranda: edge beams on short posts, boards running with the edge
    const enPosts: P2[] = [
      [-VEL_X + 0.12, VEL_Z - 0.12],
      [-STAIR_HW - 0.15, VEL_Z - 0.12],
      [STAIR_HW + 0.15, VEL_Z - 0.12],
      [VEL_X - 0.12, VEL_Z - 0.12],
      [-VEL_X + 0.12, -1.0],
      [VEL_X - 0.12, -1.0],
      [-VEL_X + 0.12, 0.6],
      [VEL_X - 0.12, 0.6],
    ]
    for (const [x, z] of enPosts) red.push(setWear(transformed(bevelBox(0.13, FLOOR - 0.06 - PLINTH, 0.13, 0.012, 1), x, (PLINTH + FLOOR - 0.06) / 2, z), footWear(PLINTH)))
    red.push(beamX(FLOOR - 0.2, 0.15, VEL_Z - 0.06, 0.1, -VEL_X, VEL_X))
    for (const s of [-1, 1]) red.push(beamZ(FLOOR - 0.2, 0.15, s * (VEL_X - 0.06), 0.1, -HD + 0.2, VEL_Z))
    for (let k = 0; k < 4; k++) {
      const z = HD + 0.1 + k * 0.155
      wood.push(transformed(bevelBox(2 * VEL_X, 0.05, 0.15, 0.008, 1), 0, FLOOR - 0.025, z + 0.075))
    }
    for (const s of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const x = s * (HW + 0.1 + k * 0.155 + 0.075)
        wood.push(transformed(bevelBox(0.15, 0.05, BODY_D - 0.2 + 0.1, 0.008, 1), x, FLOOR - 0.025, 0.05))
      }
    }

    // railing: round posts, three rails, brass onion caps at ends and corners
    const railY = [FLOOR + 0.07, FLOOR + 0.36, FLOOR + 0.64]
    const giboshi = (x: number, y: number, z: number) =>
      gold.push(
        transformed(
          lathe(
            [
              [0.001, 0],
              [0.05, 0],
              [0.053, 0.025],
              [0.046, 0.04],
              [0.058, 0.08],
              [0.044, 0.12],
              [0.014, 0.16],
              [0.004, 0.185],
              [0.001, 0.19],
            ],
            18,
          ),
          x,
          y,
          z,
        ),
      )
    const railRun = (a: THREE.Vector3, b: THREE.Vector3, capA: boolean, capB: boolean) => {
      const n = Math.max(1, Math.round(a.distanceTo(b) / 0.95))
      for (let k = 0; k <= n; k++) {
        const p = new THREE.Vector3().lerpVectors(a, b, k / n)
        const end = k === 0 || k === n
        const top = railY[2] + (end ? 0.08 : 0)
        red.push(setWear(transformed(postUv(new THREE.CylinderGeometry(end ? 0.045 : 0.035, end ? 0.045 : 0.035, top - FLOOR, 14, 8), 0.04, 1.4), p.x, (top + FLOOR) / 2, p.z), (_x, y, _z, ny) => (ny > 0.5 ? 0.8 : 1 - clamp01((y - FLOOR) / 0.2))))
        if ((k === 0 && capA) || (k === n && capB)) giboshi(p.x, top, p.z)
      }
      for (const [i, y] of railY.entries()) {
        const a2 = a.clone().setY(y)
        const b2 = b.clone().setY(y)
        if (i === 2) red.push(setWear(rod(a2, b2, 0.03, 14), (_x, _y, _z, ny) => (ny > 0.55 ? 0.9 : 0.1)))
        else red.push(bar(a2, b2, 0.035, 0.06, 0.008))
      }
    }
    for (const s of [-1, 1]) {
      const corner = v3(s * (VEL_X - 0.05), 0, VEL_Z - 0.05)
      railRun(v3(s * (STAIR_HW + 0.12), 0, VEL_Z - 0.05), corner, true, true)
      railRun(corner, v3(s * (VEL_X - 0.05), 0, -HD + 0.3), false, true)
      // side screen closing the veranda at the back
      const zx = -HD + 0.22
      red.push(transformed(bevelBox(0.08, 1.9, 0.08, 0.01, 1), s * (VEL_X - 0.05), FLOOR + 0.95, zx))
      red.push(transformed(bevelBox(VEL_X - HW - POST_R, 0.08, 0.08, 0.01, 1), s * (HW + POST_R + (VEL_X - HW - POST_R) / 2 - 0.02), FLOOR + 1.9, zx))
      walls.push(setWear(transformed(new THREE.PlaneGeometry(VEL_X - HW - POST_R - 0.06, 1.75, 1, 4), s * ((HW + VEL_X) / 2 + 0.04), FLOOR + 0.95, zx + 0.002), (_x, y) => clamp01((y - FLOOR) / 1.8)))
      walls.push(setWear(transformed(new THREE.PlaneGeometry(VEL_X - HW - POST_R - 0.06, 1.75, 1, 4), s * ((HW + VEL_X) / 2 + 0.04), FLOOR + 0.95, zx - 0.002, 0, Math.PI, 0), (_x, y) => clamp01((y - FLOOR) / 1.8)))
    }

    // the stair: open treads between sloping stringers, its own handrails
    const nT = 3
    const rise = (FLOOR - 0.17) / (nT + 1)
    const tread = 0.27
    for (let k = 1; k <= nT; k++) {
      const y = FLOOR - rise * k
      wood.push(transformed(bevelBox(2 * STAIR_HW, 0.045, tread + 0.03, 0.008, 1), 0, y - 0.022, VEL_Z + tread * (k - 0.5)))
    }
    const zTop = VEL_Z - 0.02
    const zBot = VEL_Z + tread * nT + 0.02
    for (const s of [-1, 1]) {
      const x = s * (STAIR_HW + 0.04)
      red.push(setWear(bar(v3(x, FLOOR - 0.08, zTop), v3(x, 0.17 + rise * 0.5 - 0.08, zBot), 0.07, 0.26, 0.01), (_x, _y, _z, ny) => (ny > 0.6 ? 0.55 : 0)))
      const pTop = v3(x, FLOOR, zTop + 0.02)
      const pBot = v3(x, 0.17, zBot + 0.12)
      red.push(setWear(transformed(postUv(new THREE.CylinderGeometry(0.045, 0.045, 0.78, 14, 8), 0.045, 1.4), pBot.x, pBot.y + 0.39 - 0.17 + 0.17, pBot.z), (_x, y, _z, ny) => (ny > 0.5 ? 0.8 : 1 - clamp01((y - 0.17) / 0.25))))
      giboshi(pBot.x, pBot.y + 0.78, pBot.z)
      red.push(setWear(rod(v3(x, pTop.y + 0.64, pTop.z), v3(x, pBot.y + 0.7, pBot.z), 0.03, 14), (_x, _y, _z, ny) => (ny > 0.55 ? 0.95 : 0.1)))
    }
  }

  private buildRoof(cu: Geo[], red: Geo[], ochre: Geo[], gold: Geo[], walls: Geo[]): void {
    // copper skin: the two slopes, the layered eave edges, the gable edges
    const topF = sampleZ(RIDGE.z, EAVE_F.z, 56, roofTop)
    const topB = sampleZ(RIDGE.z, EAVE_B.z, 32, roofTop)
    cu.push(roofRun(topF, UP))
    cu.push(roofRun(topB, UP))
    const lipF = lipPoints(true)
    const lipB = lipPoints(false)
    for (const [pts, dir] of [
      [lipF, 1],
      [lipB, -1],
    ] as const) {
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k]
        const b = pts[k + 1]
        const vertical = Math.abs(a[0] - b[0]) < 1e-6
        cu.push(roofRun([a, b], vertical ? v3(0, 0, dir) : v3(0, -1, 0), 20 + k * 0.05))
      }
    }
    const undF = sampleZ(EAVE_F.z - LIP_IN, RIDGE.z, 48, under)
    const undB = sampleZ(RIDGE.z, EAVE_B.z + LIP_IN, 28, under)
    red.push(roofRun(undF, v3(0, -1, 0)), roofRun(undB, v3(0, -1, 0)))
    const contour: P2[] = [...topB.slice().reverse(), ...topF.slice(1), ...lipF.slice(1), ...undF.slice(1), ...undB.slice(1), ...lipB.slice().reverse().slice(1, -1)]
    const tris = THREE.ShapeUtils.triangulateShape(
      contour.map(([z, y]) => new THREE.Vector2(z, y)),
      [],
    )
    for (const s of [-1, 1]) {
      const pos: number[] = []
      const uv: number[] = []
      for (const [z, y] of contour) {
        const x = s * ROOF_HW
        pos.push(x, y + lift(x, z), z)
        uv.push(z, y)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(tris.flat())
      cu.push(orient(g, v3(s, 0, 0)))
    }

    // ridge: a stepped box ridge with a rolled top, closed by end plates
    const ridgeHalf: P2[] = [
      [0.25, -0.34],
      [0.25, -0.13],
      [0.21, -0.09],
      [0.21, 0.03],
      [0.14, 0.06],
      [0.14, 0.12],
      [0.1, 0.165],
      [0.05, 0.195],
      [0, 0.205],
    ]
    const ridgeSec: P2[] = [...ridgeHalf, ...ridgeHalf.slice(0, -1).reverse().map(([a, b]) => [-a, b] as P2)]
    const RX = ROOF_HW + 0.08
    const ridgePath: THREE.Vector3[] = []
    for (let k = 0; k <= 8; k++) ridgePath.push(v3(-RX + (2 * RX * k) / 8, RIDGE.y + 0.02, RIDGE.z))
    cu.push(sweep(ridgePath, ridgeSec, v3(0, 0, 1)))
    for (const s of [-1, 1]) {
      const sh = new THREE.Shape()
      sh.moveTo(-0.3, -0.3)
      sh.lineTo(0.3, -0.3)
      sh.lineTo(0.3, 0.08)
      sh.quadraticCurveTo(0.28, 0.3, 0, 0.34)
      sh.quadraticCurveTo(-0.28, 0.3, -0.3, 0.08)
      sh.closePath()
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1, curveSegments: 10 })
      g.translate(0, 0, -0.025)
      cu.push(transformed(g, s * (RX + 0.03), RIDGE.y + 0.02, RIDGE.z, 0, Math.PI / 2, 0))
      const ros = lathe(
        [
          [0.075, 0],
          [0.07, 0.01],
          [0.04, 0.03],
          [0.001, 0.035],
        ],
        16,
      )
      gold.push(transformed(ros, s * (RX + 0.065), RIDGE.y + 0.07, RIDGE.z, 0, 0, -s * Math.PI / 2))
    }

    // lowered soffit over the base rafters, front and back
    for (const front of [true, false]) {
      const za = front ? HD - 0.15 : -HD + 0.15
      const zb = front ? KOKI_F : KOKI_B
      const nx = 44
      red.push(
        surface(
          nx,
          1,
          (i, j, out) => {
            const x = -ROOF_HW + 0.04 + ((2 * ROOF_HW - 0.08) * i) / nx
            const z = j === 0 ? za : zb
            out.set(x, lowChord(x, z), z)
          },
          (i, j) => [i * 0.2, j],
          v3(0, -1, 0),
        ),
      )
    }

    // rafters in two tiers, end grain painted ochre
    const n = 38
    const span = ROOF_HW - 0.12
    for (let k = 0; k < n; k++) {
      const x = -span + (2 * span * k) / (n - 1)
      for (const front of [true, false]) {
        const d = front ? 1 : -1
        const za = front ? HD - 0.15 : -HD + 0.15
        const koki = front ? KOKI_F : KOKI_B
        const z1 = koki + d * 0.14
        const a = v3(x, lowChord(x, za) - RH / 2, za)
        const b = v3(x, lowChord(x, z1) - RH / 2, z1)
        red.push(bar(a, b, RW, RH, 0.008))
        const dir = b.clone().sub(a).normalize()
        ochre.push(bar(b.clone().addScaledVector(dir, -0.006), b.clone().addScaledVector(dir, 0.003), RW + 0.002, RH + 0.002, 0.003))
        // flying rafters from the rafter-end beam to the eave
        const fa = koki - d * 0.1
        const fb = (front ? EAVE_F.z : EAVE_B.z) - d * (LIP_IN + 0.05)
        const ya = under(fa) + lift(x, fa)
        const yb = under(fb) + lift(x, fb)
        let dev = 0
        for (let t = 1; t < 8; t++) {
          const z = fa + ((fb - fa) * t) / 8
          dev = Math.max(dev, ya + ((yb - ya) * t) / 8 - (under(z) + lift(x, z)))
        }
        const fA = v3(x, ya - dev - RH / 2, fa)
        const fB = v3(x, yb - dev - RH / 2, fb)
        red.push(bar(fA, fB, RW, RH * 0.95, 0.008))
        const fd = fB.clone().sub(fA).normalize()
        ochre.push(bar(fB.clone().addScaledVector(fd, -0.006), fB.clone().addScaledVector(fd, 0.003), RW + 0.002, RH * 0.95 + 0.002, 0.003))
      }
    }

    // rafter-end beams, following the lift of the corners
    for (const koki of [KOKI_F, KOKI_B]) {
      const path: THREE.Vector3[] = []
      for (let k = 0; k <= 24; k++) {
        const x = -ROOF_HW + 0.05 + ((2 * ROOF_HW - 0.1) * k) / 24
        path.push(v3(x, lowChord(x, koki), koki))
      }
      const h = under(koki) - lowChord(0, koki) + 0.02
      red.push(sweep(path, chamfered(0.13, h, 0.012, 0), v3(0, 0, 1)))
    }

    // wall plates carrying the rafters, on bracket sets over every post
    const plate = (z: number, x0: number, x1: number) => {
      const top = lowChord(0, z) - RH
      const bot = WALL_TOP + STACK
      red.push(transformed(bevelBox(x1 - x0, top - bot, 0.17, 0.012, 1), (x0 + x1) / 2, (top + bot) / 2, z))
      for (const x of [x0, x1]) ochre.push(transformed(bevelBox(0.012, top - bot + 0.004, 0.174, 0.003, 1), x + Math.sign(x) * 0.004, (top + bot) / 2, z))
    }
    plate(HD, -ROOF_HW + 0.08, ROOF_HW - 0.08)
    plate(-HD, -ROOF_HW + 0.08, ROOF_HW - 0.08)
    for (const x of [-HW, -HW + BAY, HW - BAY, HW]) {
      const corner = Math.abs(x) === HW
      bracket(red, x, WALL_TOP, HD, true, corner)
      bracket(red, x, WALL_TOP, -HD, true, corner)
    }
    for (const x of [-HW, HW]) bracket(red, x, WALL_TOP, 0, false, true)

    // gables: tie beam on the side brackets, strut to the ridge beam, a
    // second tie higher up, plaster between
    const ridgeBot = under(RIDGE.z) - 0.24
    red.push(transformed(bevelBox(2 * ROOF_HW - 0.12, 0.24, 0.2, 0.014, 1), 0, ridgeBot + 0.12, RIDGE.z))
    const tieY = WALL_TOP + STACK
    const tieH = 0.2
    const gY = 4.62
    let zg0 = RIDGE.z
    let zg1 = RIDGE.z
    while (under(zg0 - 0.01) > gY + 0.18 && zg0 > -HD) zg0 -= 0.01
    while (under(zg1 + 0.01) > gY + 0.18 && zg1 < HD) zg1 += 0.01
    for (const s of [-1, 1]) {
      const x = s * HW
      red.push(transformed(bevelBox(0.16, tieH, BODY_D + 0.3, 0.012, 1), x, tieY + tieH / 2, 0))
      red.push(transformed(bevelBox(0.14, ridgeBot - tieY - tieH, 0.16, 0.012, 1), x, (ridgeBot + tieY + tieH) / 2, RIDGE.z))
      red.push(transformed(bevelBox(0.13, 0.15, zg1 - zg0 + 0.2, 0.012, 1), x, gY + 0.075, (zg0 + zg1) / 2))
      const shape = new THREE.Shape()
      const y0 = tieY + tieH
      shape.moveTo(-HD, y0)
      shape.lineTo(HD, y0)
      for (let k = 0; k <= 40; k++) {
        const z = HD - (BODY_D * k) / 40
        shape.lineTo(z, Math.max(y0, under(z) + 0.02))
      }
      const g = new THREE.ShapeGeometry(shape)
      const pos = g.getAttribute('position')
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, x + s * 0.02, pos.getY(i), pos.getX(i))
      orient(g, v3(s, 0, 0))
      const yTop = under(RIDGE.z)
      walls.push(setWear(g, (_x, y) => clamp01((y - y0) / (yTop - y0))))
    }

    // bargeboards along the gable edges, brass at the eave ends and studs
    // along their faces, a hanging plate under the apex
    for (const s of [-1, 1]) {
      const x = s * (ROOF_HW - 0.03)
      for (const e of [EAVE_F, EAVE_B]) {
        const path: THREE.Vector3[] = []
        const z1 = e.z - Math.sign(e.z) * 0.015
        for (let k = 0; k <= 36; k++) {
          const z = RIDGE.z + ((z1 - RIDGE.z) * k) / 36
          path.push(v3(x, under(z) + 0.05 + lift(x, z), z))
        }
        const sec = chamfered(0.065, 0.34, 0.012, -0.34)
        red.push(sweep(path, sec, v3(1, 0, 0)))
        const tail: THREE.Vector3[] = []
        for (let k = 0; k <= 2; k++) {
          const z = z1 - Math.sign(e.z) * 0.05 * (1 - k / 2)
          tail.push(v3(x, under(z) + 0.05 + lift(x, z), z))
        }
        gold.push(sweep(tail, chamfered(0.071, 0.19, 0.008, -0.343), v3(1, 0, 0)))
        for (const t of [0.3, 0.6]) {
          const p = path[Math.round(t * 36)]
          const ros = lathe(
            [
              [0.064, 0],
              [0.06, 0.008],
              [0.035, 0.025],
              [0.001, 0.03],
            ],
            6,
          )
          gold.push(transformed(ros, x + s * 0.03, p.y - 0.17, p.z, 0, 0, -s * Math.PI / 2))
        }
      }
      const gg = new THREE.Shape()
      gg.moveTo(0, 0.04)
      gg.quadraticCurveTo(0.12, 0.06, 0.19, -0.04)
      gg.quadraticCurveTo(0.2, -0.16, 0.08, -0.2)
      gg.quadraticCurveTo(0.03, -0.24, 0, -0.34)
      gg.quadraticCurveTo(-0.03, -0.24, -0.08, -0.2)
      gg.quadraticCurveTo(-0.2, -0.16, -0.19, -0.04)
      gg.quadraticCurveTo(-0.12, 0.06, 0, 0.04)
      const g = new THREE.ExtrudeGeometry(gg, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 8 })
      gold.push(transformed(g, x + s * 0.035, under(RIDGE.z) - 0.2, RIDGE.z, 0, (s * Math.PI) / 2, 0))
    }
  }

  // the long front slope's own posts, its beam back to the body, the offering
  // box at the foot of the stair
  private buildFront(red: Geo[], gold: Geo[], dark: Geo[], inside: Geo[]): void {
    const plateTop = (x: number) => lowChord(x, KOHAI_Z) - RH
    const plateH = 0.15
    const kTop = plateTop(HW) - plateH - STACK
    for (const x of [-HW, HW]) {
      const g = postUv(new THREE.CylinderGeometry(POST_R, POST_R * 1.02, kTop - 0.15, 24, 16), POST_R, 1.4)
      red.push(setWear(transformed(g, x, (kTop + 0.15) / 2, KOHAI_Z), (_x, y) => 1 - clamp01((y - 0.15) / 0.35)))
      bracket(red, x, kTop, KOHAI_Z, true, false)
      // curved tie beam rising from the front post to the body
      const path: THREE.Vector3[] = []
      const ya = kTop - 0.2
      const yb = WALL_TOP - 0.45
      for (let k = 0; k <= 20; k++) {
        const t = k / 20
        const z = KOHAI_Z + 0.16 + (HD - KOHAI_Z - 0.16) * t
        path.push(v3(x, ya + (yb - ya) * t + 0.28 * Math.sin(Math.PI * Math.pow(t, 0.8)), z))
      }
      red.push(sweep(path, chamfered(0.11, 0.19, 0.014), v3(1, 0, 0)))
      gold.push(transformed(bevelBox(0.12, 0.2, 0.025, 0.004, 1), x, ya, KOHAI_Z + 0.165))
    }
    const path: THREE.Vector3[] = []
    for (let k = 0; k <= 24; k++) {
      const x = -ROOF_HW + 0.06 + ((2 * ROOF_HW - 0.12) * k) / 24
      path.push(v3(x, plateTop(x) - plateH, KOHAI_Z))
    }
    red.push(sweep(path, chamfered(0.16, plateH, 0.012, 0), v3(0, 0, 1)))
    const tY = kTop - 0.2
    red.push(transformed(bevelBox(2 * HW + 0.5, 0.17, 0.13, 0.012, 1), 0, tY + 0.085, KOHAI_Z))
    for (const s of [-1, 1]) gold.push(transformed(bevelBox(0.035, 0.18, 0.14, 0.004, 1), s * (HW + 0.25), tY + 0.085, KOHAI_Z))

    // offering box: slatted top, brass at the corners
    const bz = 4.02
    const bw = 1.15
    const bh = 0.62
    const bd = 0.5
    dark.push(transformed(bevelBox(bw, bh - 0.08, bd, 0.015, 2), 0, 0.08 + (bh - 0.08) / 2, bz))
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) dark.push(transformed(bevelBox(0.1, 0.08, 0.1, 0.01, 1), sx * (bw / 2 - 0.06), 0.04, bz + sz * (bd / 2 - 0.06)))
    dark.push(transformed(bevelBox(bw + 0.04, 0.05, bd + 0.04, 0.01, 1), 0, bh, bz))
    for (let k = 0; k < 7; k++) {
      const z = bz - bd / 2 + 0.06 + (k * (bd - 0.12)) / 6
      dark.push(transformed(bevelBox(bw - 0.08, 0.035, 0.05, 0.006, 1), 0, bh + 0.02, z, Math.PI / 4))
    }
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0.12, bh - 0.02]) gold.push(transformed(bevelBox(0.07, 0.07, 0.07, 0.006, 1), sx * (bw / 2 - 0.02), y, bz + sz * (bd / 2 - 0.02)))
      }
    }
    gold.push(transformed(bevelBox(bw + 0.006, 0.035, bd + 0.006, 0.004, 1), 0, bh - 0.12, bz))

    // bell on a brass hanger from the flying rafters
    const bellZ = 4.3
    const hang = under(bellZ) - RH
    gold.push(transformed(bevelBox(0.3, 0.02, 0.08, 0.004, 1), 0, hang - 0.01, bellZ))
    gold.push(rod(v3(0, hang - 0.01, bellZ), v3(0, hang - 0.17, bellZ), 0.008, 8))
    const by = hang - 0.32
    const R = 0.13
    const prof: P2[] = []
    for (let k = 0; k <= 20; k++) {
      const a = -Math.PI / 2 + (Math.PI * k) / 20
      let r = Math.cos(a) * R
      const y = Math.sin(a) * R
      if (Math.abs(y) < 0.012) r += 0.007
      prof.push([r, y])
    }
    gold.push(transformed(lathe(prof, 28), 0, by, bellZ))
    gold.push(transformed(new THREE.TorusGeometry(0.03, 0.009, 8, 18), 0, by + R + 0.025, bellZ))
    // the bell's mouth: a dark slot across the lower half
    inside.push(transformed(bevelBox(0.12, 0.04, 0.016, 0.004, 1), 0, by - 0.116, bellZ))
    this.ropeTop = v3(0, by - R + 0.01, bellZ)
    this.ropeY = tY - 0.03
  }

  private ropeTop = new THREE.Vector3()
  private ropeY = 0

  private buildRopes(): void {
    // shimenawa across the front posts, straw tassels and paper streamers
    const a = v3(-HW + 0.12, this.ropeY, KOHAI_Z + 0.17)
    const b = v3(HW - 0.12, this.ropeY, KOHAI_Z + 0.17)
    const sag = 0.24
    const STRAW: [number, number, number] = [0.5, 0.38, 0.17]
    const ropeParts: Geo[] = [paintAll(twistedRope(a, b, sag, 0.12, 0.045, 9), STRAW)]
    const at = (t: number) => v3(a.x + (b.x - a.x) * t, a.y - sag * 4 * t * (1 - t), a.z)
    let seed = 11
    const rnd = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    // each tassel a bundle of stalks, bound near the top, splaying and cut
    // ragged at the bottom
    for (const t of [0.3, 0.5, 0.7]) {
      const p = at(t)
      const r = 0.045 + 0.075 * Math.pow(Math.sin(Math.PI * t), 0.7)
      const ty = p.y - r * 0.55
      for (let k = 0; k < 34; k++) {
        const ang = (k / 34) * Math.PI * 2 + rnd() * 0.3
        const rr = 0.004 + rnd() * 0.013
        const len = 0.4 + rnd() * 0.08
        const spread = 0.01 + rnd() * 0.016
        const p0 = v3(p.x + Math.cos(ang) * rr, ty, p.z + Math.sin(ang) * rr)
        const p1 = v3(p.x + Math.cos(ang) * (rr + spread), ty - len, p.z + Math.sin(ang) * (rr + spread))
        const g = new THREE.CylinderGeometry(0.0055, 0.0035, 1, 5, 1)
        _q.setFromUnitVectors(UP, _c.subVectors(p0, p1).normalize())
        _m4.compose(_a.addVectors(p0, p1).multiplyScalar(0.5), _q, _b.set(1, p0.distanceTo(p1), 1))
        const k2 = 0.85 + rnd() * 0.3
        ropeParts.push(paintAll(g.applyMatrix4(_m4), [STRAW[0] * k2, STRAW[1] * k2, STRAW[2] * k2]))
      }
      ropeParts.push(paintAll(transformed(new THREE.CylinderGeometry(0.02, 0.019, 0.1, 12, 1), p.x, ty - 0.03, p.z), STRAW))
      ropeParts.push(paintAll(transformed(new THREE.TorusGeometry(0.02, 0.0045, 6, 16), p.x, ty - 0.065, p.z, Math.PI / 2, 0, 0), [STRAW[0] * 0.7, STRAW[1] * 0.7, STRAW[2] * 0.7]))
    }

    const shideAt: THREE.Vector3[] = []
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const p = at(t)
      const r = 0.045 + 0.075 * Math.pow(Math.sin(Math.PI * t), 0.7)
      shideAt.push(p.setY(p.y - r * 0.7).setZ(p.z + 0.02))
    }
    // washi: warm off-white, thin enough that the sun shows through it
    const paperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.8, 0.75, 0.62), roughness: 0.9 })
    paperMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = realmUniforms.uTime
      shader.uniforms.uWind = realmUniforms.uWind
      shader.uniforms.uGust = realmUniforms.uGust
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uGust;\n${WIND_GLSL}`)
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec4 w = modelMatrix * vec4(transformed, 1.0);
            float hang = clamp(uv.y, 0.0, 1.0);
            transformed += windSway(w.xyz, 0.1) * hang * hang;
          }`,
        )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_begin>',
        `#include <lights_fragment_begin>
        #if NUM_DIR_LIGHTS > 0
        {
          // sun from behind the sheet comes through the fibres, brightest
          // looking straight into it; the shadow is already in the colour
          float through = max(-dot(normal, directLight.direction), 0.0);
          float into = pow(max(dot(-geometryViewDir, directLight.direction), 0.0), 4.0);
          reflectedLight.directDiffuse += diffuseColor.rgb * vec3(1.0, 0.9, 0.72) * directLight.color * (through * 0.35 + into * 0.5) * RECIPROCAL_PI;
        }
        #endif`,
      )
    }
    paperMat.customProgramCacheKey = () => 'realm-shide'
    const shide = shideGeo(shideAt)
    const shideMesh = new THREE.Mesh(shide, paperMat)
    shideMesh.receiveShadow = true
    this.object.add(shideMesh)
    this.disposables.push(shide, paperMat)

    // the bell rope: a fine braid of red, white and purple, strands crossing
    // both ways round a core, a cloth tail at the bottom
    const top = this.ropeTop
    const len = top.y - 0.95
    const cols: [number, number, number][] = [
      [0.42, 0.025, 0.02],
      [0.78, 0.76, 0.7],
      [0.14, 0.03, 0.2],
    ]
    for (let s = 0; s < 6; s++) {
      const pts: THREE.Vector3[] = []
      const N = 420
      const dir = s < 3 ? 1 : -1
      for (let i = 0; i <= N; i++) {
        const t = i / N
        const th = dir * t * (len / 0.042) * Math.PI * 2 + ((s % 3) * Math.PI * 2) / 3 + (s < 3 ? 0 : Math.PI / 3)
        const r = 0.012 + 0.002 * Math.cos(th * 3)
        pts.push(v3(top.x + Math.cos(th) * r + 0.02 * t * t, top.y - len * t, top.z + Math.sin(th) * r))
      }
      ropeParts.push(paintAll(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 560, 0.0085, 6, false), cols[s % 3]))
    }
    const tail = lathe(
      [
        [0.001, 0],
        [0.03, 0.005],
        [0.034, 0.12],
        [0.024, 0.2],
        [0.001, 0.205],
      ],
      14,
    )
    ropeParts.push(paintAll(transformed(tail, top.x + 0.02, 0.95 - 0.18, top.z), cols[0]))
    const strawMat = this.strawMaterial()
    const ropeGeo = merge(ropeParts)
    const rope = new THREE.Mesh(ropeGeo, strawMat)
    rope.castShadow = true
    rope.receiveShadow = true
    this.object.add(rope)
    this.disposables.push(ropeGeo, strawMat)
  }

  // shu paint over timber: bleached and chalky where it faces the sky, grimy
  // near the ground, worn through to grey wood where hands and feet go
  private redMaterial(paint: PbrSet): THREE.MeshStandardMaterial {
    const mat = pbrMaterial(paint, { color: new THREE.Color().setRGB(0.44, 0.058, 0.017), metalness: 0, normalScale: new THREE.Vector2(0.4, 0.4) })
    mat.metalnessMap = null
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWear;\nattribute float aPaint;\nvarying float vWear;\nvarying float vPaint;\nvarying vec3 vRdP;\nvarying vec3 vRdN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWear = aWear;\nvPaint = aPaint;\nvRdP = position;\nvRdN = normal;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vWear;\nvarying float vPaint;\nvarying vec3 vRdP;\nvarying vec3 vRdN;\nfloat rdBare;\nfloat rdUp;\n${NOISE_GLSL}`)
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            float l = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            rdUp = clamp(vRdN.y, 0.0, 1.0);
            float n = nNoise(vRdP * 3.7) * 0.6 + nNoise(vRdP * 17.0) * 0.4;
            // end grain is painted yellow ochre over the same timber
            vec3 c = mix(diffuseColor.rgb, vec3(0.5, 0.31, 0.09), vPaint);
            c = mix(c, vec3(0.62, 0.25, 0.1), rdUp * (0.3 + 0.35 * n) * (1.0 - vPaint));
            c *= mix(0.55, 1.0, smoothstep(0.0, 1.4, vRdP.y));
            c *= mix(0.85, 1.08, n);
            c *= clamp(0.78 + l * 0.6, 0.82, 1.12);
            rdBare = smoothstep(0.5, 0.72, vWear * (0.55 + 0.8 * n));
            vec3 timber = vec3(0.2, 0.16, 0.115) * (0.55 + l * 1.3);
            diffuseColor.rgb = mix(c, timber, rdBare);
          #endif`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(clamp(roughnessFactor * 0.9, 0.76, 0.9) + rdUp * 0.06, 0.92, rdBare);`,
        )
    }
    // the scan's occlusion blotches read as grey stains on posts lit only by the sky
    mat.aoMapIntensity = 0.35
    mat.customProgramCacheKey = () => 'realm-shrine-shu'
    return mat
  }

  // lime plaster: rain stains running down from the beams above, splash dirt
  // at the foot
  private plasterMaterial(plaster: PbrSet): THREE.MeshStandardMaterial {
    const mat = pbrMaterial(plaster, { color: new THREE.Color().setRGB(0.93, 0.91, 0.86), metalness: 0 })
    mat.metalnessMap = null
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aWear;\nvarying float vPlH;\nvarying vec3 vPlP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPlH = aWear;\nvPlP = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying float vPlH;\nvarying vec3 vPlP;\n${NOISE_GLSL}`)
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
            float l = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            diffuseColor.rgb *= clamp(0.72 + l * 0.6, 0.75, 1.05);
          #endif
          {
            float hx = vPlP.x + vPlP.z;
            float streak = nNoise(vec3(hx * 7.0, vPlP.y * 0.7, 0.0)) * 0.7 + nNoise(vec3(hx * 23.0, vPlP.y * 1.5, 3.0)) * 0.3;
            float top = smoothstep(0.55, 1.0, vPlH) * smoothstep(0.35, 0.8, streak);
            float foot = smoothstep(0.22, 0.0, vPlH);
            float blot = nNoise(vPlP * 1.3 + 7.0);
            vec3 stain = vec3(0.62, 0.58, 0.5);
            diffuseColor.rgb *= mix(vec3(1.0), stain, clamp(top * 0.35 + foot * 0.35 + blot * 0.1, 0.0, 1.0));
          }`,
        )
    }
    mat.customProgramCacheKey = () => 'realm-shrine-plaster'
    return mat
  }

  // copper gone to verdigris: pale blue-green, streaked where rain runs down
  // the slope, darker towards the eave and beside the seams, brown where the
  // rain never reaches; standing seams every 42 cm catch the sun
  private copperMaterial(copper: PbrSet): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ map: copper.map, normalMap: copper.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.7, metalness: 0.1 })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCuP;\nvarying vec3 vCuN;\nvarying vec2 vCuUv;\nvarying vec3 vCuT;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvCuP = position;\nvCuN = normal;\nvCuUv = uv;\nvCuT = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);',
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vCuP;
          varying vec3 vCuN;
          varying vec2 vCuUv;
          varying vec3 vCuT;
          float cuShelter;
          float cuRib;
          float cuNear;
          float cuTop;
          ${NOISE_GLSL}`,
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv * 0.6);
            float l = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            vec2 q = vCuUv;
            float up = vCuN.y;
            cuTop = smoothstep(0.3, 0.6, up) * step(q.y, 15.0);
            // one continuous skin: broad tone drifts over metres, rain runs
            // long and thin straight down the slope; the thin runs and the
            // seams fade out before they can alias into bands
            float fw = max(fwidth(q.x), 1e-4);
            cuNear = 1.0 - smoothstep(0.002, 0.007, fw);
            float thinFade = 1.0 - smoothstep(0.002, 0.008, fw);
            float big = nNoise(vCuP * 0.3 + 2.0) * 0.6 + nNoise(vCuP * 0.9 + 7.0) * 0.4;
            vec3 c = mix(vec3(0.2, 0.42, 0.34), vec3(0.33, 0.56, 0.47), smoothstep(0.2, 0.8, big));
            float runs = (nNoise(vec3(q.x * 26.0, q.y * 0.28, 1.0)) * 0.65 + nNoise(vec3(q.x * 61.0, q.y * 0.5, 4.0)) * 0.35 - 0.5) * thinFade;
            float wash = nNoise(vec3(q.x * 2.2, q.y * 0.12, 5.0));
            c = mix(c, vec3(0.08, 0.18, 0.14), clamp(smoothstep(0.6, 0.95, wash) * 0.18 + max(runs, 0.0) * 1.3, 0.0, 0.6));
            c = mix(c, vec3(0.42, 0.6, 0.52), clamp(max(-runs, 0.0) * 1.0, 0.0, 0.35));
            float lane = 0.5 + runs;
            // the band just under the ridge cap stays dry: copper shows brown
            c = mix(c, vec3(0.16, 0.1, 0.05), smoothstep(0.7, 0.05, q.y) * cuTop * (0.35 + 0.3 * lane));
            float eave = max(smoothstep(${(EAVE_F.z - 1.5).toFixed(2)}, ${EAVE_F.z.toFixed(2)}, vCuP.z), smoothstep(${(EAVE_B.z + 1.0).toFixed(2)}, ${EAVE_B.z.toFixed(2)}, vCuP.z));
            c = mix(c, vec3(0.06, 0.14, 0.11), eave * (0.35 + 0.35 * lane));
            // standing seams, only close up
            float d = (fract(q.x / 0.42 + 0.5) - 0.5) * 0.42;
            float dirt = exp(-d * d / 0.0012) * cuNear;
            cuRib = exp(-d * d / 0.00012) * cuNear;
            c *= 1.0 - dirt * 0.25 * cuTop;
            c = mix(c, vec3(0.34, 0.54, 0.46), cuRib * 0.35 * cuTop);
            c = mix(c, vec3(0.07, 0.15, 0.12), (1.0 - abs(up)) * 0.35);
            cuShelter = 1.0 - smoothstep(-0.7, -0.1, up);
            vec3 brown = mix(vec3(0.17, 0.08, 0.04), vec3(0.05, 0.11, 0.08), nNoise(vCuP * 6.0));
            c = mix(c, brown, cuShelter * 0.8);
            diffuseColor.rgb = c * (0.82 + l * 0.35);
          #endif`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.74, 0.48, cuShelter * 0.8) - cuRib * cuTop * 0.15;`,
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
          metalnessFactor = mix(0.06, 0.45, cuShelter * 0.8);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            float d = (fract(vCuUv.x / 0.42 + 0.5) - 0.5) * 0.42;
            float fw = fwidth(vCuUv.x);
            float h = exp(-d * d / 0.00012);
            float slope = -2.0 * d / 0.00012 * h * 0.012;
            normal = normalize(normal - vCuT * slope * cuTop * (1.0 - smoothstep(0.002, 0.007, fw)));
          }`,
        )
    }
    mat.customProgramCacheKey = () => 'realm-copper-roof'
    return mat
  }

  private strawMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vStraw;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvStraw = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vStraw;\n${NOISE_GLSL}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // stalks run along each strand; bundles differ in age
            float fib = nNoise(vec3(vStraw.y * 160.0, vStraw.x * 30.0, 0.0)) * 0.6 + nNoise(vec3(vStraw.y * 420.0, vStraw.x * 60.0, 4.0)) * 0.4;
            float bundle = nNoise(vec3(vStraw.x * 40.0, vStraw.y * 3.0, 2.0));
            diffuseColor.rgb *= 0.5 + fib * 0.75 + bundle * 0.12;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.19, 0.15), smoothstep(0.6, 0.95, bundle) * 0.4);
          }`,
        )
    }
    mat.customProgramCacheKey = () => 'realm-straw'
    return mat
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    armTemplate?.dispose()
    armTemplate = null
  }
}
