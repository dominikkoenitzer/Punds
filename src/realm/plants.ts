import * as THREE from 'three'
import { realmUniforms, SUN_DIRECTION, WIND_GLSL } from './atmosphere'
import { loadPbr } from './assets'
import {
  AZALEAS,
  GRAVEL_HALF_WIDTH,
  CHERRY,
  LANTERNS,
  STEPS,
  TERRACE_FRONT_Z,
  POND_BOUNDS,
  fbm2,
  gravelWeight,
  groundHeight,
  islandSdf,
  pathWeight,
  pondSdf,
  rng,
} from './layout'
import type { RealmPart, Tier } from './types'

// The clipped azalea mounds (karikomi) and the understory: ferns in the damp
// shade by the pond and the terrace wall, moss cushions at the feet of the
// lanterns and along the wall. Each mound is a dark lumpy shell under
// thousands of small leaf and flower cards; the cards carry the dome's normal
// so the clipped mass shades as one soft volume while its edge stays leafy.

interface TierSpec {
  cardsPerM2: number
  cardScale: number
  atlas: number
  ferns: number
  shellSegments: number
  frondSegments: number
}

const TIERS: Record<Tier, TierSpec> = {
  ultra: { cardsPerM2: 260, cardScale: 1, atlas: 1024, ferns: 1, shellSegments: 56, frondSegments: 9 },
  high: { cardsPerM2: 210, cardScale: 1.08, atlas: 1024, ferns: 0.85, shellSegments: 48, frondSegments: 8 },
  phone: { cardsPerM2: 95, cardScale: 1.45, atlas: 512, ferns: 0.55, shellSegments: 32, frondSegments: 6 },
}

// flower colours per mound, in the order of AZALEAS
const BLOOMS = ['#d42a7e', '#f0725c', '#d42a7e', '#f3efe8', '#c9277a', '#f3efe8', '#ee6a58', '#d42a7e', '#f0725c']

// --- the mound surface -------------------------------------------------------

interface Mound {
  x: number
  z: number
  r: number
  h: number
  base: number
}

const mounds: Mound[] = AZALEAS.map((a) => ({ ...a, base: groundHeight(a.x, a.z) - 0.04 }))

// The clipped surface along unit direction (dx, dy, dz) of the upper
// hemisphere: an ellipsoid with a full shoulder, pushed in and out by a world
// space noise so neighbouring mounds agree where they meet.
function surface(m: Mound, dx: number, dy: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
  const up = Math.max(dy, -0.25)
  const yk = up >= 0 ? Math.pow(up, 0.82) : up
  const px = m.x + dx * m.r
  const pz = m.z + dz * m.r
  const py = m.base + yk * m.h
  const lump = (fbm2(px * 1.25 + py * 1.1 + 3.1, pz * 1.25 - py * 0.9 - 7.4, 3) - 0.5) * 0.34 +
    (fbm2(px * 3.6 - 2.2, pz * 3.6 + py * 2.7 + 1.7, 2) - 0.5) * 0.1
  const k = 1 + lump
  out.set(m.x + dx * m.r * k, m.base + yk * m.h * k, m.z + dz * m.r * k)
  // the foot follows the lawn but never climbs the terrace wall behind
  const g = groundHeight(out.x, out.z)
  const foot = Math.min(Math.max(g, m.base - 0.15), m.base + 0.12) - 0.04
  if (dy < 0.15) out.y = Math.max(out.y, foot + (out.y - m.base) * 0.4)
  return out
}

function moundNormal(m: Mound, dx: number, dy: number, dz: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(dx / m.r, Math.max(dy, 0) / m.h + 0.15, dz / m.r).normalize()
}

