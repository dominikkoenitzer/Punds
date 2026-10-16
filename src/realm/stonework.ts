import * as THREE from 'three'
import {
  rng,
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
import { bevelBox, merge, tint, transformed, worldUv } from './geo'
import { loadPbr, pbrMaterial } from './assets'
import type { RealmPart, Tier } from './types'

// Cut granite: the paved approach in a running bond, kerbs that hold the
// gravel, the steps up to the shrine terrace and the dry stone wall that
// carries it. Every slab is its own piece with its own tint, height and a
// hair of rotation, so the paving reads as laid by hand.

const JOINT = 0.014
const SLAB_T = 0.16

interface Slab {
  x: number
  z: number
  w: number // across (x)
  d: number // along (z)
  y: number // top surface
}

function slabGeometry(s: Slab, rand: () => number): THREE.BufferGeometry {
  const g = bevelBox(s.w - JOINT, SLAB_T, s.d - JOINT, 0.018, 2)
  transformed(
    g,
    s.x,
    s.y - SLAB_T / 2 + (rand() - 0.5) * 0.006,
    s.z,
    (rand() - 0.5) * 0.006,
    (rand() - 0.5) * 0.008,
    (rand() - 0.5) * 0.006,
  )
  worldUv(g, 1.3, rand() * 7, rand() * 7)
  const v = 0.84 + rand() * 0.2
  const warm = (rand() - 0.5) * 0.05
  return tint(g, v + warm, v, v - warm)
}

// a band of rows between z0 (front, larger z) and z1, `half` either side of
// x = 0, alternating two halves and a centred slab with quarters
function pavedRun(z0: number, z1: number, half: number, rand: () => number, level: (z: number) => number): Slab[] {
  const out: Slab[] = []
  let z = z0
  let row = 0
  const width = half * 2
  while (z > z1 + 0.2) {
    const d = Math.min(0.44 + rand() * 0.1, z - z1)
    const cz = z - d / 2
    const y = level(cz)
    if (row % 2 === 0) {
      const split = (rand() - 0.5) * 0.18
      out.push({ x: -half / 2 + split / 2, z: cz, w: half + split, d, y })
      out.push({ x: half / 2 + split / 2, z: cz, w: half - split, d, y })
    } else {
      const q = width * (0.24 + rand() * 0.04)
      out.push({ x: -half + q / 2, z: cz, w: q, d, y })
      out.push({ x: 0, z: cz, w: width - q * 2, d, y })
      out.push({ x: half - q / 2, z: cz, w: q, d, y })
    }
    z -= d
    row++
  }
  return out
}

// the landing: larger slabs laid in staggered courses across its width
function landing(rand: () => number): Slab[] {
  const out: Slab[] = []
  let z = LANDING.zFront
  let row = 0
  while (z > LANDING.zBack + 0.05) {
    const d = Math.min(0.6 + rand() * 0.12, z - LANDING.zBack)
    const cz = z - d / 2
    let x = -LANDING.halfWidth
    const offset = row % 2 === 0 ? 0 : 0.45
    let first = true
    while (x < LANDING.halfWidth - 0.05) {
      let w = 0.85 + rand() * 0.35
      if (first) w -= offset
      first = false
      w = Math.min(w, LANDING.halfWidth - x)
      out.push({ x: x + w / 2, z: cz, w, d, y: 0.035 })
      x += w
    }
    z -= d
    row++
  }
  return out
}

function kerbRun(x: number, z0: number, z1: number, rand: () => number, top: number, width = 0.17): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  let z = z0
  while (z > z1 + 0.1) {
    const len = Math.min(1.2 + rand() * 0.7, z - z1)
    const g = bevelBox(width, 0.26, len - JOINT, 0.02, 2)
    transformed(g, x, top - 0.13, z - len / 2, 0, (rand() - 0.5) * 0.006, 0)
    worldUv(g, 1.1, rand() * 9, rand() * 9)
    const v = 0.78 + rand() * 0.16
    out.push(tint(g, v, v, v * 0.98))
    z -= len
  }
  return out
}

function kerbAcross(z: number, x0: number, x1: number, rand: () => number, top: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  let x = x0
  while (x < x1 - 0.1) {
    const len = Math.min(1.2 + rand() * 0.6, x1 - x)
    const g = bevelBox(len - JOINT, 0.26, 0.17, 0.02, 2)
    transformed(g, x + len / 2, top - 0.13, z, 0, (rand() - 0.5) * 0.006, 0)
    worldUv(g, 1.1, rand() * 9, rand() * 9)
    const v = 0.78 + rand() * 0.16
    out.push(tint(g, v, v, v * 0.98))
    x += len
  }
  return out
}

function steps(rand: () => number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const rise = TERRACE_Y / STEPS.count
  const tread = (STEPS.zFront - STEPS.zBack) / STEPS.count
  for (let i = 0; i < STEPS.count; i++) {
    const top = rise * (i + 1)
    const zf = STEPS.zFront - tread * i
    // each step is two or three long blocks, the joint never in the middle
    const cuts = i % 2 === 0 ? [-STEPS.halfWidth, -0.35, STEPS.halfWidth] : [-STEPS.halfWidth, 0.42, STEPS.halfWidth]
    for (let c = 0; c < cuts.length - 1; c++) {
      const x0 = cuts[c]
      const x1 = cuts[c + 1]
      const depth = tread + 0.25
      const h = rise + 0.12
      const g = bevelBox(x1 - x0 - JOINT, h, depth, 0.022, 2)
      transformed(g, (x0 + x1) / 2, top - h / 2, zf - depth / 2 + 0.02, 0, (rand() - 0.5) * 0.004, 0)
      worldUv(g, 1.3, rand() * 9, rand() * 9)
      const v = 0.8 + rand() * 0.16
      out.push(tint(g, v, v, v * 0.98))
    }
    // the cheek stones either side
    for (const side of [-1, 1]) {
      const g = bevelBox(0.34, top + 0.35, tread + 0.02, 0.025, 2)
      transformed(g, side * (STEPS.halfWidth + 0.17), (top - 0.35) / 2 + 0.17, zf - tread / 2, 0, 0, 0)
      worldUv(g, 1.3, rand() * 9, rand() * 9)
      const v = 0.76 + rand() * 0.12
      out.push(tint(g, v, v, v))
    }
  }
  return out
}

