import * as THREE from 'three'
import { SHRINE, TERRACE_Y } from './layout'
import { loadPbr, pbrMaterial, type PbrSet } from './assets'
import { paintedMaterial } from './materials'
import { bevelBox, merge, transformed, worldUv } from './geo'
import { realmUniforms, WIND_GLSL } from './atmosphere'
import type { RealmPart, Tier } from './types'

// The worship hall in the nagare style of small shrines: a raised floor on a
// granite plinth, a veranda with a low railing, vermilion posts and beams
// framing white plaster, latticed doors at the front, and a long copper
// roof whose front slope flows out over the steps. A straw rope with folded
// paper hangs across the front; a bell rope hangs over the offering box.

const BODY_W = 5.6 // between the outer post centres
const BODY_D = 3.8
const FLOOR = 0.95 // above the terrace
const WALL_TOP = 3.25 // underside of the head beam, above the terrace
const POST_R = 0.12
const RIDGE_Y = 6.05
const RIDGE_Z = -0.55 // ridge position relative to the hall centre, towards the back
const EAVE_BACK = { z: -BODY_D / 2 - 1.05, y: 3.75 }
const EAVE_FRONT = { z: BODY_D / 2 + 2.35, y: 3.05 }
const ROOF_HALF_W = BODY_W / 2 + 1.15
const ROOF_T = 0.22 // thickness of the eave edge

// a curved roof slope from the ridge down to an eave; concave, steep at the
// ridge and nearly flat at the eave
function slope(z0: number, y0: number, z1: number, y1: number, halfW: number, segs: number, top: boolean): THREE.BufferGeometry {
  const xs = 24
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  let along = 0
  let prevY = y0
  let prevZ = z0
  for (let j = 0; j <= segs; j++) {
    const s = j / segs
    const f = 1 - Math.pow(1 - s, 1.7)
    const z = z0 + (z1 - z0) * s
    const y = y0 + (y1 - y0) * f - (top ? 0 : ROOF_T * (0.35 + 0.65 * s))
    if (j > 0) along += Math.hypot(z - prevZ, y - prevY)
    prevY = y
    prevZ = z
    for (let i = 0; i <= xs; i++) {
      const u = i / xs
      const x = -halfW + u * halfW * 2
      // the eave line lifts a little towards the corners
      const lift = Math.pow(Math.abs(u * 2 - 1), 3) * 0.12 * s
      pos.push(x, y + lift, z)
      uv.push(x, along)
    }
  }
  const front = z1 > z0
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < xs; i++) {
      const a = j * (xs + 1) + i
      const b = a + xs + 1
      const up = front !== top
      if (up) index.push(a, a + 1, b, a + 1, b + 1, b)
      else index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// the thick eave fascia along a slope's lower edge
function fascia(z: number, y: number, halfW: number): THREE.BufferGeometry {
  const xs = 24
  const pos: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (let i = 0; i <= xs; i++) {
    const u = i / xs
    const x = -halfW + u * halfW * 2
    const lift = Math.pow(Math.abs(u * 2 - 1), 3) * 0.12
    pos.push(x, y + lift, z, x, y + lift - ROOF_T, z)
    uv.push(x, 0, x, ROOF_T)
  }
  for (let i = 0; i < xs; i++) {
    const a = i * 2
    if (z > 0) index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3)
    else index.push(a, a + 2, a + 1, a + 2, a + 3, a + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// gable end: the triangular board under the roof edge at x = side * halfW
function gable(side: -1 | 1, halfW: number): THREE.BufferGeometry {
  const segs = 16
  const pts: [number, number][] = []
  for (let j = 0; j <= segs; j++) {
    const s = j / segs
    const f = 1 - Math.pow(1 - s, 1.7)
    pts.push([RIDGE_Z + (EAVE_BACK.z - RIDGE_Z) * s, RIDGE_Y + (EAVE_BACK.y - RIDGE_Y) * f - ROOF_T])
  }
  const back = pts.slice()
  const frontPts: [number, number][] = []
  for (let j = 0; j <= segs; j++) {
    const s = j / segs
    const f = 1 - Math.pow(1 - s, 1.7)
    frontPts.push([RIDGE_Z + (EAVE_FRONT.z - RIDGE_Z) * s, RIDGE_Y + (EAVE_FRONT.y - RIDGE_Y) * f - ROOF_T])
  }
  // fill between the two slope lines down to the head beam, inside the walls
  const shape = new THREE.Shape()
  const clampZ = (z: number) => Math.max(-BODY_D / 2, Math.min(BODY_D / 2, z))
  shape.moveTo(clampZ(back[back.length - 1][0]), WALL_TOP)
  for (let j = back.length - 1; j >= 0; j--) {
    const [z, y] = back[j]
    if (z >= -BODY_D / 2) shape.lineTo(z, Math.max(y, WALL_TOP))
  }
  for (const [z, y] of frontPts) if (z <= BODY_D / 2) shape.lineTo(z, Math.max(y, WALL_TOP))
  shape.lineTo(BODY_D / 2, WALL_TOP)
  const geo = new THREE.ShapeGeometry(shape)
  // shape is in (z, y); turn it into the x = side plane
  const p = geo.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const z = p.getX(i)
    const y = p.getY(i)
    p.setXYZ(i, side * halfW, y, z)
  }
  if (side < 0 && geo.index) geo.setIndex(Array.from(geo.index.array).reverse())
  geo.computeVertexNormals()
  return geo
}

function post(x: number, z: number, bottom: number, top: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(POST_R, POST_R, top - bottom, 20, 1)
  return transformed(g, x, (top + bottom) / 2, z)
}

// a sagging rope along a catenary between two points, thicker in the middle
function rope(a: THREE.Vector3, b: THREE.Vector3, sag: number, r0: number, r1: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = []
  const n = 24
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const p = a.clone().lerp(b, t)
    p.y -= sag * 4 * t * (1 - t)
    pts.push(p)
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  const geo = new THREE.TubeGeometry(curve, 64, 1, 12, false)
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const uv = geo.getAttribute('uv')
  // radius 1 tube scaled per ring: a tapered rope
  const centers = curve.getSpacedPoints(64)
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i)
    const ring = Math.round(u * 64)
    const c = centers[Math.min(ring, 64)]
    const r = r1 + (r0 - r1) * Math.sin(Math.PI * u)
    pos.setXYZ(i, c.x + nor.getX(i) * r, c.y + nor.getY(i) * r, c.z + nor.getZ(i) * r)
  }
  geo.computeVertexNormals()
  return geo
}