// inside some other mound's volume: cards there would be buried in the merge
function buried(self: number, p: THREE.Vector3): boolean {
  for (let i = 0; i < mounds.length; i++) {
    if (i === self) continue
    const m = mounds[i]
    const qx = (p.x - m.x) / m.r
    const qz = (p.z - m.z) / m.r
    const qy = Math.max(p.y - m.base, 0) / m.h
    if (qx * qx + qz * qz + qy * qy < 0.82) return true
  }
  return false
}

// --- painted cards -------------------------------------------------------------

// Atlas of four cells: two clusters of small glossy leaves, two of flowers
// over leaves. Flowers are painted near white; the shader tints them per
// mound so one atlas serves every colour.
function paintAtlas(size: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const g = cv.getContext('2d')!
  const cell = size / 2
  const rand = rng(911)

  const leaf = (x: number, y: number, len: number, ang: number) => {
    const w = len * (0.36 + rand() * 0.1)
    g.save()
    g.translate(x, y)
    g.rotate(ang)
    const hue = 96 + rand() * 26
    const light = 11 + rand() * 15
    const grad = g.createLinearGradient(0, -w, 0, w)
    grad.addColorStop(0, `hsl(${hue}, ${48 + rand() * 18}%, ${light + 7}%)`)
    grad.addColorStop(1, `hsl(${hue + 6}, ${42 + rand() * 15}%, ${light - 3}%)`)
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, 0)
    g.bezierCurveTo(len * 0.25, -w, len * 0.8, -w * 0.8, len, 0)
    g.bezierCurveTo(len * 0.8, w * 0.8, len * 0.25, w, 0, 0)
    g.fill()
    g.strokeStyle = `hsla(${hue - 10}, 40%, ${light + 22}%, 0.45)`
    g.lineWidth = Math.max(1, len * 0.04)
    g.beginPath()
    g.moveTo(len * 0.05, 0)
    g.lineTo(len * 0.9, 0)
    g.stroke()
    // the wax of the leaf catches a soft sheen along one half
    g.fillStyle = 'rgba(210, 235, 190, 0.08)'
    g.beginPath()
    g.ellipse(len * 0.5, -w * 0.35, len * 0.32, w * 0.28, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }

  const leafCluster = (cx: number, cy: number, count: number, spread: number) => {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand()) * spread
      const len = cell * (0.13 + rand() * 0.09)
      leaf(cx + Math.cos(a) * d - Math.cos(a) * len * 0.3, cy + Math.sin(a) * d - Math.sin(a) * len * 0.3, len, a + (rand() - 0.5) * 0.9)
    }
  }

  const flower = (x: number, y: number, rad: number) => {
    const spin = rand() * Math.PI * 2
    g.save()
    g.translate(x, y)
    g.rotate(spin)
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + (rand() - 0.5) * 0.15
      g.save()
      g.rotate(a)
      const grad = g.createRadialGradient(0, 0, rad * 0.05, 0, 0, rad)
      grad.addColorStop(0, 'rgb(150, 146, 146)')
      grad.addColorStop(0.35, 'rgb(222, 218, 216)')
      grad.addColorStop(1, 'rgb(250, 249, 248)')
      g.fillStyle = grad
      g.beginPath()
      g.moveTo(0, 0)
      g.bezierCurveTo(rad * 0.45, -rad * 0.42, rad * 1.02, -rad * 0.5, rad * 1.0, 0)
      g.bezierCurveTo(rad * 1.02, rad * 0.5, rad * 0.45, rad * 0.42, 0, 0)
      g.fill()
      // a fine edge line so overlapping petals separate
      g.strokeStyle = 'rgba(120, 116, 116, 0.35)'
      g.lineWidth = Math.max(1, rad * 0.02)
      g.stroke()
      g.restore()
    }
    // freckles on the upper petal
    g.fillStyle = 'rgba(105, 98, 100, 0.55)'
    for (let i = 0; i < 9; i++) {
      const d = rad * (0.15 + rand() * 0.35)
      const a = (rand() - 0.5) * 0.7
      g.beginPath()
      g.arc(Math.cos(a) * d, Math.sin(a) * d, rad * 0.025 + rand() * rad * 0.02, 0, Math.PI * 2)
      g.fill()
    }
    // stamens curve out of the throat
    g.strokeStyle = 'rgb(200, 196, 196)'
    g.lineWidth = Math.max(1, rad * 0.018)
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + (rand() - 0.5) * 1.2
      const l = rad * (0.6 + rand() * 0.3)
      g.beginPath()
      g.moveTo(0, 0)
      g.quadraticCurveTo(Math.cos(a) * l * 0.5, Math.sin(a) * l * 0.5 - rad * 0.1, Math.cos(a) * l, Math.sin(a) * l)
      g.stroke()
      g.fillStyle = 'rgb(135, 128, 128)'
      g.beginPath()
      g.arc(Math.cos(a) * l, Math.sin(a) * l, rad * 0.035, 0, Math.PI * 2)
      g.fill()
    }
    g.restore()
  }

  for (let c = 0; c < 4; c++) {
    const ox = (c % 2) * cell
    const oy = Math.floor(c / 2) * cell
    g.save()
    g.beginPath()
    g.rect(ox, oy, cell, cell)
    g.clip()
    const cx = ox + cell / 2
    const cy = oy + cell / 2
    if (c < 2) {
      leafCluster(cx, cy, 70, cell * 0.3)
    } else {
      leafCluster(cx, cy, 30, cell * 0.32)
      const n = c === 2 ? 6 : 5
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand() * 0.6
        const d = i === 0 ? 0 : cell * (0.13 + rand() * 0.1)
        flower(cx + Math.cos(a) * d, cy + Math.sin(a) * d, cell * (0.13 + rand() * 0.04))
      }
      // a few leaf tips over the blooms keep the edge leafy
      leafCluster(cx, cy, 5, cell * 0.38)
    }
    g.restore()
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// --- materials -------------------------------------------------------------------