// The terrace wall: a battered face between the lawn and the terrace edge,
// broken by the steps. One strip per side, following the rim where it ends.
function wallFace(side: -1 | 1): THREE.BufferGeometry {
  const x0 = side * (STEPS.halfWidth + 0.34)
  let x1 = x0
  const z = TERRACE_FRONT_Z
  while (islandSdf(x1 + side * 0.2, z) > 0.6) x1 += side * 0.2
  const cols = Math.max(2, Math.round(Math.abs(x1 - x0) / 0.25))
  const rows = 8
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (let i = 0; i <= cols; i++) {
    const x = x0 + ((x1 - x0) * i) / cols
    const bottom = Math.min(groundHeight(x, z + 0.6), 0) - 0.35
    for (let j = 0; j <= rows; j++) {
      const f = j / rows
      const y = bottom + (TERRACE_Y + 0.02 - bottom) * f
      // batter: the face leans back as it rises
      const zz = z + 0.32 - f * 0.28
      pos.push(x, y, zz)
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

function wallCaps(side: -1 | 1, rand: () => number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = []
  const z = TERRACE_FRONT_Z
  let x = side * (STEPS.halfWidth + 0.34)
  while (islandSdf(x + side * 0.6, z) > 0.8) {
    const len = 0.8 + rand() * 0.6
    const g = bevelBox(len - JOINT, 0.16, 0.5, 0.03, 2)
    transformed(g, x + (side * len) / 2, TERRACE_Y + 0.06, z + 0.05, 0, (rand() - 0.5) * 0.01, 0)
    worldUv(g, 1.2, rand() * 9, rand() * 9)
    const v = 0.74 + rand() * 0.14
    out.push(tint(g, v, v, v))
    x += side * len
  }
  return out
}

export class Stonework implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Stonework> {
    const [stone, wall] = await Promise.all([loadPbr('stone', tier), loadPbr('wall', tier)])
    return new Stonework(stone, wall)
  }

  private constructor(stone: Awaited<ReturnType<typeof loadPbr>>, wall: Awaited<ReturnType<typeof loadPbr>>) {
    const rand = rng(7)
    const lower = (cz: number) => groundHeight(0, cz) + 0.035
    const slabs: Slab[] = [
      ...landing(rand),
      ...pavedRun(LANDING.zBack, STEPS.zFront, PATH_HALF_WIDTH, rand, lower),
      ...pavedRun(STEPS.zBack, SHRINE.z + SHRINE.depth / 2 + 0.6, PATH_HALF_WIDTH, rand, () => TERRACE_Y + 0.035),
    ]
    const pieces: THREE.BufferGeometry[] = slabs.map((s) => slabGeometry(s, rand))

    // kerbs along the path and the gravel's outer edge
    const pathTop = 0.06
    for (const side of [-1, 1]) {
      pieces.push(...kerbRun(side * (PATH_HALF_WIDTH + 0.085), LANDING.zBack, STEPS.zFront + 0.02, rand, pathTop))
      pieces.push(...kerbRun(side * (GRAVEL_HALF_WIDTH + 0.085), LANDING.zBack, STEPS.zFront + 0.3, rand, pathTop - 0.01))
      pieces.push(
        ...kerbRun(side * (PATH_HALF_WIDTH + 0.085), STEPS.zBack, SHRINE.z + SHRINE.depth / 2 + 0.6, rand, TERRACE_Y + 0.06),
      )
    }
    pieces.push(...kerbAcross(LANDING.zBack - 0.085, -GRAVEL_HALF_WIDTH - 0.17, -PATH_HALF_WIDTH - 0.17, rand, pathTop))
    pieces.push(...kerbAcross(LANDING.zBack - 0.085, PATH_HALF_WIDTH + 0.17, GRAVEL_HALF_WIDTH + 0.17, rand, pathTop))
    pieces.push(...steps(rand))
    pieces.push(...wallCaps(-1, rand), ...wallCaps(1, rand))

    const stoneGeo = merge(pieces)
    const stoneMat = pbrMaterial(stone, { vertexColors: true })
    const stoneMesh = new THREE.Mesh(stoneGeo, stoneMat)
    stoneMesh.castShadow = true
    stoneMesh.receiveShadow = true

    const wallGeo = merge([wallFace(-1), wallFace(1)])
    const wallMat = pbrMaterial(wall, { color: new THREE.Color(0.9, 0.9, 0.88) })
    const wallMesh = new THREE.Mesh(wallGeo, wallMat)
    wallMesh.castShadow = true
    wallMesh.receiveShadow = true

    this.object.add(stoneMesh, wallMesh)
    this.disposables.push(stoneGeo, stoneMat, wallGeo, wallMat)
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