// a folded paper streamer: four steps zig-zagging down
function shide(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const w = 0.06
  const h = 0.085
  for (let i = 0; i < 4; i++) {
    const g = new THREE.PlaneGeometry(w, h)
    g.translate((i % 2 === 0 ? 0 : w * 0.5) - w * 0.25, -h / 2 - i * h * 0.95, 0)
    parts.push(g)
  }
  return merge(parts)
}

export class Shrine implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []
  private paperMat: THREE.MeshStandardMaterial

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
    const red: THREE.BufferGeometry[] = []
    const wood: THREE.BufferGeometry[] = []
    const dark: THREE.BufferGeometry[] = []
    const inside: THREE.BufferGeometry[] = []
    const walls: THREE.BufferGeometry[] = []
    const roofTop: THREE.BufferGeometry[] = []
    const roofUnder: THREE.BufferGeometry[] = []
    const stoneParts: THREE.BufferGeometry[] = []

    // granite plinth
    stoneParts.push(transformed(bevelBox(BODY_W + 2.0, 0.5, BODY_D + 2.0, 0.03, 2), 0, 0.2, 0))
    // floor and veranda
    wood.push(transformed(bevelBox(BODY_W + 1.5, 0.09, BODY_D + 1.4, 0.01, 1), 0, FLOOR - 0.045, 0.1))
    // posts: 4 x 3 grid, plus veranda posts carrying the long front eave
    const bayX = BODY_W / 3
    for (let i = 0; i <= 3; i++) {
      for (const z of [-BODY_D / 2, 0, BODY_D / 2]) {
        const x = -BODY_W / 2 + i * bayX
        if (z === 0 && i > 0 && i < 3) continue
        red.push(post(x, z, 0.45, WALL_TOP + 0.3))
      }
      // under-floor posts on the plinth
      red.push(post(-BODY_W / 2 + i * bayX, BODY_D / 2 + 0.7, 0.45, FLOOR))
    }
    for (const x of [-BODY_W / 2, BODY_W / 2]) red.push(post(x, BODY_D / 2 + 1.75, 0.0, 3.0))
    // head beams (nageshi) around the body and the front tie beam
    const beam = (len: number, x: number, y: number, z: number, along: 'x' | 'z') =>
      transformed(bevelBox(along === 'x' ? len : 0.16, 0.24, along === 'x' ? 0.16 : len, 0.01, 1), x, y, z)
    for (const z of [-BODY_D / 2, BODY_D / 2]) red.push(beam(BODY_W + 0.5, 0, WALL_TOP + 0.12, z, 'x'))
    for (const x of [-BODY_W / 2, BODY_W / 2]) red.push(beam(BODY_D + 0.3, x, WALL_TOP + 0.12, 0, 'z'))
    red.push(beam(BODY_W + 0.5, 0, 2.75, BODY_D / 2 + 1.75, 'x'))
    for (const x of [-BODY_W / 2, BODY_W / 2]) red.push(beam(1.75, x, 2.75, BODY_D / 2 + 0.9, 'z'))
    // lower rail (nuki) between posts
    for (const z of [-BODY_D / 2, BODY_D / 2]) red.push(beam(BODY_W, 0, FLOOR + 0.18, z, 'x'))
    // bracket blocks on the post heads
    for (let i = 0; i <= 3; i++) {
      for (const z of [-BODY_D / 2, BODY_D / 2]) {
        wood.push(transformed(bevelBox(0.3, 0.16, 0.3, 0.01, 1), -BODY_W / 2 + i * bayX, WALL_TOP + 0.32, z))
      }
    }

    // plaster walls: back, sides; the front gets latticed doors
    const wall = (w: number, h: number, x: number, y: number, z: number, ry: number) =>
      transformed(new THREE.PlaneGeometry(w, h), x, y, z, 0, ry, 0)
    const wallH = WALL_TOP - FLOOR - 0.06
    for (let i = 0; i < 3; i++) {
      walls.push(wall(bayX - 0.22, wallH, -BODY_W / 2 + bayX * (i + 0.5), FLOOR + wallH / 2, -BODY_D / 2 + 0.02, Math.PI))
    }
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        walls.push(wall(BODY_D / 2 - 0.22, wallH, side * (BODY_W / 2 - 0.02), FLOOR + wallH / 2, -BODY_D / 4 + k * (BODY_D / 2), side * Math.PI / 2))
      }
    }
    // the interior seen through the lattice: a deep shadow
    inside.push(wall(BODY_W - 0.2, wallH, 0, FLOOR + wallH / 2, BODY_D / 2 - 0.5, 0))
    // lattice doors in each front bay
    for (let i = 0; i < 3; i++) {
      const cx = -BODY_W / 2 + bayX * (i + 0.5)
      const w = bayX - 0.24
      const z = BODY_D / 2 - 0.05
      red.push(transformed(bevelBox(w, 0.08, 0.06, 0.006, 1), cx, FLOOR + 0.1, z))
      red.push(transformed(bevelBox(w, 0.08, 0.06, 0.006, 1), cx, WALL_TOP - 0.1, z))
      const bars = 9
      for (let b = 0; b <= bars; b++) {
        red.push(transformed(bevelBox(0.03, wallH - 0.12, 0.035, 0.004, 1), cx - w / 2 + (w * b) / bars, FLOOR + wallH / 2, z))
      }
      for (let r = 1; r < 7; r++) {
        red.push(transformed(bevelBox(w, 0.025, 0.03, 0.004, 1), cx, FLOOR + 0.1 + ((wallH - 0.2) * r) / 7, z))
      }
    }
    // veranda railing on the front and sides
    const railY = FLOOR + 0.52
    for (const side of [-1, 1]) {
      red.push(transformed(bevelBox(0.07, 0.07, BODY_D + 1.2, 0.01, 1), side * (BODY_W / 2 + 0.72), railY, 0.1))
      for (let k = 0; k < 5; k++) {
        red.push(post(side * (BODY_W / 2 + 0.72), -BODY_D / 2 + 0.1 + (k * (BODY_D + 1.0)) / 4, FLOOR, railY))
      }
    }
    for (const side of [-1, 1]) {
      red.push(transformed(bevelBox(BODY_W / 2 - 0.9, 0.07, 0.07, 0.01, 1), side * (BODY_W / 4 + 0.82), railY, BODY_D / 2 + 0.78))
    }
    // wooden steps up to the veranda, under the long front eave
    const stepW = 2.3
    for (let s = 0; s < 4; s++) {
      const y = 0.45 + ((FLOOR - 0.45) * (s + 1)) / 4
      wood.push(transformed(bevelBox(stepW, 0.06, 0.3, 0.008, 1), 0, y - 0.03, BODY_D / 2 + 0.7 + 0.28 * (3 - s) + 0.1))
    }
    for (const side of [-1, 1]) {
      red.push(transformed(bevelBox(0.09, 0.6, 1.25, 0.01, 1), side * (stepW / 2 + 0.05), 0.68, BODY_D / 2 + 1.35, 0, 0, 0))
    }
    // offering box at the foot of the steps
    wood.push(transformed(bevelBox(1.1, 0.6, 0.55, 0.012, 2), 0, 0.3 + 0.0, BODY_D / 2 + 2.25))
    for (let k = 0; k < 6; k++) {
      wood.push(transformed(bevelBox(1.04, 0.035, 0.06, 0.004, 1), 0, 0.62, BODY_D / 2 + 2.05 + k * 0.08, Math.PI / 5))
    }

    // the roof
    roofTop.push(slope(RIDGE_Z, RIDGE_Y, EAVE_FRONT.z, EAVE_FRONT.y, ROOF_HALF_W, 40, true))
    roofTop.push(slope(RIDGE_Z, RIDGE_Y, EAVE_BACK.z, EAVE_BACK.y, ROOF_HALF_W, 24, true))
    roofUnder.push(slope(RIDGE_Z, RIDGE_Y, EAVE_FRONT.z, EAVE_FRONT.y, ROOF_HALF_W, 40, false))
    roofUnder.push(slope(RIDGE_Z, RIDGE_Y, EAVE_BACK.z, EAVE_BACK.y, ROOF_HALF_W, 24, false))
    roofTop.push(fascia(EAVE_FRONT.z, EAVE_FRONT.y, ROOF_HALF_W))
    roofTop.push(fascia(EAVE_BACK.z, EAVE_BACK.y, ROOF_HALF_W))
    // ridge cap
    roofTop.push(transformed(bevelBox(ROOF_HALF_W * 2 + 0.1, 0.22, 0.42, 0.04, 2), 0, RIDGE_Y + 0.05, RIDGE_Z))
    // gable boards, dark timber
    dark.push(gable(-1, BODY_W / 2 + 0.02), gable(1, BODY_W / 2 + 0.02))
    // rafters under the eaves
    for (let k = 0; k <= 30; k++) {
      const x = -ROOF_HALF_W + 0.25 + (k * (ROOF_HALF_W * 2 - 0.5)) / 30
      for (const [z1, y1] of [
        [EAVE_FRONT.z - 0.1, EAVE_FRONT.y - ROOF_T - 0.04],
        [EAVE_BACK.z + 0.1, EAVE_BACK.y - ROOF_T - 0.04],
      ]) {
        const z0 = z1 > 0 ? BODY_D / 2 + 0.1 : -BODY_D / 2 - 0.1
        const len = Math.abs(z1 - z0)
        const y0 = WALL_TOP + 0.45
        const g = bevelBox(0.07, 0.09, len, 0.008, 1)
        const ang = Math.atan2(y0 - y1, len) * (z1 > 0 ? 1 : -1)
        dark.push(transformed(g, x, (y0 + y1) / 2, (z0 + z1) / 2, ang, 0, 0))
      }
    }

    const vermilion = new THREE.Color('#c64329').convertSRGBToLinear()
    const redMat = paintedMaterial(paint, vermilion, { roughness: 0.8, metalness: 0 })
    redMat.metalnessMap = null
    const woodMat = pbrMaterial(cedar, { color: new THREE.Color(0.78, 0.66, 0.52), metalness: 0 })
    woodMat.metalnessMap = null
    const darkMat = pbrMaterial(aged, { color: new THREE.Color(0.22, 0.17, 0.13), metalness: 0 })
    darkMat.metalnessMap = null
    const wallMat = pbrMaterial(plaster, { color: new THREE.Color(0.95, 0.94, 0.9), metalness: 0 })
    wallMat.metalnessMap = null
    const interiorMat = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 1 })
    const copperMat = this.copperMaterial(copper)
    const underMat = pbrMaterial(aged, { color: new THREE.Color(0.2, 0.15, 0.11), metalness: 0, side: THREE.DoubleSide })
    underMat.metalnessMap = null
    const stoneMat = pbrMaterial(stone, { color: new THREE.Color(0.78, 0.77, 0.74), metalness: 0 })
    stoneMat.metalnessMap = null

    const groups: [THREE.BufferGeometry[], THREE.Material, number][] = [
      [red, redMat, 1.4],
      [wood, woodMat, 1.6],
      [walls, wallMat, 2.2],
      [stoneParts, stoneMat, 1.2],
      [roofTop, copperMat, 0],
      [roofUnder, underMat, 0],
      [inside, interiorMat, 1],
    ]
    for (const [parts, mat, uvScale] of groups) {
      const geo = merge(uvScale > 0 ? parts.map((g) => worldUv(g, uvScale)) : parts)
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.object.add(mesh)
      this.disposables.push(geo, mat)
    }
    const darkGeo = merge(dark.map((g) => worldUv(g, 1.6)))
    const darkMesh = new THREE.Mesh(darkGeo, darkMat)
    darkMesh.castShadow = true
    darkMesh.receiveShadow = true
    this.object.add(darkMesh)
    this.disposables.push(darkGeo, darkMat)

    // shimenawa across the front, below the front tie beam
    const strawMat = this.strawMaterial()
    const ropeGeo = rope(new THREE.Vector3(-BODY_W / 2 + 0.1, 2.55, BODY_D / 2 + 1.85), new THREE.Vector3(BODY_W / 2 - 0.1, 2.55, BODY_D / 2 + 1.85), 0.38, 0.1, 0.045)
    const ropeMesh = new THREE.Mesh(ropeGeo, strawMat)
    ropeMesh.castShadow = true
    this.object.add(ropeMesh)
    this.disposables.push(ropeGeo, strawMat)

    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.85, side: THREE.DoubleSide })
    this.paperMat.onBeforeCompile = (shader) => {
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
            float hang = clamp(-position.y / 0.34, 0.0, 1.0);
            transformed += windSway(w.xyz, 0.12) * hang * hang;
          }`,
        )
    }
    this.paperMat.customProgramCacheKey = () => 'realm-shide'
    const shideGeo = shide()
    for (const u of [-0.36, -0.12, 0.12, 0.36]) {
      const m = new THREE.Mesh(shideGeo, this.paperMat)
      const x = u * BODY_W
      const t = x / (BODY_W - 0.2) + 0.5
      m.position.set(x, 2.55 - 0.42 * 4 * t * (1 - t) - 0.06, BODY_D / 2 + 1.85)
      this.object.add(m)
    }
    this.disposables.push(shideGeo, this.paperMat)

    // the bell and its rope over the offering box
    const bronze = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.55, 0.42, 0.2), metalness: 1, roughness: 0.38 })
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), bronze)
    bell.position.set(0, 2.5, BODY_D / 2 + 1.95)
    bell.castShadow = true
    this.object.add(bell)
    const bellRopeGeo = new THREE.CylinderGeometry(0.035, 0.04, 1.55, 12, 16)
    bellRopeGeo.translate(0, 2.32 - 0.78, BODY_D / 2 + 1.95)
    const bellRopeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
    bellRopeMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vRopeY;\nvarying float vRopeA;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRopeY = position.y;\nvRopeA = atan(position.z - ' + (BODY_D / 2 + 1.95).toFixed(3) + ', position.x);')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vRopeY;\nvarying float vRopeA;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // a braid of red, white and purple strands
            float s = fract(vRopeY * 9.0 + vRopeA / 6.2831 * 3.0);
            vec3 c = s < 0.33 ? vec3(0.55, 0.05, 0.04) : s < 0.66 ? vec3(0.85, 0.83, 0.8) : vec3(0.2, 0.06, 0.25);
            diffuseColor.rgb *= c;
          }`,
        )
    }
    bellRopeMat.customProgramCacheKey = () => 'realm-bell-rope'
    const bellRope = new THREE.Mesh(bellRopeGeo, bellRopeMat)
    this.object.add(bellRope)
    this.disposables.push(bell.geometry, bronze, bellRopeGeo, bellRopeMat)

    this.object.position.set(SHRINE.x, TERRACE_Y, SHRINE.z)
    this.object.rotation.y = SHRINE.rotation
  }

  // copper gone green: the scan supplies the grain, the shader the patina,
  // the standing seams down the slope and darker streaks where water runs
  private copperMaterial(copper: PbrSet): THREE.MeshStandardMaterial {
    const mat = pbrMaterial(copper, { color: new THREE.Color(1, 1, 1), metalness: 0.2, roughness: 0.75 })
    mat.metalnessMap = null
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vRoof;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoof = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vRoof;
          float rHash(float n) { return fract(sin(n) * 43758.5453); }`,
        )
        .replace(
          '#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vMapUv * 0.5);
            float l = dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float lane = floor(vRoof.x / 0.42);
            float streak = smoothstep(0.3, 0.9, rHash(lane * 7.1)) * smoothstep(0.0, 2.5, vRoof.y);
            vec3 patina = mix(vec3(0.24, 0.47, 0.40), vec3(0.36, 0.58, 0.52), rHash(lane * 3.7));
            patina = mix(patina, vec3(0.12, 0.2, 0.17), streak * 0.5);
            diffuseColor.rgb *= patina * (0.8 + l * 0.45);
          #endif`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            // standing seams every 42 cm, raised ribs that catch the sun
            float fx = fract(vRoof.x / 0.42);
            float rib = smoothstep(0.0, 0.04, fx) - smoothstep(0.04, 0.08, fx);
            vec3 dx = dFdx(vViewPosition);
            vec3 dy = dFdy(vViewPosition);
            float rx = dFdx(rib);
            float ry = dFdy(rib);
            normal = normalize(normal - (rx * normalize(cross(dy, normal)) + ry * normalize(cross(normal, dx))) * 0.6);
          }`,
        )
    }
    mat.customProgramCacheKey = () => 'realm-copper-roof'
    return mat
  }

  private strawMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.42, 0.33, 0.16), roughness: 0.95 })
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vStraw;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvStraw = uv;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vStraw;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // a left-hand twist of straw bundles
            float tw = fract(vStraw.x * 60.0 + vStraw.y * 3.0);
            float grain = fract(vStraw.x * 900.0 + vStraw.y * 41.0);
            diffuseColor.rgb *= 0.7 + 0.35 * smoothstep(0.0, 0.5, tw) * smoothstep(1.0, 0.5, tw) + grain * 0.08;
          }`,
        )
    }
    mat.customProgramCacheKey = () => 'realm-straw'
    return mat
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