const CARD_VERT_HEAD = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uGust;
attribute vec3 aTint;
varying vec3 vTint;
${WIND_GLSL}
`

function cardMaterial(atlas: THREE.Texture): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    map: atlas,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.6,
    // a waxy leaf has a weak sheen; full dielectric fresnel turns the rim of
    // the mound to frost against the bright sky
    specularIntensity: 0.2,
    metalness: 0,
    vertexColors: true,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = realmUniforms.uTime
    shader.uniforms.uWind = realmUniforms.uWind
    shader.uniforms.uGust = realmUniforms.uGust
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CARD_VERT_HEAD}`)
      .replace(
        '#include <begin_vertex>',
        // clipped shrubs are stiff: a few millimetres of tremble at the surface
        `vec3 transformed = vec3(position) + windSway(position, 0.006);
        vTint = aTint;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTint;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float lo = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
        float bloom = smoothstep(0.1, 0.28, lo);
        diffuseColor.rgb = mix(diffuseColor.rgb, vTint * max(diffuseColor.r, diffuseColor.g), bloom);`,
      )
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'))
  }
  mat.customProgramCacheKey = () => 'realm-azalea-cards'
  return mat
}

// A frond: the rachis along u, pinnae either side cut into rounded pinnules,
// longest a third of the way out and tapering to a fine tip. The shipped fern
// scan lost its alpha channel, so the fronds are painted here.
function paintFrond(w: number): THREE.CanvasTexture {
  const h = w / 4
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const g = cv.getContext('2d')!
  const rand = rng(5150)
  const mid = h / 2
  const pairs = 28
  for (let i = 0; i < pairs; i++) {
    const t = 0.05 + (i / pairs) * 0.93
    const x = t * w
    const len = h * 0.47 * (t < 0.3 ? 0.4 + 0.6 * (t / 0.3) : 1 - ((t - 0.3) / 0.7) * 0.9)
    for (const side of [-1, 1]) {
      const ox = x + (side > 0 ? w * 0.008 : 0)
      const hue = 84 + rand() * 14 + t * 8
      const light = 20 + rand() * 7 + t * 7
      g.fillStyle = `hsl(${hue}, ${44 + rand() * 12}%, ${light}%)`
      // a pinna sweeps towards the tip, its pinnules shrinking outward
      const lobes = 8
      for (let k = 0; k < lobes; k++) {
        const s = (k + 0.5) / lobes
        const py = mid + side * len * s
        const px = ox + len * s * 0.55
        const r = len * 0.085 * (1.15 - s * 0.6) + 1
        g.beginPath()
        g.ellipse(px, py, r * 1.6, r, side * 0.5, 0, Math.PI * 2)
        g.fill()
      }
      g.strokeStyle = `hsl(${hue - 6}, 38%, ${light - 5}%)`
      g.lineWidth = Math.max(1, h * 0.01)
      g.beginPath()
      g.moveTo(ox, mid)
      g.lineTo(ox + len * 0.52, mid + side * len * 0.95)
      g.stroke()
    }
  }
  g.strokeStyle = 'hsl(66, 30%, 26%)'
  g.lineWidth = Math.max(1.5, h * 0.02)
  g.beginPath()
  g.moveTo(0, mid)
  g.lineTo(w * 0.99, mid)
  g.stroke()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 4
  return tex
}

function fernMaterial(map: THREE.Texture): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    map,
    alphaTest: 0.5,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.78,
    specularIntensity: 0.15,
    metalness: 0,
    vertexColors: true,
  })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = realmUniforms.uTime
    shader.uniforms.uWind = realmUniforms.uWind
    shader.uniforms.uGust = realmUniforms.uGust
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nuniform vec2 uWind;\nuniform float uGust;\nattribute vec2 aFlex;\n${WIND_GLSL}`,
      )
      .replace(
        '#include <begin_vertex>',
        // the fronds bend from the crown, the tips most, with a little flutter
        `vec3 transformed = vec3(position);
        float bend = aFlex.x * aFlex.x;
        vec3 sway = windSway(position, 0.07 * bend);
        transformed += sway - vec3(0.0, length(sway) * 0.45, 0.0);
        transformed.y += sin(uTime * 2.4 + aFlex.y) * 0.012 * bend * length(uWind) * (0.6 + 0.6 * uGust);`,
      )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'),
    )
  }
  mat.customProgramCacheKey = () => 'realm-fern'
  return mat
}

// --- placement helpers -----------------------------------------------------------

function clearGround(x: number, z: number): boolean {
  if (islandSdf(x, z) <= 0.8) return false
  if (pathWeight(x, z) > 0.01 || gravelWeight(x, z) > 0.05) return false
  if (Math.abs(x) < STEPS.halfWidth + 0.5 && z < TERRACE_FRONT_Z + 1.2 && z > TERRACE_FRONT_Z - 1.5) return false
  return true
}

// The lawn height, except in the strip at the wall foot, where layout eases
// the ground up towards the terrace behind the wall face; plants there sit on
// the lower lawn.
function footHeight(x: number, z: number): number {
  return groundHeight(x, z > TERRACE_FRONT_Z - 0.5 && z < TERRACE_FRONT_Z + 0.8 ? TERRACE_FRONT_Z + 0.8 : z)
}

function underAzalea(x: number, z: number, margin: number): boolean {
  for (const m of mounds) {
    const dx = x - m.x
    const dz = z - m.z
    if (dx * dx + dz * dz < (m.r + margin) * (m.r + margin)) return true
  }
  return false
}

interface Spot {
  x: number
  z: number
  s: number
  yaw: number
}

function fernSpots(rand: () => number, density: number): Spot[] {
  const out: Spot[] = []
  const pondOk = (x: number, z: number) => {
    const d = pondSdf(x, z)
    if (d < 0.3 || d > 1.5) return false
    const cx = x - CHERRY.x
    const cz = z - CHERRY.z
    return cx * cx + cz * cz > 0.5 && clearGround(x, z)
  }
  // the pond: clumps of two to five in the shore band
  const clumps = Math.round(22 * density)
  let tries = 0
  let made = 0
  while (made < clumps && tries++ < 4000) {
    const x = POND_BOUNDS.xMin + rand() * (POND_BOUNDS.xMax - POND_BOUNDS.xMin + 1.5)
    const z = POND_BOUNDS.zMin - 1 + rand() * (POND_BOUNDS.zMax - POND_BOUNDS.zMin + 2)
    if (!pondOk(x, z)) continue
    if (out.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 1.6 * 1.6)) continue
    made++
    const n = 2 + Math.floor(rand() * 4)
    for (let i = 0; i < n; i++) {
      const px = x + (rand() - 0.5) * 1.3
      const pz = z + (rand() - 0.5) * 1.3
      if (i > 0 && !pondOk(px, pz)) continue
      out.push({ x: i === 0 ? x : px, z: i === 0 ? z : pz, s: 0.9 + rand() * 0.6, yaw: rand() * Math.PI * 2 })
    }
  }
  // the foot of the terrace wall, either side of the steps
  for (let x = -16; x <= 16; x += 0.55) {
    if (Math.abs(x) < 2) continue
    if (rand() > 0.55 * density + 0.1) continue
    const px = x + (rand() - 0.5) * 0.4
    const pz = TERRACE_FRONT_Z + 0.3 + rand() * 0.55
    if (islandSdf(px, pz) <= 0.8 || pathWeight(px, pz) > 0.01 || gravelWeight(px, pz) > 0.05) continue
    if (underAzalea(px, pz, -0.1)) continue
    out.push({ x: px, z: pz, s: 0.65 + rand() * 0.5, yaw: rand() * Math.PI * 2 })
  }
  return out
}

interface Cushion {
  x: number
  z: number
  sx: number
  sz: number
  h: number
  yaw: number
}

function mossSpots(rand: () => number): Cushion[] {
  const out: Cushion[] = []
  // the lantern feet: moss creeps up against the stone where the rake never
  // reaches, so it may sit on the gravel's edge but never on the path
  for (const l of LANTERNS) {
    const n = 9 + Math.floor(rand() * 5)
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const d = 0.24 + rand() * 0.2
      const x = l.x + Math.cos(a) * d
      const z = l.z + Math.sin(a) * d
      if (pathWeight(x, z) > 0.01 || islandSdf(x, z) <= 0.8) continue
      const s = 0.06 + rand() * 0.08
      // the kerb along the gravel bed stays clean
      if (Math.abs(Math.abs(x) - GRAVEL_HALF_WIDTH) < s * 1.4 + 0.08) continue
      out.push({ x, z, sx: s * (1 + rand() * 0.5), sz: s, h: 0.05 + rand() * 0.04, yaw: a })
    }
  }
  // along the wall foot
  for (let x = -15; x <= 15; x += 0.22) {
    if (Math.abs(x) < 2 || rand() > 0.6) continue
    const px = x + (rand() - 0.5) * 0.3
    const pz = TERRACE_FRONT_Z + 0.12 + rand() * 0.45
    if (!(islandSdf(px, pz) > 0.8) || pathWeight(px, pz) > 0.01 || gravelWeight(px, pz) > 0.05) continue
    if (underAzalea(px, pz, -0.15)) continue
    const s = 0.1 + rand() * 0.14
    out.push({ x: px, z: pz, sx: s * (1.1 + rand() * 0.6), sz: s, h: 0.05 + rand() * 0.05, yaw: (rand() - 0.5) * 0.6 })
  }
  return out
}

// a low cushion: a flattened, noisy dome with its rim tucked into the ground
function cushionGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI * 0.56)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const uv = geo.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const k = 1 + (fbm2(x * 2.2 + 5, z * 2.2 + y * 1.5, 3) - 0.5) * 0.45 + (fbm2(x * 7.5 - 3, z * 7.5 + y * 4, 2) - 0.5) * 0.22
    pos.setXYZ(i, x * k, Math.max(y * k, -0.1) - 0.05, z * k)
    uv.setXY(i, x * 0.6 + 0.5, z * 0.6 + 0.5)
  }
  geo.computeVertexNormals()
  return geo
}

// --- the part ----------------------------------------------------------------------

export class Plants implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Plants> {
    const moss = await loadPbr('moss', tier).catch(() => null)
    return new Plants(tier, moss)
  }

  private constructor(tier: Tier, moss: Awaited<ReturnType<typeof loadPbr>> | null) {
    const spec = TIERS[tier]
    this.buildAzaleas(spec)
    this.buildFerns(spec)
    this.buildMoss(moss)
  }

  private buildAzaleas(spec: TierSpec): void {
    const rand = rng(4417)
    const atlas = paintAtlas(spec.atlas)
    const cardMat = cardMaterial(atlas)
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, metalness: 0 })
    this.disposables.push(atlas, cardMat, shellMat)

    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const colors: number[] = []
    const tints: number[] = []
    const index: number[] = []

    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    const cn = new THREE.Vector3()
    const t1 = new THREE.Vector3()
    const t2 = new THREE.Vector3()
    const vn = new THREE.Vector3()
    const tint = new THREE.Color()
    const shellGeos: THREE.BufferGeometry[] = []

    mounds.forEach((m, mi) => {
      tint.set(BLOOMS[mi % BLOOMS.length])
      const white = tint.r > 0.8 && tint.g > 0.8
      // the share of flower cards on the sunny top; white mounds bloom a
      // little thinner so they do not read as snow
      const bloom = white ? 0.72 : 0.9

      // the shell, a lumpy dome a few centimetres inside the cards
      const seg = spec.shellSegments
      const shell = new THREE.SphereGeometry(1, seg, Math.round(seg / 3), 0, Math.PI * 2, 0, Math.PI * 0.6)
      const sp = shell.attributes.position as THREE.BufferAttribute
      const sc = new Float32Array(sp.count * 3)
      for (let i = 0; i < sp.count; i++) {
        const dx = sp.getX(i)
        const dy = sp.getY(i)
        const dz = sp.getZ(i)
        surface(m, dx, dy, dz, p)
        moundNormal(m, dx, dy, dz, n)
        p.addScaledVector(n, -0.05)
        sp.setXYZ(i, p.x, p.y, p.z)
        const up = THREE.MathUtils.clamp((p.y - m.base) / m.h, 0, 1)
        const shade = 0.006 + 0.016 * up
        sc[i * 3] = shade * 0.5
        sc[i * 3 + 1] = shade
        sc[i * 3 + 2] = shade * 0.35
      }
      shell.setAttribute('color', new THREE.BufferAttribute(sc, 3))
      shell.computeVertexNormals()
      shellGeos.push(shell)

      // cards, spread evenly over the dome's area
      const area = Math.PI * m.r * m.r * 0.9 + 2 * Math.PI * m.r * m.h * 0.75
      const count = Math.round(area * spec.cardsPerM2)
      for (let c = 0; c < count * 1.3; c++) {
        // uniform on the upper hemisphere and a little below the equator,
        // thinned on the sides because the flattened dome has less area there
        const dy = Math.min(-0.2 + rand() * 1.2, 1)
        const w = Math.sqrt(dy * dy * m.r * m.r + (1 - dy * dy) * m.h * m.h) / m.r
        if (rand() > w) continue
        const a = rand() * Math.PI * 2
        const ring = Math.sqrt(Math.max(0, 1 - dy * dy))
        const dx = Math.cos(a) * ring
        const dz = Math.sin(a) * ring
        surface(m, dx, dy, dz, p)
        moundNormal(m, dx, dy, dz, n)
        // a few sprigs grown out since the last clipping break the outline
        const sprig = rand() < 0.07
        const depth = rand()
        p.addScaledVector(n, sprig ? 0.04 + rand() * 0.05 : -0.035 + depth * 0.055)
        if (buried(mi, p)) continue
        const up = THREE.MathUtils.clamp((p.y - m.base) / m.h, 0, 1)
        const sun = Math.max(0, n.dot(SUN_DIRECTION))
        const flowerOdds = bloom * THREE.MathUtils.clamp(0.02 + 1.05 * n.y + 0.3 * sun, 0, 1)
        const isFlower = !sprig && rand() < flowerOdds
        const cellIndex = isFlower ? 2 + Math.floor(rand() * 2) : Math.floor(rand() * 2)
        const size = (isFlower ? 0.15 + rand() * 0.06 : 0.16 + rand() * 0.08) * spec.cardScale

        // the card faces roughly outward, tilted and spun so no two align
        cn.set(n.x + (rand() - 0.5) * 1.1, n.y + (rand() - 0.5) * 1.1, n.z + (rand() - 0.5) * 1.1).normalize()
        t1.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(cn).normalize()
        t2.crossVectors(cn, t1).normalize()
        // shading normal: mostly the dome, a touch of the card
        vn.copy(n).multiplyScalar(0.68).addScaledVector(cn, 0.32).normalize()

        // the inside of the clipped mass and its foot are darker
        // leaves deeper in the clipped skin sit in each other's shade
        const ao = (0.3 + 0.7 * Math.pow(up, 0.7)) * (sprig ? 0.9 : 0.4 + 0.6 * depth) * (0.8 + rand() * 0.2)
        const u0 = (cellIndex % 2) * 0.5
        const v0 = cellIndex < 2 ? 0.5 : 0
        const base = positions.length / 3
        const hs = size / 2
        for (let k = 0; k < 4; k++) {
          const sx = k === 0 || k === 3 ? -1 : 1
          const sy = k < 2 ? -1 : 1
          positions.push(
            p.x + (t1.x * sx + t2.x * sy) * hs,
            p.y + (t1.y * sx + t2.y * sy) * hs,
            p.z + (t1.z * sx + t2.z * sy) * hs,
          )
          normals.push(vn.x, vn.y, vn.z)
          uvs.push(u0 + (sx > 0 ? 0.5 : 0), v0 + (sy > 0 ? 0.5 : 0))
          // greener and darker at the foot where it meets the lawn
          colors.push(ao * (0.85 + 0.15 * up), ao, ao * (0.85 + 0.15 * up))
          tints.push(tint.r, tint.g, tint.b)
        }
        index.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    })

    const cards = new THREE.BufferGeometry()
    cards.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    cards.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    cards.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    cards.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    cards.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 3))
    cards.setIndex(index)
    cards.computeBoundingSphere()
    const cardMesh = new THREE.Mesh(cards, cardMat)
    cardMesh.castShadow = true
    cardMesh.receiveShadow = true
    this.object.add(cardMesh)
    this.disposables.push(cards)

    for (const g of shellGeos) {
      const shellMesh = new THREE.Mesh(g, shellMat)
      shellMesh.castShadow = true
      shellMesh.receiveShadow = true
      this.object.add(shellMesh)
      this.disposables.push(g)
    }
  }

  // Each fern is a crown of arching fronds, every frond a ribbon bent along
  // its length and folded down either side of the rachis.
  private buildFerns(spec: TierSpec): void {
    const spots = fernSpots(rng(733), spec.ferns)
    if (!spots.length) return
    const map = paintFrond(spec.atlas)
    const material = fernMaterial(map)
    this.disposables.push(map, material)

    const positions: number[] = []
    const normals: number[] = []
    const uvs: number[] = []
    const colors: number[] = []
    const flex: number[] = []
    const index: number[] = []
    const rand = rng(1907)
    const seg = spec.frondSegments
    const p = new THREE.Vector3()
    const d = new THREE.Vector3()
    const tan = new THREE.Vector3()
    const across = new THREE.Vector3()
    const n = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const corner = new THREE.Vector3()

    for (const f of spots) {
      const gy = footHeight(f.x, f.z)
      const fronds = Math.round((spec.ferns >= 0.8 ? 11 : 8) + rand() * 4)
      for (let k = 0; k < fronds; k++) {
        const inner = k % 3 === 0
        const yaw = f.yaw + (k / fronds) * Math.PI * 2 + (rand() - 0.5) * 0.4
        const len = f.s * (inner ? 0.42 : 0.55 + rand() * 0.2)
        const width = len * 0.3
        const e0 = (inner ? 1.25 : 1.0) + rand() * 0.25
        const e1 = (inner ? 0.1 : -0.35) + rand() * 0.25
        const roll = (rand() - 0.5) * 0.5
        const phase = rand() * 6.28
        d.set(Math.cos(yaw), 0, Math.sin(yaw))
        p.set(f.x + d.x * 0.03, gy + 0.02, f.z + d.z * 0.03)
        const base = positions.length / 3
        for (let i = 0; i <= seg; i++) {
          const t = i / seg
          const e = e0 + (e1 - e0) * Math.pow(t, 0.8)
          tan.copy(d).multiplyScalar(Math.cos(e)).addScaledVector(up, Math.sin(e))
          across.crossVectors(tan, up).normalize().applyAxisAngle(tan, roll)
          n.crossVectors(across, tan).normalize()
          if (n.y < 0) n.negate()
          n.lerp(up, 0.35).normalize()
          // the stipe at the base is bare, so the ribbon starts narrow
          const hw = width * 0.5 * Math.min(1, 0.25 + t * 4)
          const shade = 0.45 + 0.55 * Math.min(1, t * 1.6)
          for (let j = 0; j < 3; j++) {
            const side = j - 1
            corner.copy(p).addScaledVector(across, side * hw)
            corner.y -= Math.abs(side) * hw * 0.28
            positions.push(corner.x, corner.y, corner.z)
            normals.push(n.x, n.y, n.z)
            uvs.push(t, j * 0.5)
            colors.push(shade * 0.92, shade, shade * 0.85)
            flex.push(t, phase)
          }
          if (i < seg) {
            const a = base + i * 3
            index.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5)
          }
          p.addScaledVector(tan, len / seg)
        }
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 2))
    geometry.setIndex(index)
    geometry.computeBoundingSphere()
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.object.add(mesh)
    this.disposables.push(geometry)
  }

  private buildMoss(set: Awaited<ReturnType<typeof loadPbr>> | null): void {
    const spots = mossSpots(rng(2903))
    if (!spots.length) return
    const geometry = cushionGeometry()
    const material = new THREE.MeshStandardMaterial({
      color: set ? 0x9cc070 : 0x3d5a24,
      roughness: 1,
      metalness: 0,
    })
    if (set) {
      material.map = set.map
      material.normalMap = set.normalMap
      material.normalScale.set(1.6, 1.6)
      material.roughnessMap = set.arm
      material.aoMap = set.arm
    }
    this.disposables.push(geometry, material)
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length)
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const v = new THREE.Vector3()
    const yAxis = new THREE.Vector3(0, 1, 0)
    spots.forEach((c, i) => {
      q.setFromAxisAngle(yAxis, c.yaw)
      s.set(c.sx, c.h, c.sz)
      v.set(c.x, footHeight(c.x, c.z), c.z)
      mesh.setMatrixAt(i, m4.compose(v, q, s))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    mesh.receiveShadow = true
    this.object.add(mesh)
    this.disposables.push(mesh)
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
  }
}
