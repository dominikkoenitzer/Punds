import * as THREE from 'three'
import type { Frame, RealmPart, Tier } from './types'
import { realmUniforms, WIND_GLSL } from './atmosphere'
import { loadPbr } from './assets'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CEDARS, CHERRY, MAPLES, groundHeight, islandSdf, noise2, PATH_HALF_WIDTH, pondSdf, POND_LEVEL, rng } from './layout'
import { dressFor } from './season'
import type { BlossomDress } from './halloween/garden'

type Rand = () => number

// --- skeletons ------------------------------------------------------------------

interface Limb {
  pts: THREE.Vector3[]
  radii: number[]
  // flexibility at each point: 0 at the root, growing along the path to the tips
  sway: number[]
  depth: number
}

interface Tip {
  p: THREE.Vector3
  sway: number
}

const UP = new THREE.Vector3(0, 1, 0)

// the walk runs along x = 0; nothing of a tree may hang lower than this over it
const WALK_CLEAR = 2.45
function overWalk(worldX: number): boolean {
  return Math.abs(worldX) < PATH_HALF_WIDTH + 0.7
}

function randUnit(r: Rand, out: THREE.Vector3): THREE.Vector3 {
  const z = r() * 2 - 1
  const a = r() * Math.PI * 2
  const s = Math.sqrt(1 - z * z)
  return out.set(Math.cos(a) * s, z, Math.sin(a) * s)
}

function limbPoint(limb: Limb, t: number, out: THREE.Vector3): { r: number; sway: number; dir: THREE.Vector3 } {
  const n = limb.pts.length - 1
  const f = Math.min(n - 1e-4, Math.max(0, t * n))
  const i = Math.floor(f)
  const k = f - i
  const a = limb.pts[i]!
  const b = limb.pts[i + 1]!
  out.copy(a).lerp(b, k)
  return {
    r: limb.radii[i]! + (limb.radii[i + 1]! - limb.radii[i]!) * k,
    sway: limb.sway[i]! + (limb.sway[i + 1]! - limb.sway[i]!) * k,
    dir: new THREE.Vector3().subVectors(b, a).normalize(),
  }
}

interface GrowOpts {
  start: THREE.Vector3
  dir: THREE.Vector3
  length: number
  r0: number
  r1: number
  depth: number
  sway0: number
  segLen: number
  // changes the heading at each step; s runs 0..1 along the limb
  bend: (d: THREE.Vector3, s: number, p: THREE.Vector3) => void
}

function grow(o: GrowOpts): Limb {
  const steps = Math.max(3, Math.round(o.length / o.segLen))
  const step = o.length / steps
  const p = o.start.clone()
  const d = o.dir.clone().normalize()
  const limb: Limb = { pts: [p.clone()], radii: [o.r0], sway: [o.sway0], depth: o.depth }
  for (let i = 1; i <= steps; i++) {
    const s = i / steps
    o.bend(d, s, p)
    d.normalize()
    p.addScaledVector(d, step)
    limb.pts.push(p.clone())
    // taper that holds thickness and then thins towards the tip
    limb.radii.push(o.r1 + (o.r0 - o.r1) * Math.pow(1 - s, 1.35))
    limb.sway.push(o.sway0 + o.length * s)
  }
  return limb
}

// the first `keep` share of a limb, by point count, at least two points
function trimLimb(l: Limb, keep: number): Limb {
  const n = Math.max(2, Math.round(l.pts.length * keep))
  return { pts: l.pts.slice(0, n), radii: l.radii.slice(0, n), sway: l.sway.slice(0, n), depth: l.depth }
}

// rotate v away from its own direction by `angle` around a random perpendicular
function deviate(v: THREE.Vector3, angle: number, r: Rand, out: THREE.Vector3): THREE.Vector3 {
  const tmp = randUnit(r, new THREE.Vector3())
  const axis = tmp.cross(v)
  if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0)
  axis.normalize()
  return out.copy(v).applyAxisAngle(axis, angle)
}

// --- tubes ---------------------------------------------------------------------

interface TubeOpts {
  radial: number
  texWorld: number
  gnarl: number
  flare: number
  seed: number
  // height of one texture tile over its width (scans of tall bark are 1:2)
  vAspect?: number
}

class TubeBuilder {
  pos: number[] = []
  nor: number[] = []
  uv: number[] = []
  sway: number[] = []
  idx: number[] = []

  add(limb: Limb, o: TubeOpts): void {
    const curve = new THREE.CatmullRomCurve3(limb.pts, false, 'centripetal')
    let len = 0
    for (let i = 1; i < limb.pts.length; i++) len += limb.pts[i]!.distanceTo(limb.pts[i - 1]!)
    const r0 = limb.radii[0]!
    const segs = Math.max(2, Math.round(len / Math.max(0.05, Math.min(0.3, r0 * 2.2))))
    const radial = o.radial
    const uRepeat = Math.max(1, Math.round((2 * Math.PI * r0) / o.texWorld))
    const base = this.pos.length / 3
    const c = new THREE.Vector3()
    const t = new THREE.Vector3()
    const prevT = new THREE.Vector3()
    const n = new THREE.Vector3()
    const b = new THREE.Vector3()
    const q = new THREE.Quaternion()
    const dir = new THREE.Vector3()
    let arc = 0
    const prevC = new THREE.Vector3()
    const nPts = limb.pts.length - 1
    for (let i = 0; i <= segs; i++) {
      const u = i / segs
      curve.getPoint(u, c)
      curve.getTangent(u, t)
      if (i === 0) {
        n.set(0, 1, 0)
        if (Math.abs(t.y) > 0.9) n.set(1, 0, 0)
        n.cross(t).normalize()
      } else {
        q.setFromUnitVectors(prevT, t)
        n.applyQuaternion(q)
        arc += c.distanceTo(prevC)
      }
      b.crossVectors(t, n).normalize()
      prevT.copy(t)
      prevC.copy(c)
      const f = Math.min(nPts - 1e-4, u * nPts)
      const k = Math.floor(f)
      const fr = f - k
      const rad = limb.radii[k]! + (limb.radii[k + 1]! - limb.radii[k]!) * fr
      const sw = limb.sway[k]! + (limb.sway[k + 1]! - limb.sway[k]!) * fr
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        dir.copy(n).multiplyScalar(ca).addScaledVector(b, sa)
        let rr = rad
        if (o.gnarl > 0) {
          // ridges and burls that follow the limb, periodic around it
          const g = noise2(ca * 1.3 + o.seed, arc * 1.7 + sa * 1.3) - 0.5
          const ridge = noise2(ca * 3.1 + sa * 2.2 + o.seed * 0.7, arc * 0.6) - 0.5
          rr *= 1 + o.gnarl * (g * 0.9 + ridge * 0.6)
        }
        if (o.flare > 0) {
          // buttress roots: lobes that swell into the ground
          const e = Math.exp(-arc * 3.2)
          rr *= 1 + o.flare * e * (0.55 + 0.45 * Math.cos(a * 5 + o.seed * 3.1)) + o.flare * 0.25 * Math.exp(-arc * 1.2)
        }
        this.pos.push(c.x + dir.x * rr, c.y + dir.y * rr, c.z + dir.z * rr)
        this.nor.push(dir.x, dir.y, dir.z)
        this.uv.push((j / radial) * uRepeat, arc / (o.texWorld * (o.vAspect ?? 1)))
        this.sway.push(sw)
      }
    }
    const row = radial + 1
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * row + j
        const b2 = a + row
        // wound so the faces look outwards
        this.idx.push(a, a + 1, b2, a + 1, b2 + 1, b2)
      }
    }
    // a rounded cap, so no limb end ever shows as an open pipe
    const endRad = limb.radii[nPts]!
    const apex = this.pos.length / 3
    this.pos.push(c.x + t.x * endRad * 0.6, c.y + t.y * endRad * 0.6, c.z + t.z * endRad * 0.6)
    this.nor.push(t.x, t.y, t.z)
    this.uv.push(0.5 * uRepeat, (arc + endRad * 0.6) / (o.texWorld * (o.vAspect ?? 1)))
    this.sway.push(limb.sway[nPts]!)
    const lastRow = base + segs * row
    for (let j = 0; j < radial; j++) this.idx.push(lastRow + j, lastRow + j + 1, apex)
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 1))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    return g
  }
}

// --- materials -------------------------------------------------------------------

const SWAY_HEAD = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uGust;
uniform float uBranchAmp;
uniform float uSwayNorm;
attribute float aSway;
${WIND_GLSL}
`

// haze: how strongly far trunks drift towards the blue of the air (0 for single trees)
function barkMaterial(tier: Tier, name: string, fallback: number, tint: number, amp: number, swayNorm: number, haze = 0): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.92, metalness: 0 })
  const branchAmp = { value: amp }
  const norm = { value: swayNorm }
  const hazeU = { value: haze }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = realmUniforms.uTime
    shader.uniforms.uWind = realmUniforms.uWind
    shader.uniforms.uGust = realmUniforms.uGust
    shader.uniforms.uBranchAmp = branchAmp
    shader.uniforms.uSwayNorm = norm
    shader.uniforms.uHaze = hazeU
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWAY_HEAD}`)
      .replace(
        '#include <begin_vertex>',
        `vec3 transformed = vec3(position);
        float flex = pow(clamp(aSway / uSwayNorm, 0.0, 1.0), 2.2);
        transformed += windSway((modelMatrix * vec4(position, 1.0)).xyz, flex * uBranchAmp);`,
      )
  }
  // every bark shares one program; the differences live in uniforms
  mat.customProgramCacheKey = () => 'realm-bark'
  const onCompile = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    onCompile(shader, renderer)
    // bark is never glossy: a low scanned roughness would mirror the bright sky
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n  roughnessFactor = max(roughnessFactor, 0.78);',
    )
  }
  const onCompile2 = mat.onBeforeCompile
  mat.onBeforeCompile = (shader, renderer) => {
    onCompile2(shader, renderer)
    // In a grove the trunks behind stand in a little more air than the fog gives at
    // these short ranges: they lift and cool with distance, so the rows separate.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHaze;')
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.12, 1.2, 1.42) + vec3(0.006, 0.009, 0.016), uHaze * smoothstep(5.0, 32.0, length(vViewPosition)));
        #include <opaque_fragment>`,
      )
  }
  loadPbr(name, tier)
    .then((set) => {
      mat.map = set.map
      mat.normalMap = set.normalMap
      mat.aoMap = set.arm
      mat.roughnessMap = set.arm
      mat.roughness = 1
      mat.metalness = 0
      mat.color.set(tint)
      mat.needsUpdate = true
    })
    .catch(() => {
      // the scanned set is not there; the fallback colour stays
    })
  return mat
}

const FOLIAGE_HEAD = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uGust;
uniform float uBranchAmp;
uniform float uCardAmp;
uniform float uSwayNorm;
attribute vec3 aAnchor;
attribute vec3 aCentre;
attribute vec3 aFaceN;
attribute float aSway;
uniform vec2 uFar;
attribute float aPhase;
${WIND_GLSL}
`

// Thin leaves and petals let the sun through: a wrapped back-face term and a
// forward-scatter lobe when the viewer looks towards the light. directLight
// already carries the shadow, so the inner crown stays dark.
const TRANSLUCENCY = /* glsl */ `
uniform float uTrans;
uniform vec3 uTransTint;
void RE_Direct_Foliage( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  float back = saturate( dot( -geometryNormal, directLight.direction ) * 0.7 + 0.3 );
  float scatter = pow( saturate( dot( geometryViewDir, -directLight.direction ) ), 6.0 );
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * uTransTint * uTrans * ( back * 0.35 + scatter * 1.6 );
}
#undef RE_Direct
#define RE_Direct RE_Direct_Foliage
`

interface FoliageOpts {
  key: string
  map: THREE.Texture
  normalMap: THREE.Texture | null
  trans: number
  transTint: THREE.Color
  roughness: number
  branchAmp: number
  cardAmp: number
  swayNorm: number
  // cards keep their volume normal on both faces; petals flip like real sheets
  volumeNormals: boolean
  instanced: boolean
  // distance at which cards begin to merge into fewer, larger ones
  farStart: number
  // soft coverage edges (needs enough multisamples; off on phones)
  softEdge: boolean
}

function foliageMaterial(o: FoliageOpts): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = {
    map: o.map,
    alphaTest: FOLIAGE_CUTOFF,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: o.roughness,
    metalness: 0,
    vertexColors: !o.instanced,
  }
  if (o.normalMap) {
    params.normalMap = o.normalMap
    params.normalScale = new THREE.Vector2(0.9, 0.9)
  }
  const mat = new THREE.MeshStandardMaterial(params)
  const uniforms = {
    uBranchAmp: { value: o.branchAmp },
    uCardAmp: { value: o.cardAmp },
    uSwayNorm: { value: o.swayNorm },
    uFar: { value: new THREE.Vector2(o.farStart, o.farStart * 3) },
    uTrans: { value: o.trans },
    uTransTint: { value: o.transTint },
  }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = realmUniforms.uTime
    shader.uniforms.uWind = realmUniforms.uWind
    shader.uniforms.uGust = realmUniforms.uGust
    Object.assign(shader.uniforms, uniforms)
    if (!o.instanced) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${FOLIAGE_HEAD}`)
        .replace(
          '#include <begin_vertex>',
          `vec3 transformed = vec3(position);
          vec3 anchorW = (modelMatrix * vec4(aAnchor, 1.0)).xyz;
          // Far away the crown thins to fewer, larger cards: a hashed share of them
          // shrinks out smoothly while the rest grow to hold the same coverage, so
          // the masses stay soft instead of breaking into single sparkling cards.
          float far = smoothstep(uFar.x, uFar.y, distance(cameraPosition, anchorW));
          float h = fract(sin(aPhase * 12.9898) * 43758.5453);
          float cut = far * 0.3;
          float keep = smoothstep(cut - 0.08, cut + 0.08, h);
          // a card turning edge-on shrinks away instead of fading, so no part of it is
          // ever drawn at partial coverage
          vec3 faceW = normalize(mat3(modelMatrix) * aFaceN);
          vec3 toCam = normalize(cameraPosition - (modelMatrix * vec4(aCentre, 1.0)).xyz);
          float facing = smoothstep(0.18, 0.45, abs(dot(faceW, toCam)));
          transformed = aCentre + (transformed - aCentre) * keep * facing * (1.0 + far * 0.55);
          float flex = pow(clamp(aSway / uSwayNorm, 0.0, 1.0), 2.2);
          transformed += windSway(anchorW, flex * uBranchAmp);
          float st = length(uWind) * (0.5 + 0.8 * realmGust(anchorW.xz) * (0.6 + 0.4 * uGust));
          float reach = length(position - aAnchor);
          transformed += vec3(sin(uTime * 3.3 + aPhase), 0.6 * sin(uTime * 4.7 + aPhase * 1.7), cos(uTime * 2.9 + aPhase * 0.6))
            * uCardAmp * st * (0.4 + reach);`,
        )
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_physical_pars_fragment>',
      `#include <lights_physical_pars_fragment>\n${TRANSLUCENCY}`,
    )
    if (o.volumeNormals) {
      // A ramp about a pixel wide around the cutoff: with the multisampled target
      // the coverage then antialiases the true cutout edges only, and no area of a
      // card sits at partial coverage (which would dither into a checker).
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `float aw = clamp(fwidth(diffuseColor.a) * 0.5, 0.004, 0.05);
        diffuseColor.a = smoothstep(alphaTest - aw, alphaTest + aw, diffuseColor.a);
        if (diffuseColor.a < 0.02) discard;`,
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'),
      )
    }
  }
  // blossom, maple and cedar cards share one program; only uniforms differ
  mat.customProgramCacheKey = () => `realm-foliage-${o.instanced ? 'i' : 'c'}${o.volumeNormals ? 'v' : 'f'}${o.softEdge ? 's' : 'h'}`
  return mat
}

// --- painted textures -------------------------------------------------------------

type Pass = 'color' | 'height'

function rgbStr(r: number, g: number, b: number, a = 1): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  return `rgba(${c(r)},${c(g)},${c(b)},${a})`
}

function grey(v: number, a = 1): string {
  return rgbStr(v, v, v, a)
}

interface Atlas {
  map: THREE.DataTexture
  normalMap: THREE.DataTexture
}

// the painted atlas as plain pixels, so it can be made in a worker: the
// colour chain (level 0 first) and the normal map
export interface AtlasData {
  size: number
  levels: { data: Uint8Array; width: number; height: number }[]
  normal: Uint8Array
}

// a page canvas where there is a page, else an offscreen one (in a worker)
type Paint = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function paintContext(size: number): Paint {
  if (typeof document !== 'undefined') {
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    return cv.getContext('2d', { willReadFrequently: true })!
  }
  const ctx = new OffscreenCanvas(size, size).getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('no 2d canvas')
  return ctx
}

// Paints a 2x2 atlas twice with the same random stream: once in colour, once
// as a height field that becomes the normal map. Transparent texels take the
// mean colour so mip levels do not fringe dark.
function paintAtlas(size: number, seed: number, cell: (ctx: Paint, pass: Pass, r: Rand, ox: number, oy: number, s: number) => void, bump: number): AtlasData {
  const S = size / 2
  const draw = (pass: Pass) => {
    const ctx = paintContext(size)
    if (pass === 'height') {
      ctx.fillStyle = grey(0.3)
      ctx.fillRect(0, 0, size, size)
    }
    for (let c = 0; c < 4; c++) {
      const r = rng(seed + c * 7919)
      ctx.save()
      ctx.beginPath()
      ctx.rect((c % 2) * S, Math.floor(c / 2) * S, S, S)
      ctx.clip()
      cell(ctx, pass, r, (c % 2) * S, Math.floor(c / 2) * S, S)
      ctx.restore()
    }
    return ctx.getImageData(0, 0, size, size).data
  }
  const col = draw('color')
  const hgt = draw('height')
  let mr = 0
  let mg = 0
  let mb = 0
  let mn = 0
  for (let i = 0; i < col.length; i += 4) {
    if (col[i + 3]! > 200) {
      mr += col[i]!
      mg += col[i + 1]!
      mb += col[i + 2]!
      mn++
    }
  }
  mn = Math.max(1, mn)
  const rgba = new Uint8Array(col.length)
  for (let i = 0; i < col.length; i += 4) {
    const a = col[i + 3]!
    if (a < 8) {
      rgba[i] = mr / mn
      rgba[i + 1] = mg / mn
      rgba[i + 2] = mb / mn
      rgba[i + 3] = 0
    } else {
      rgba[i] = col[i]!
      rgba[i + 1] = col[i + 1]!
      rgba[i + 2] = col[i + 2]!
      rgba[i + 3] = a
    }
  }
  const nor = new Uint8Array(col.length)
  // The canvas dithers its gradients by one level per texel; differentiated, that
  // dither becomes a fine grid of normals that glitters in back light. A small
  // separable blur removes it while keeping the shape of each petal.
  const hf = new Float32Array(size * size)
  const tmpRow = new Float32Array(size * size)
  const rad = Math.max(1, Math.round(size / 1024))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let d = -rad; d <= rad; d++) sum += hgt[(y * size + Math.min(size - 1, Math.max(0, x + d))) * 4]!
      tmpRow[y * size + x] = sum / (2 * rad + 1) / 255
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0
      for (let d = -rad; d <= rad; d++) sum += tmpRow[Math.min(size - 1, Math.max(0, y + d)) * size + x]!
      hf[y * size + x] = sum / (2 * rad + 1)
    }
  }
  const h = (x: number, y: number) => hf[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))]!
  const k = bump * (size / 1024)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * k
      const dy = (h(x, y + 1) - h(x, y - 1)) * k
      const l = Math.hypot(dx, dy, 1)
      const i = (y * size + x) * 4
      nor[i] = (-dx / l * 0.5 + 0.5) * 255
      nor[i + 1] = (-dy / l * 0.5 + 0.5) * 255
      nor[i + 2] = (1 / l * 0.5 + 0.5) * 255
      nor[i + 3] = 255
    }
  }
  // the colour chain is built here so every level keeps the cutout coverage of
  // the full-size painting; plain box mips thin the crown into grain at range
  return { size, levels: coverageMips(rgba, size, FOLIAGE_CUTOFF, [mr / mn, mg / mn, mb / mn]), normal: nor }
}

function atlasTextures(d: AtlasData): Atlas {
  const make = (data: Uint8Array, color: boolean) => {
    const t = new THREE.DataTexture(data, d.size, d.size, THREE.RGBAFormat)
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }
  const map = make(d.levels[0]!.data, true)
  map.mipmaps = d.levels
  map.generateMipmaps = false
  return { map, normalMap: make(d.normal, false) }
}

const FOLIAGE_CUTOFF = 0.42

function coverageOf(alpha: Float32Array, scale: number, cutoff: number): number {
  let n = 0
  const c = cutoff / scale
  for (let i = 0; i < alpha.length; i++) if (alpha[i]! >= c) n++
  return n / alpha.length
}

// Box-filtered mip chain with alpha weighted colour, then each level's alpha
// scaled (by bisection) until as many texels pass the cutoff as at level 0.
function coverageMips(base: Uint8Array, size: number, cutoff: number, fill: [number, number, number]): { data: Uint8Array; width: number; height: number }[] {
  const levels: { data: Uint8Array; width: number; height: number }[] = [{ data: base, width: size, height: size }]
  let a = new Float32Array(size * size)
  let rgb = new Float32Array(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    a[i] = base[i * 4 + 3]! / 255
    rgb[i * 3] = base[i * 4]!
    rgb[i * 3 + 1] = base[i * 4 + 1]!
    rgb[i * 3 + 2] = base[i * 4 + 2]!
  }
  const target = coverageOf(a, 1, cutoff)
  let s = size
  while (s > 1) {
    const ns = s >> 1
    const na = new Float32Array(ns * ns)
    const nrgb = new Float32Array(ns * ns * 3)
    for (let y = 0; y < ns; y++) {
      for (let x = 0; x < ns; x++) {
        let sa = 0
        let r = 0
        let g = 0
        let b = 0
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const j = (y * 2 + dy) * s + x * 2 + dx
            const w = a[j]!
            sa += w
            r += rgb[j * 3]! * w
            g += rgb[j * 3 + 1]! * w
            b += rgb[j * 3 + 2]! * w
          }
        }
        const i = y * ns + x
        na[i] = sa / 4
        if (sa > 1e-4) {
          nrgb[i * 3] = r / sa
          nrgb[i * 3 + 1] = g / sa
          nrgb[i * 3 + 2] = b / sa
        } else {
          nrgb[i * 3] = fill[0]
          nrgb[i * 3 + 1] = fill[1]
          nrgb[i * 3 + 2] = fill[2]
        }
      }
    }
    let lo = 0.5
    let hi = 6
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) * 0.5
      if (coverageOf(na, mid, cutoff) < target) lo = mid
      else hi = mid
    }
    const scale = (lo + hi) * 0.5
    const data = new Uint8Array(ns * ns * 4)
    for (let i = 0; i < ns * ns; i++) {
      data[i * 4] = nrgb[i * 3]!
      data[i * 4 + 1] = nrgb[i * 3 + 1]!
      data[i * 4 + 2] = nrgb[i * 3 + 2]!
      data[i * 4 + 3] = Math.min(255, na[i]! * scale * 255)
    }
    levels.push({ data, width: ns, height: ns })
    // the next level filters the unscaled alpha, so the scale never compounds
    a = na
    rgb = nrgb
    s = ns
  }
  return levels
}

function strokePath(ctx: Paint, pts: { x: number; y: number }[], w0: number, w1: number, style: string): void {
  ctx.strokeStyle = style
  ctx.lineCap = 'round'
  for (let i = 1; i < pts.length; i++) {
    const s = i / (pts.length - 1)
    ctx.lineWidth = w0 + (w1 - w0) * s
    ctx.beginPath()
    ctx.moveTo(pts[i - 1]!.x, pts[i - 1]!.y)
    ctx.lineTo(pts[i]!.x, pts[i]!.y)
    ctx.stroke()
  }
}

function wanderTwig(r: Rand, x: number, y: number, ang: number, len: number, n: number, wobble: number): { x: number; y: number }[] {
  const pts = [{ x, y }]
  let a = ang
  for (let i = 0; i < n; i++) {
    a += (r() - 0.5) * wobble
    x += Math.cos(a) * (len / n)
    y += Math.sin(a) * (len / n)
    pts.push({ x, y })
  }
  return pts
}

function petalPath(ctx: Paint, R: number): void {
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(-0.5 * R, -0.22 * R, -0.66 * R, -0.82 * R, -0.2 * R, -1.0 * R)
  ctx.quadraticCurveTo(-0.06 * R, -1.0 * R, 0, -0.85 * R)
  ctx.quadraticCurveTo(0.06 * R, -1.0 * R, 0.2 * R, -1.0 * R)
  ctx.bezierCurveTo(0.66 * R, -0.82 * R, 0.5 * R, -0.22 * R, 0, 0)
  ctx.closePath()
}

function drawBlossom(ctx: Paint, pass: Pass, r: Rand, x: number, y: number, R: number, shade: number): void {
  const rot = r() * Math.PI * 2
  const squash = 0.45 + r() * 0.55
  const pink = 0.5 + r() * 0.5
  // the stream must advance the same in both passes, so draw everything first
  const jit: number[] = []
  for (let k = 0; k < 5; k++) jit.push((r() - 0.5) * 0.25, 0.9 + r() * 0.2)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.scale(1, squash)
  ctx.rotate(r() * Math.PI)
  for (let k = 0; k < 5; k++) {
    ctx.save()
    ctx.rotate((k / 5) * Math.PI * 2 + jit[k * 2]!)
    const pr = R * jit[k * 2 + 1]! * 0.94
    petalPath(ctx, pr)
    if (pass === 'color') {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, pr)
      g.addColorStop(0, rgbStr((0.88 - 0.04 * pink) * shade, (0.5 - 0.1 * pink) * shade, (0.6 - 0.06 * pink) * shade))
      g.addColorStop(0.22, rgbStr((0.94 - 0.02 * pink) * shade, (0.72 - 0.08 * pink) * shade, (0.78 - 0.05 * pink) * shade))
      g.addColorStop(0.45, rgbStr(0.97 * shade, (0.84 - 0.06 * pink) * shade, (0.87 - 0.04 * pink) * shade))
      g.addColorStop(1, rgbStr(1.0 * shade, (0.96 - 0.03 * pink) * shade, 0.96 * shade))
      ctx.fillStyle = g
      ctx.fill()
      // a fine darker rim parts each petal from the next, so the five-petal shape
      // still reads when a flower is only a few pixels across
      ctx.lineWidth = Math.max(0.8, R * 0.05)
      ctx.strokeStyle = rgbStr(0.74 * shade, 0.5 * shade, 0.58 * shade, 0.75)
      ctx.stroke()
    } else {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, pr)
      g.addColorStop(0, grey(0.45 + shade * 0.2))
      g.addColorStop(1, grey(0.62 + shade * 0.3))
      ctx.fillStyle = g
      ctx.fill()
    }
    ctx.restore()
  }
  // the reddening eye and the stamens
  const stamens = 14
  for (let k = 0; k < stamens; k++) {
    const a = (k / stamens) * Math.PI * 2 + r() * 0.3
    const l = R * (0.28 + r() * 0.14)
    if (pass === 'color') {
      ctx.strokeStyle = rgbStr(0.93 * shade, 0.83 * shade, 0.84 * shade, 0.9)
      ctx.lineWidth = Math.max(0.5, R * 0.03)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a) * l, Math.sin(a) * l)
      ctx.stroke()
      ctx.fillStyle = rgbStr(0.88 * shade, 0.72 * shade, 0.45 * shade)
      ctx.beginPath()
      ctx.arc(Math.cos(a) * l, Math.sin(a) * l, Math.max(0.6, R * 0.045), 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.beginPath()
  ctx.arc(0, 0, R * 0.11, 0, Math.PI * 2)
  ctx.fillStyle = pass === 'color' ? rgbStr(0.84 * shade, 0.46 * shade, 0.55 * shade) : grey(0.4)
  ctx.fill()
  ctx.restore()
}

function drawYoungLeaf(ctx: Paint, pass: Pass, r: Rand, x: number, y: number, L: number, ang: number, shade: number): void {
  const bronze = r()
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  ctx.scale(1, 0.5 + r() * 0.5)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.bezierCurveTo(L * 0.3, -L * 0.22, L * 0.75, -L * 0.2, L, 0)
  ctx.bezierCurveTo(L * 0.75, L * 0.2, L * 0.3, L * 0.22, 0, 0)
  if (pass === 'color') {
    const g = ctx.createLinearGradient(0, 0, L, 0)
    g.addColorStop(0, rgbStr((0.36 + 0.1 * bronze) * shade, (0.4 - 0.04 * bronze) * shade, 0.18 * shade))
    g.addColorStop(1, rgbStr((0.46 + 0.1 * bronze) * shade, (0.52 - 0.06 * bronze) * shade, 0.24 * shade))
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = rgbStr(0.3 * shade, 0.28 * shade, 0.1 * shade, 0.6)
    ctx.lineWidth = Math.max(0.5, L * 0.02)
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(L * 0.95, 0)
    ctx.stroke()
  } else {
    ctx.fillStyle = grey(0.5 + shade * 0.15)
    ctx.fill()
  }
  ctx.restore()
}

// a closed bud: a deeper pink drop in a dark calyx, pointing away from its stalk
function drawBud(ctx: Paint, pass: Pass, x: number, y: number, R: number, ang: number, shade: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.45, R * 0.3, R * 0.5, 0, 0, Math.PI * 2)
  if (pass === 'color') {
    const g = ctx.createLinearGradient(0, 0, 0, -R * 0.95)
    g.addColorStop(0, rgbStr(0.72 * shade, 0.3 * shade, 0.4 * shade))
    g.addColorStop(1, rgbStr(0.95 * shade, 0.62 * shade, 0.72 * shade))
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = grey(0.6 + shade * 0.2)
  }
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(0, -R * 0.08, R * 0.2, R * 0.16, 0, 0, Math.PI * 2)
  ctx.fillStyle = pass === 'color' ? rgbStr(0.38 * shade, 0.14 * shade, 0.14 * shade) : grey(0.45)
  ctx.fill()
  ctx.restore()
}

function paintBlossomCell(ctx: Paint, pass: Pass, r: Rand, ox: number, oy: number, S: number): void {
  const twigCol = pass === 'color' ? rgbStr(0.19, 0.12, 0.11) : grey(0.42)
  const main = wanderTwig(r, ox + S * (0.35 + r() * 0.3), oy + S * 1.02, -Math.PI / 2 + (r() - 0.5) * 0.7, S * 0.85, 16, 0.3)
  const twigs = [main]
  const spurs = 2 + Math.floor(r() * 3)
  for (let i = 0; i < spurs; i++) {
    const at = main[4 + Math.floor(r() * 10)]!
    const side = r() < 0.5 ? -1 : 1
    twigs.push(wanderTwig(r, at.x, at.y, -Math.PI / 2 + side * (0.6 + r() * 0.6), S * (0.2 + r() * 0.25), 10, 0.35))
  }
  // the twig is clearly there under the flowers: they hang from it
  twigs.forEach((t, i) => strokePath(ctx, t, S * (i === 0 ? 0.013 : 0.008), S * 0.004, twigCol))
  interface F {
    x: number
    y: number
    R: number
    depth: number
    ux: number
    uy: number
    bud: boolean
  }
  const flowers: F[] = []
  // full bloom: a packed ball of flowers about 3 cm across, with small gaps
  const umbels = 32 + Math.floor(r() * 8)
  const R0 = S * 0.037
  for (let u = 0; u < umbels; u++) {
    const t = twigs[Math.floor(r() * twigs.length)]!
    const p = t[1 + Math.floor(r() * (t.length - 1))]!
    const n = 3 + Math.floor(r() * 3)
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2
      const l = S * (0.02 + r() * 0.04)
      const R = R0 * (0.8 + r() * 0.4)
      const fx = p.x + Math.cos(a) * l
      const fy = p.y + Math.sin(a) * l
      const depth = r()
      const bud = r() < 0.14
      // a rounded cluster: nothing near the cell edges, so cards never show a straight cut
      if (Math.hypot(fx - ox - S / 2, fy - oy - S / 2) > S * 0.5 - R * 1.1) continue
      flowers.push({ x: fx, y: fy, R, depth, ux: p.x, uy: p.y, bud })
    }
    if (r() < 0.14) {
      const a = r() * Math.PI * 2
      drawYoungLeaf(ctx, pass, r, p.x, p.y, S * (0.06 + r() * 0.05), a, 0.85 + r() * 0.15)
    }
  }
  flowers.sort((a, b) => a.depth - b.depth)
  // pedicels from the spur to each flower
  for (const f of flowers) {
    ctx.strokeStyle = pass === 'color' ? rgbStr(0.36, 0.17, 0.16) : grey(0.45)
    ctx.lineWidth = Math.max(0.7, S * 0.0034)
    ctx.beginPath()
    ctx.moveTo(f.ux, f.uy)
    ctx.lineTo(f.x, f.y)
    ctx.stroke()
  }
  for (const f of flowers) {
    // flowers deeper in the cluster are in each other's shade
    const shade = 0.62 + Math.pow(f.depth, 0.7) * 0.38
    if (pass === 'color') {
      // a soft contact shadow on whatever lies behind, so the ball has depth
      const sh = ctx.createRadialGradient(f.x, f.y + f.R * 0.25, 0, f.x, f.y + f.R * 0.25, f.R * 1.35)
      sh.addColorStop(0, 'rgba(70,30,45,0.32)')
      sh.addColorStop(1, 'rgba(70,30,45,0)')
      ctx.fillStyle = sh
      ctx.beginPath()
      ctx.arc(f.x, f.y + f.R * 0.25, f.R * 1.35, 0, Math.PI * 2)
      ctx.fill()
    }
    if (f.bud) drawBud(ctx, pass, f.x, f.y, f.R, Math.atan2(f.y - f.uy, f.x - f.ux) + Math.PI / 2, shade)
    else drawBlossom(ctx, pass, r, f.x, f.y, f.R, shade)
  }
}

function drawMapleLeaf(ctx: Paint, pass: Pass, r: Rand, x: number, y: number, R: number, ang: number, shade: number): void {
  const squash = 0.55 + r() * 0.45
  const hue = r()
  const lobes = [0, 0.52, -0.52, 1.04, -1.04, 1.6, -1.6]
  const lens = [1, 0.92, 0.92, 0.76, 0.76, 0.42, 0.42]
  const phase = r() * 10
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  ctx.scale(squash, 1)
  const dark = [0.32 - 0.06 * hue, 0.03, 0.06 + 0.04 * hue]
  const mid = [0.55 - 0.08 * hue, 0.07, 0.1 + 0.05 * hue]
  const tip = [0.66 - 0.06 * hue, 0.12, 0.14 + 0.04 * hue]
  for (let k = 0; k < 7; k++) {
    const la = lobes[k]! + (r() - 0.5) * 0.12
    const L = R * lens[k]! * (0.92 + r() * 0.16)
    ctx.save()
    ctx.rotate(la)
    ctx.beginPath()
    const N = 26
    const left: number[] = []
    for (let i = 0; i <= N; i++) {
      const s = i / N
      const body = Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.15)), 0.9) * Math.pow(1 - s, 0.45)
      const teeth = 1 + 0.16 * Math.abs(Math.sin(s * 34 + phase + k)) * s
      left.push(Math.max(0.05 * R * (1 - s), body * 0.2 * L * teeth))
    }
    ctx.moveTo(0, 0)
    for (let i = 0; i <= N; i++) ctx.lineTo(-left[i]!, -(i / N) * L)
    for (let i = N; i >= 0; i--) ctx.lineTo(left[i]! * (0.95 + 0.1 * Math.sin(i + phase)), -(i / N) * L)
    ctx.closePath()
    if (pass === 'color') {
      const g = ctx.createLinearGradient(0, 0, 0, -L)
      g.addColorStop(0, rgbStr(dark[0]! * shade, dark[1]! * shade, dark[2]! * shade))
      g.addColorStop(0.45, rgbStr(mid[0]! * shade, mid[1]! * shade, mid[2]! * shade))
      g.addColorStop(1, rgbStr(tip[0]! * shade, tip[1]! * shade, tip[2]! * shade))
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = rgbStr(0.2 * shade, 0.02, 0.04, 0.55)
      ctx.lineWidth = Math.max(0.5, R * 0.018)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -L * 0.9)
      ctx.stroke()
    } else {
      ctx.fillStyle = grey(0.55 + shade * 0.2)
      ctx.fill()
      ctx.strokeStyle = grey(0.4)
      ctx.lineWidth = Math.max(0.8, R * 0.03)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(0, -L * 0.9)
      ctx.stroke()
    }
    ctx.restore()
  }
  ctx.restore()
}

function paintMapleCell(ctx: Paint, pass: Pass, r: Rand, ox: number, oy: number, S: number): void {
  const twigCol = pass === 'color' ? rgbStr(0.28, 0.12, 0.1) : grey(0.42)
  const startSide = r() < 0.5
  const main = wanderTwig(r, startSide ? ox - S * 0.02 : ox + S * 1.02, oy + S * (0.45 + r() * 0.2), startSide ? (r() - 0.5) * 0.4 : Math.PI + (r() - 0.5) * 0.4, S * 0.9, 8, 0.35)
  const twigs = [main]
  for (let i = 0; i < 3; i++) {
    const at = main[2 + Math.floor(r() * 5)]!
    const base = startSide ? 0 : Math.PI
    twigs.push(wanderTwig(r, at.x, at.y, base + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7), S * (0.22 + r() * 0.2), 5, 0.5))
  }
  twigs.forEach((t, i) => strokePath(ctx, t, S * (i === 0 ? 0.011 : 0.007), S * 0.003, twigCol))
  interface L {
    x: number
    y: number
    ax: number
    ay: number
    ang: number
    depth: number
    R: number
  }
  const leaves: L[] = []
  const n = 24 + Math.floor(r() * 8)
  for (let i = 0; i < n; i++) {
    const t = twigs[Math.floor(r() * twigs.length)]!
    const p = t[1 + Math.floor(r() * (t.length - 1))]!
    const a = r() * Math.PI * 2
    const pl = S * (0.03 + r() * 0.05)
    const R = S * (0.085 + r() * 0.05)
    const lx = Math.min(ox + S - R * 0.8, Math.max(ox + R * 0.8, p.x + Math.cos(a) * (pl + R * 0.15)))
    const ly = Math.min(oy + S - R * 0.8, Math.max(oy + R * 0.8, p.y + Math.sin(a) * (pl + R * 0.15)))
    leaves.push({ x: lx, y: ly, ax: p.x, ay: p.y, ang: a + Math.PI / 2, depth: r(), R })
  }
  leaves.sort((a, b) => a.depth - b.depth)
  for (const l of leaves) {
    ctx.strokeStyle = pass === 'color' ? rgbStr(0.45, 0.08, 0.1) : grey(0.45)
    ctx.lineWidth = Math.max(0.6, S * 0.003)
    ctx.beginPath()
    ctx.moveTo(l.ax, l.ay)
    ctx.lineTo(l.x, l.y)
    ctx.stroke()
  }
  for (const l of leaves) drawMapleLeaf(ctx, pass, r, l.x, l.y, l.R, l.ang, 0.62 + l.depth * 0.38)
}

// A sugi spray: a forking cord of short awl-shaped needles wound round each
// axis, so it reads as ropy, dense foliage rather than as flat fern fronds.
function paintCedarCell(ctx: Paint, pass: Pass, r: Rand, ox: number, oy: number, S: number): void {
  interface Axis {
    pts: { x: number; y: number }[]
    w: number
    depth: number
  }
  const axes: Axis[] = []
  const sprays = 6 + Math.floor(r() * 3)
  for (let k = 0; k < sprays; k++) {
    const sx = ox + S * (0.15 + r() * 0.7)
    const main = wanderTwig(r, sx, oy + S * (0.75 + r() * 0.3), -Math.PI / 2 + (r() - 0.5) * 1.2, S * (0.45 + r() * 0.35), 14, 0.22)
    const depth = r()
    axes.push({ pts: main, w: S * 0.04, depth })
    for (let i = 2; i < main.length - 1; i += 1) {
      const at = main[i]!
      const side = (i >> 1) % 2 === 0 ? -1 : 1
      const len = S * (0.1 + r() * 0.14) * (1 - (i / main.length) * 0.5)
      const a = -Math.PI / 2 + side * (0.55 + r() * 0.45)
      const sub = wanderTwig(r, at.x, at.y, a, len, 6, 0.3)
      axes.push({ pts: sub, w: S * 0.032, depth })
      if (r() < 0.5) {
        const mid = sub[3]!
        axes.push({ pts: wanderTwig(r, mid.x, mid.y, a - side * 0.6, len * 0.5, 4, 0.3), w: S * 0.026, depth })
      }
    }
  }
  axes.sort((a, b) => a.depth - b.depth)
  for (const ax of axes) {
    const shade = 0.6 + ax.depth * 0.4
    for (let i = 1; i < ax.pts.length; i++) {
      const a = ax.pts[i - 1]!
      const b = ax.pts[i]!
      const seg = Math.hypot(b.x - a.x, b.y - a.y)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const tip = i / (ax.pts.length - 1)
      const w = ax.w * (1 - tip * 0.45)
      const steps = Math.max(2, Math.round(seg / (S * 0.0045)))
      for (let k = 0; k < steps; k++) {
        const f = k / steps
        const px = a.x + (b.x - a.x) * f
        const py = a.y + (b.y - a.y) * f
        for (let n = 0; n < 3; n++) {
          // needles point forward and out, all round the cord
          const side = n === 0 ? -1 : n === 1 ? 1 : (r() - 0.5) * 0.6
          const na = ang + side * (0.5 + r() * 0.35)
          // needles shorten towards each tip, so sprays end in fine points
          const nl = w * (0.75 + r() * 0.5) * (1 - tip * 0.35)
          const lit = r()
          if (pass === 'color') {
            // dark, slightly blue green; the light needles sit at the tips
            const t2 = tip * tip
            const g = 0.1 + 0.04 * lit + 0.1 * t2
            ctx.strokeStyle = rgbStr((0.04 + 0.02 * lit + 0.03 * t2) * shade, g * shade, (0.09 + 0.04 * lit + 0.05 * t2) * shade)
          } else {
            ctx.strokeStyle = grey(0.45 + 0.3 * lit * shade)
          }
          ctx.lineWidth = Math.max(0.7, S * 0.0033)
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(px, py)
          ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl)
          ctx.stroke()
        }
      }
    }
  }
}

// textures shared by every tree of a kind, released with the last tree
const atlasCache = new Map<string, { atlas: Atlas; users: number }>()
// atlases painted ahead of the trees (in a worker), taken by the first tree
const atlasReady = new Map<string, AtlasData>()

export type AtlasKind = 'blossom' | 'maple' | 'cedar'

export function paintAtlasFor(kind: AtlasKind, tier: Tier): AtlasData {
  const size = tier === 'phone' ? 1024 : 2048
  return kind === 'blossom'
    ? paintAtlas(size, 4111, paintBlossomCell, 7)
    : kind === 'maple'
      ? paintAtlas(size, 9001, paintMapleCell, 3)
      : paintAtlas(size, 7307, paintCedarCell, 4)
}

// hands over an atlas painted elsewhere; the next tree of the kind uses it
export function provideAtlas(kind: AtlasKind, tier: Tier, data: AtlasData): void {
  if (!atlasCache.has(`${kind}-${tier}`)) atlasReady.set(`${kind}-${tier}`, data)
}

function acquireAtlas(kind: AtlasKind, tier: Tier): Atlas {
  const key = `${kind}-${tier}`
  let e = atlasCache.get(key)
  if (!e) {
    const data = atlasReady.get(key) ?? paintAtlasFor(kind, tier)
    atlasReady.delete(key)
    e = { atlas: atlasTextures(data), users: 0 }
    atlasCache.set(key, e)
  }
  e.users++
  return e.atlas
}

function releaseAtlas(kind: AtlasKind, tier: Tier): void {
  const key = `${kind}-${tier}`
  const e = atlasCache.get(key)
  if (!e) return
  if (--e.users <= 0) {
    e.atlas.map.dispose()
    e.atlas.normalMap.dispose()
    atlasCache.delete(key)
  }
}

// --- foliage cards -------------------------------------------------------------------

interface CrownShape {
  centre: THREE.Vector3
  radii: THREE.Vector3
  // vertical radius below the centre; an umbrella crown hangs much lower than it rises
  lowY: number
}

interface CardOpts {
  tips: Tip[]
  count: number
  size: [number, number]
  crown: CrownShape
  rand: Rand
  // how far card normals lean towards the crown's outward direction
  volume: number
  // 0: free orientation biased outward, 1: flat plates facing up
  plate: number
  // how much darker the inside of the crown is
  depthShade: number
  // cards gather into balls of blossom or plates of leaves along the twigs, with
  // gaps between them that show the limbs and the sky
  clusterRadius: number
  perCluster: number
  // vertical squash of a cluster (1 a ball, below 1 a plate)
  flat: number
  // true where no card may hang (the walk below the canopy)
  reject: (p: THREE.Vector3) => boolean
  // how much darker the heart of each cluster is than its shell
  ballShade?: number
}

function crownOutward(c: CrownShape, p: THREE.Vector3, out: THREE.Vector3): number {
  const ry = p.y < c.centre.y ? c.lowY : c.radii.y
  out.set((p.x - c.centre.x) / c.radii.x, (p.y - c.centre.y) / ry, (p.z - c.centre.z) / c.radii.z)
  const e = out.length()
  out.set(out.x / c.radii.x, out.y / ry, out.z / c.radii.z).normalize()
  return e
}

function buildCards(o: CardOpts): THREE.BufferGeometry {
  const r = o.rand
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const col: number[] = []
  const anchor: number[] = []
  const centre: number[] = []
  const faceN: number[] = []
  const sway: number[] = []
  const phase: number[] = []
  const idx: number[] = []
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const t1 = new THREE.Vector3()
  const t2 = new THREE.Vector3()
  const out = new THREE.Vector3()
  const v = new THREE.Vector3()
  const vn = new THREE.Vector3()
  const bo = new THREE.Vector3()
  const tmp = new THREE.Vector3()
  // cluster seats along the twigs, kept apart so each one reads on its own
  const R = o.clusterRadius
  const want = Math.max(1, Math.round(o.count / o.perCluster))
  const seats: Tip[] = []
  const minGap = R * 1.25
  for (let i = 0; i < want * 6 && seats.length < want; i++) {
    const tip = o.tips[Math.floor(r() * o.tips.length)]!
    if (o.reject(tip.p)) continue
    let free = true
    for (const s of seats) {
      if (s.p.distanceToSquared(tip.p) < minGap * minGap) {
        free = false
        break
      }
    }
    if (free) seats.push(tip)
  }
  if (seats.length === 0) seats.push(o.tips[0]!)
  let made = 0
  for (let i = 0; i < o.count * 2 && made < o.count; i++) {
    const seat = seats[i % seats.length]!
    // a point in the cluster, pushed towards its shell so it has a surface
    randUnit(r, tmp)
    const rr = Math.pow(r(), 0.45) * R
    c.set(tmp.x * rr, tmp.y * rr * o.flat, tmp.z * rr).add(seat.p)
    if (o.reject(c)) continue
    bo.set(tmp.x, tmp.y / Math.max(0.2, o.flat), tmp.z).normalize()
    crownOutward(o.crown, c, out)
    if (o.plate > 0) {
      n.set(0, 1, 0).addScaledVector(bo, 0.45).addScaledVector(randUnit(r, tmp), 0.5).normalize()
    } else {
      n.copy(bo).addScaledVector(out, 0.4).addScaledVector(randUnit(r, tmp), 0.6).normalize()
    }
    randUnit(r, tmp)
    t1.crossVectors(n, tmp).normalize()
    t2.crossVectors(n, t1).normalize()
    const hs = (o.size[0] + (o.size[1] - o.size[0]) * r()) * 0.5
    const cell = Math.floor(r() * 4)
    const u0 = (cell % 2) * 0.5
    const v0 = Math.floor(cell / 2) * 0.5
    const ph = r() * 40
    const tint = 0.94 + r() * 0.08
    const shell = rr / R
    const base = pos.length / 3
    for (let k = 0; k < 4; k++) {
      const sx = k === 0 || k === 3 ? -1 : 1
      const sy = k < 2 ? -1 : 1
      v.copy(c).addScaledVector(t1, sx * hs).addScaledVector(t2, sy * hs)
      pos.push(v.x, v.y, v.z)
      // the normal rounds over the cluster first and the whole crown second
      const ev = crownOutward(o.crown, v, vn)
      tmp.subVectors(v, seat.p)
      tmp.y /= Math.max(0.2, o.flat)
      tmp.normalize()
      vn.multiplyScalar(0.35).addScaledVector(tmp, 0.65).normalize()
      vn.multiplyScalar(o.volume).addScaledVector(n.dot(vn) >= 0 ? n : n.clone().negate(), 1 - o.volume).normalize()
      nor.push(vn.x, vn.y, vn.z)
      uv.push(u0 + 0.004 + (sx * 0.5 + 0.5) * 0.492, v0 + 0.004 + (sy * 0.5 + 0.5) * 0.492)
      // the heart of each cluster and the inner and lower crown get less sky
      const inner = THREE.MathUtils.smoothstep(ev, 0.25, 1.0)
      const low = THREE.MathUtils.smoothstep(v.y, o.crown.centre.y - o.crown.lowY, o.crown.centre.y + o.crown.radii.y * 0.6)
      const bs = o.ballShade ?? 0.45
      const ball = 1 - bs + bs * THREE.MathUtils.smoothstep(shell, 0.2, 0.95)
      const ao = (1 - o.depthShade + o.depthShade * inner) * (0.7 + 0.3 * low) * ball * tint
      col.push(ao, ao * (0.985 + 0.03 * r()), ao)
      anchor.push(seat.p.x, seat.p.y, seat.p.z)
      centre.push(c.x, c.y, c.z)
      faceN.push(n.x, n.y, n.z)
      sway.push(seat.sway)
      phase.push(ph)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    made++
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('aAnchor', new THREE.Float32BufferAttribute(anchor, 3))
  g.setAttribute('aCentre', new THREE.Float32BufferAttribute(centre, 3))
  g.setAttribute('aFaceN', new THREE.Float32BufferAttribute(faceN, 3))
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1))
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

function collectTips(limbs: Limb[], minDepth: number, from: number, step: number): Tip[] {
  const tips: Tip[] = []
  const p = new THREE.Vector3()
  for (const l of limbs) {
    if (l.depth < minDepth) continue
    let len = 0
    for (let i = 1; i < l.pts.length; i++) len += l.pts[i]!.distanceTo(l.pts[i - 1]!)
    const n = Math.max(1, Math.round((len * (1 - from)) / step))
    for (let i = 0; i <= n; i++) {
      const t = from + (1 - from) * (i / n)
      const info = limbPoint(l, t, p)
      tips.push({ p: p.clone(), sway: info.sway })
    }
  }
  return tips
}

// --- the cherry ---------------------------------------------------------------------

export interface CherryOpts {
  tier: Tier
  x: number
  z: number
  height: number
  spread: number
  lean: { x: number; z: number }
  seed: number
}

function radialFor(tier: Tier, r: number): number {
  const q = tier === 'ultra' ? 1 : tier === 'high' ? 0.8 : 0.55
  return Math.max(3, Math.round((r > 0.15 ? 18 : r > 0.06 ? 12 : r > 0.025 ? 7 : 4) * q))
}

class Tree implements RealmPart {
  readonly object = new THREE.Group()
  protected geometries: THREE.BufferGeometry[] = []
  protected materials: THREE.Material[] = []

  protected addMesh(g: THREE.BufferGeometry, m: THREE.Material, cast: boolean): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m)
    mesh.castShadow = cast
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    this.geometries.push(g)
    if (!this.materials.includes(m)) this.materials.push(m)
    this.object.add(mesh)
    return mesh
  }

  // Foliage casts from a blurred level of its painting: the shadow of a cluster is
  // a solid soft mass. Cast from every flower hole, the shadow map's texel grid
  // shows on the cards behind as a regular stipple, worst with the phone map size.
  //
  // The cards do not take the shadow map themselves. At these sizes a card lies
  // inside or right behind the casters of its neighbours, and the comparison
  // flickers between shadow texels across its face: a grey checker up close. The
  // crown's own shading comes from the baked depth, cluster and height terms in
  // the vertex colours instead, which also keep the back light from blowing out.
  protected addFoliage(g: THREE.BufferGeometry, m: THREE.Material): void {
    const mesh = this.addMesh(g, m, true)
    mesh.receiveShadow = false
    const depth = new THREE.MeshDepthMaterial()
    depth.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
        diffuseColor *= texture2D( map, vMapUv, 4.5 );
        #endif`,
      )
    }
    depth.customProgramCacheKey = () => 'realm-foliage-depth'
    mesh.customDepthMaterial = depth
    this.materials.push(depth)
  }

  protected place(x: number, z: number): void {
    this.object.position.set(x, groundHeight(x, z), z)
    this.object.updateMatrix()
    this.object.matrixAutoUpdate = false
    this.object.updateMatrixWorld(true)
  }

  update(): void {
    // motion lives in the shaders on the shared realm uniforms
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
    this.geometries.length = 0
    this.materials.length = 0
  }
}

// a tree's geometry without its materials, so it can be grown in a worker
export interface TreeShape {
  bark: THREE.BufferGeometry
  cards: THREE.BufferGeometry
  swayNorm: number
}

export interface GroveShape {
  bark: THREE.BufferGeometry
  cards: THREE.BufferGeometry
  rope: THREE.BufferGeometry | null
}

export class CherryTree extends Tree {
  private tier: Tier

  constructor(opts: CherryOpts, shape: TreeShape = cherryShape(opts)) {
    super()
    this.tier = opts.tier
    const bark = barkMaterial(opts.tier, 'sakura_bark', 0x3b2c29, 0x8a7e7b, 0.11, shape.swayNorm)
    this.addMesh(shape.bark, bark, true)
    const atlas = acquireAtlas('blossom', opts.tier)
    // a season may tone the blossom for its light
    const tone = dressFor<BlossomDress>('Blossom')?.crown
    const mat = foliageMaterial({
      key: 'blossom',
      map: atlas.map,
      normalMap: atlas.normalMap,
      trans: tone?.trans ?? 0.95,
      transTint: tone?.transTint ?? new THREE.Color(1.0, 0.86, 0.88),
      roughness: 0.8,
      branchAmp: 0.11,
      cardAmp: 0.035,
      swayNorm: shape.swayNorm,
      volumeNormals: true,
      instanced: false,
      farStart: 14,
      softEdge: true,
    })
    if (tone) mat.color.copy(tone.color)
    this.addFoliage(shape.cards, mat)
    this.place(opts.x, opts.z)
  }

  override dispose(): void {
    super.dispose()
    releaseAtlas('blossom', this.tier)
  }
}

export function cherryShape(opts: CherryOpts): TreeShape {
  const r = rng(opts.seed)
  const H = opts.height
  const W = opts.spread
  const scale = H / 7.4
  const limbs: Limb[] = []
  const segLen = opts.tier === 'phone' ? 0.45 : 0.3
  // the side of the tree that faces water: the crown leans out over it
  let pondAz = 0
  let pondBest = Infinity
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const d = pondSdf(opts.x + Math.cos(a) * W * 0.9, opts.z + Math.sin(a) * W * 0.9)
    if (d < pondBest) {
      pondBest = d
      pondAz = a
    }
  }
  const towardPond = pondBest < 1.5
  const crown: CrownShape = {
    centre: new THREE.Vector3(
      opts.lean.x * H * 0.08 + (towardPond ? Math.cos(pondAz) * 0.7 : 0),
      H * 0.55,
      opts.lean.z * H * 0.08 + (towardPond ? Math.sin(pondAz) * 0.7 : 0),
    ),
    // a broad, flat umbrella: much wider than tall, flat on top, hanging low at the rim
    radii: new THREE.Vector3(W * 1.12, H * 0.27, W * 1.05),
    lowY: H * 0.5,
  }
  const maxDepth = 4

  // the trunk: short, thick and leaning, splitting low
  const trunkLen = H * 0.24
  const leanDir = new THREE.Vector3(opts.lean.x, 1, opts.lean.z).normalize()
  const trunk = grow({
    start: new THREE.Vector3(0, -0.25, 0),
    dir: leanDir,
    length: trunkLen + 0.25,
    r0: 0.3 * scale,
    r1: 0.22 * scale,
    depth: 0,
    sway0: 0,
    segLen: 0.25,
    bend: (d) => {
      d.x += (r() - 0.5) * 0.18
      d.z += (r() - 0.5) * 0.18
      d.lerp(UP, 0.12)
    },
  })
  // the trunk ends inside the scaffold limbs, so its open end never shows
  const last = trunk.radii.length - 1
  trunk.radii[last] = 0.14 * scale
  limbs.push(trunk)
  const out = new THREE.Vector3()
  const tmp = new THREE.Vector3()

  const branch = (start: THREE.Vector3, dir: THREE.Vector3, length: number, r0: number, depth: number, sway0: number, weep: number): void => {
    const droop = ([0, 0, 0.02, 0.05, 0.09][depth] ?? 0.09) * weep
    const limb = grow({
      start,
      dir,
      length,
      r0,
      // fine twigs end at about 1 cm so they still draw as dark lines between clusters
      r1: Math.max(depth >= maxDepth ? 0.0025 : 0.01, r0 * (depth >= maxDepth ? 0.1 : 0.12)),
      depth,
      sway0,
      segLen: depth < 2 ? segLen : segLen * 1.3,
      bend: (d, s, p) => {
        d.x += (r() - 0.5) * 0.22
        d.y += (r() - 0.5) * 0.12
        d.z += (r() - 0.5) * 0.22
        // tips arch over and droop; inside the crown they reach for light
        d.y -= droop * Math.pow(s, 1.4) * 2.2
        out.set(p.x - crown.centre.x, 0, p.z - crown.centre.z)
        if (out.lengthSq() > 1e-4) d.addScaledVector(out.normalize(), 0.06)
        if (p.y > crown.centre.y + crown.radii.y * 0.85) d.y -= 0.08
        // over the walk the limbs lift to clear the visitor's head
        if (overWalk(opts.x + p.x) && p.y < WALK_CLEAR + 0.4) d.y += 0.22
      },
    })
    limbs.push(limb)
    if (depth >= maxDepth) return
    const kids = depth === 1 ? 4 + Math.floor(r() * 2) : depth === 2 ? 3 + Math.floor(r() * 2) : 3
    const p = new THREE.Vector3()
    for (let k = 0; k < kids; k++) {
      const t = 0.28 + (0.68 * (k + r() * 0.8)) / kids
      const info = limbPoint(limb, t, p)
      const cd = deviate(info.dir, 0.45 + r() * 0.45, r, new THREE.Vector3())
      out.set(p.x - crown.centre.x, 0, p.z - crown.centre.z).normalize()
      // alternate between reaching out and climbing into the crown, so it fills rather than hollows
      if (k % 2 === 0) cd.addScaledVector(out, 0.45).addScaledVector(UP, depth < 2 ? 0.12 : 0.04)
      else cd.addScaledVector(UP, 0.45).addScaledVector(out, 0.05)
      // on the scaffolds every third child swings sideways, closing the gaps between them
      if (depth <= 2 && k % 3 === 2) cd.addScaledVector(tmp.crossVectors(UP, out).normalize(), r() < 0.5 ? -0.8 : 0.8)
      cd.normalize()
      let L = length * (0.55 + r() * 0.2) * (1 - t * 0.35)
      // keep tips inside the crown envelope
      tmp.copy(p).addScaledVector(cd, L)
      const e = crownOutward(crown, tmp, new THREE.Vector3())
      if (e > 1.05) L *= Math.max(0.35, 1.05 / e)
      // the child starts on the parent's axis so its base ring is buried in the parent
      branch(p.clone(), cd, L, Math.max(0.014, info.r * (0.55 + r() * 0.15)), depth + 1, info.sway, weep)
    }
  }

  const walkDx = -opts.x
  const walkDz = 1.6
  const walkAz = Math.atan2(walkDz, walkDx)
  const walkReach = Math.hypot(walkDx, walkDz) + 1.3
  const reachesWalk = Math.abs(opts.x) < W * 1.5
  // five spreading scaffolds and one that climbs, so the crown has a roof
  const scaffolds = 6
  const az0 = r() * Math.PI * 2
  for (let k = 0; k < scaffolds; k++) {
    // the first scaffold reaches out low over the water and weeps towards it
    // one scaffold reaches over the walk, a little towards the arrival, so the
    // visitor passes under blossom
    const toWalk = k === 2 && reachesWalk
    let az = (towardPond ? pondAz : az0) + (k / 5) * Math.PI * 2 + (k === 0 ? 0 : (r() - 0.5) * 0.5)
    if (toWalk) az = walkAz
    const elev = k === 5 ? 1.0 : k === 0 && towardPond ? 0.1 : toWalk ? 0.3 : 0.22 + r() * 0.28
    const d = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev))
    d.addScaledVector(leanDir, 0.3).normalize()
    // the climbing limb leans back against the trunk, so the middle of the crown is not a gap
    if (k === 5) d.set(-opts.lean.x * 0.7 + Math.cos(az) * 0.15, 1, -opts.lean.z * 0.7 + Math.sin(az) * 0.15).normalize()
    // no scaffold climbs steeper than about 50 degrees; the crown spreads
    if (k < 5 && d.y > 0.77) {
      const hz = Math.sqrt(1 - 0.77 * 0.77) / Math.hypot(d.x, d.z)
      d.set(d.x * hz, 0.77, d.z * hz)
    }
    const start = trunk.pts[trunk.pts.length - 1 - (k % 2)]!.clone()
    const low = k === 0 && towardPond
    const len = toWalk ? walkReach : W * (k === 5 ? 0.72 : low ? 1.22 : 0.88 + r() * 0.14)
    branch(start, d, len, 0.17 * scale * (k === 5 ? 0.75 : low ? 1.05 : 0.85 + r() * 0.25), 1, trunkLen, low ? 2.1 : toWalk ? 0.5 : 1.15)
  }

  const tubes = new TubeBuilder()
  for (const l0 of limbs) {
    if (opts.tier === 'phone' && l0.depth >= maxDepth) continue
    // the last twigs end inside their blossom rather than poking past it
    const l = l0.depth >= maxDepth ? trimLimb(l0, 0.62) : l0
    const r0 = l.radii[0]!
    tubes.add(l, {
      radial: radialFor(opts.tier, r0),
      texWorld: 0.55,
      gnarl: l.depth === 0 ? 0.22 : l.depth === 1 ? 0.14 : 0.05,
      flare: l === trunk ? 0.9 : 0,
      seed: r() * 50,
    })
  }
  const swayNorm = trunkLen + W * 1.6
  const barkGeometry = tubes.build()

  // blossom sits on the outer twigs and the scaffold ends; the thick limbs inside
  // stay bare, so they read dark between the clusters
  const tips = collectTips(limbs, maxDepth - 1, 0.3, 0.1)
  tips.push(...collectTips(limbs.filter((l) => l.depth === 1 || l.depth === 2), 1, 0.85, 0.1))
  const count = opts.tier === 'ultra' ? 6000 : opts.tier === 'high' ? 4400 : 2400
  const sz: [number, number] = opts.tier === 'phone' ? [0.46, 0.74] : [0.36, 0.6]
  const reject = (p: THREE.Vector3) => overWalk(opts.x + p.x) && p.y < WALK_CLEAR
  const cards = buildCards({
    tips, count, size: sz, crown, rand: r, volume: 0.75, plate: 0, depthShade: 0.62,
    clusterRadius: 0.36, perCluster: opts.tier === 'phone' ? 11 : 16, flat: 0.8, reject, ballShade: 0.6,
  })
  return { bark: barkGeometry, cards, swayNorm }
}

// --- the maples ---------------------------------------------------------------------

export interface MapleOpts {
  tier: Tier
  x: number
  z: number
  height: number
  spread: number
  seed: number
}

export class MapleTree extends Tree {
  private tier: Tier

  constructor(opts: MapleOpts, shape: TreeShape = mapleShape(opts)) {
    super()
    this.tier = opts.tier
    const bark = barkMaterial(opts.tier, 'maple_bark', 0x5d564f, 0x958b84, 0.14, shape.swayNorm)
    this.addMesh(shape.bark, bark, true)
    const atlas = acquireAtlas('maple', opts.tier)
    const mat = foliageMaterial({
      key: 'maple',
      map: atlas.map,
      normalMap: atlas.normalMap,
      trans: 1.1,
      transTint: new THREE.Color(1.0, 0.42, 0.32),
      roughness: 0.84,
      branchAmp: 0.14,
      cardAmp: 0.04,
      swayNorm: shape.swayNorm,
      volumeNormals: true,
      instanced: false,
      farStart: 14,
      softEdge: true,
    })
    this.addFoliage(shape.cards, mat)
    this.place(opts.x, opts.z)
  }

  override dispose(): void {
    super.dispose()
    releaseAtlas('maple', this.tier)
  }
}

export function mapleShape(opts: MapleOpts): TreeShape {
  const r = rng(opts.seed)
  const H = opts.height
  const W = opts.spread
  const limbs: Limb[] = []
  const segLen = opts.tier === 'phone' ? 0.4 : 0.26
  const crown: CrownShape = {
    centre: new THREE.Vector3(0, H * 0.58, 0),
    radii: new THREE.Vector3(W, H * 0.45, W),
    lowY: H * 0.45,
  }
  const maxDepth = 3

  const branch = (start: THREE.Vector3, dir: THREE.Vector3, length: number, r0: number, depth: number, sway0: number): void => {
    const limb = grow({
      start,
      dir,
      length,
      r0,
      r1: Math.max(0.003, r0 * 0.25),
      depth,
      sway0,
      segLen,
      bend: (d, s, p) => {
        d.x += (r() - 0.5) * 0.26
        d.z += (r() - 0.5) * 0.26
        // ease into the horizontal: the layered habit of the tree
        d.y += (0.03 - d.y) * (0.05 + s * 0.16)
        if (overWalk(opts.x + p.x) && p.y < WALK_CLEAR + 0.3) d.y += 0.22
      },
    })
    limbs.push(limb)
    if (depth >= maxDepth) return
    const kids = depth === 1 ? 4 + Math.floor(r() * 2) : 4 + Math.floor(r() * 2)
    const p = new THREE.Vector3()
    for (let k = 0; k < kids; k++) {
      const t = 0.25 + (0.7 * (k + r() * 0.8)) / kids
      const info = limbPoint(limb, t, p)
      // fan out sideways in the horizontal plane
      const side = (k % 2 === 0 ? 1 : -1) * (0.45 + r() * 0.5)
      const cd = info.dir.clone().applyAxisAngle(UP, side)
      cd.y = 0.08 + r() * 0.22
      cd.normalize()
      const L = length * (0.45 + r() * 0.2)
      branch(p.clone(), cd, L, info.r * 0.72, depth + 1, info.sway)
    }
  }

  const stems = 2 + Math.floor(r() * 2)
  const az0 = r() * Math.PI * 2
  const trunks: Limb[] = []
  for (let s = 0; s < stems; s++) {
    const az = az0 + (s / stems) * Math.PI * 2 + (r() - 0.5) * 0.6
    const tilt = 0.18 + r() * 0.2
    const d = new THREE.Vector3(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt))
    const trunk = grow({
      start: new THREE.Vector3(Math.cos(az) * 0.04, -0.15, Math.sin(az) * 0.04),
      dir: d,
      length: H * (0.72 + r() * 0.15),
      r0: 0.085 * (H / 5) * (s === 0 ? 1 : 0.8),
      r1: 0.02,
      depth: 0,
      sway0: 0,
      segLen,
      bend: (dd, s) => {
        // a slow sinuous line: lean out low, recover towards the light higher up
        dd.x += (r() - 0.5) * 0.42 + Math.cos(az) * 0.09 * (0.5 - s)
        dd.z += (r() - 0.5) * 0.42 + Math.sin(az) * 0.09 * (0.5 - s)
      },
    })
    limbs.push(trunk)
    trunks.push(trunk)
    // tiers: long near-level limbs, wider low down
    const tiers = 4 + Math.floor(r() * 2)
    const p = new THREE.Vector3()
    for (let k = 0; k < tiers; k++) {
      const t = 0.4 + (k / tiers) * 0.58
      const info = limbPoint(trunk, t, p)
      if (p.y < 1.95) continue
      const per = k === 0 ? 2 : 3
      for (let j = 0; j < per; j++) {
        const baz = az + (j * Math.PI * 2) / per + (r() - 0.5) * 1.4 + k * 1.3
        const cd = new THREE.Vector3(Math.cos(baz), 0.4 + r() * 0.3, Math.sin(baz)).normalize()
        const reach = W * (1.0 - (k / tiers) * 0.65) * (0.6 + r() * 0.3)
        branch(p.clone(), cd, reach, info.r * 0.78, 1, info.sway)
      }
    }
  }

  const tubes = new TubeBuilder()
  for (const l of limbs) {
    if (opts.tier === 'phone' && l.depth >= maxDepth) continue
    tubes.add(l, {
      radial: radialFor(opts.tier, l.radii[0]!),
      texWorld: 0.4,
      gnarl: l.depth === 0 ? 0.06 : 0.02,
      flare: l.depth === 0 && trunks.includes(l) ? 0.35 : 0,
      seed: r() * 50,
    })
  }
  const swayNorm = H * 0.4 + W * 1.4
  const barkGeometry = tubes.build()

  const tips = collectTips(limbs, 2, 0.15, 0.1)
  const count = opts.tier === 'ultra' ? 2300 : opts.tier === 'high' ? 1700 : 850
  const sz: [number, number] = opts.tier === 'phone' ? [0.55, 0.85] : [0.42, 0.7]
  const reject = (p: THREE.Vector3) => overWalk(opts.x + p.x) && p.y < WALK_CLEAR
  const cards = buildCards({
    tips, count, size: sz, crown, rand: r, volume: 0.5, plate: 1, depthShade: 0.72,
    clusterRadius: 0.42, perCluster: opts.tier === 'phone' ? 9 : 13, flat: 0.45, reject,
  })
  return { bark: barkGeometry, cards, swayNorm }
}

// --- the cedar grove ------------------------------------------------------------------

function strawRope(cx: number, cy: number, cz: number, ringR: number, seed: number): THREE.BufferGeometry {
  const r = rng(seed)
  const pos: number[] = []
  const nor: number[] = []
  const col: number[] = []
  const idx: number[] = []
  // vertex colours are linear: an aged straw gold
  const straw = [0.2, 0.14, 0.06]
  // two thick strands twisted round each other, laid round the trunk with a slight sag
  const segs = 160
  const radial = 8
  const strandR = 0.065
  for (let strand = 0; strand < 2; strand++) {
    const base = pos.length / 3
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * Math.PI * 2
      const ph = th * 18 + strand * Math.PI
      const sag = -0.05 * (1 - Math.cos(th - 0.6)) * 0.5
      const rx = Math.cos(th)
      const rz = Math.sin(th)
      const ccx = cx + rx * (ringR + Math.cos(ph) * 0.055)
      const ccy = cy + sag + Math.sin(ph) * 0.055
      const ccz = cz + rz * (ringR + Math.cos(ph) * 0.055)
      for (let j = 0; j <= radial; j++) {
        const a = (j / radial) * Math.PI * 2
        const nx = rx * Math.cos(a)
        const ny = Math.sin(a)
        const nz = rz * Math.cos(a)
        pos.push(ccx + nx * strandR, ccy + ny * strandR, ccz + nz * strandR)
        nor.push(nx, ny, nz)
        // the twist of the straw shows as faint light and dark bands
        const band = 0.85 + 0.15 * Math.sin(a * 2 + ph * 3)
        col.push(straw[0]! * band, straw[1]! * band, straw[2]! * band)
      }
    }
    for (let i = 0; i < segs; i++) {
      for (let j = 0; j < radial; j++) {
        const a = base + i * (radial + 1) + j
        const b = a + radial + 1
        idx.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
  }
  // shide: four zigzag paper streamers hanging from the rope's front half
  for (let k = 0; k < 4; k++) {
    const th = 0.9 + k * 0.45 + (r() - 0.5) * 0.1
    const rx = Math.cos(th)
    const rz = Math.sin(th)
    const tx = -rz
    const tz = rx
    const px = cx + rx * (ringR + 0.12)
    const pz = cz + rz * (ringR + 0.12)
    let py = cy - 0.06
    const w = 0.06
    for (let s = 0; s < 4; s++) {
      const off = (s % 2) * w * 0.55
      const h = 0.085
      const base = pos.length / 3
      const x0 = px + tx * (off - w / 2)
      const z0 = pz + tz * (off - w / 2)
      const x1 = px + tx * (off + w / 2)
      const z1 = pz + tz * (off + w / 2)
      // each fold is slanted, as the cut paper hangs in a lightning shape
      const lean = (s % 2 === 0 ? 1 : -1) * w * 0.25
      pos.push(x0, py, z0, x1, py, z1, x1 + tx * lean, py - h, z1 + tz * lean, x0 + tx * lean, py - h, z0 + tz * lean)
      for (let q = 0; q < 4; q++) {
        nor.push(rx, 0, rz)
        col.push(0.82, 0.8, 0.74)
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      py -= h * 0.92
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeBoundingSphere()
  return g
}

// Japanese cedars behind the hall: straight columns, bare below, with narrow
// irregular crowns of dense sprays in the upper half. All trees share one bark
// mesh and one foliage mesh, built in world space.
const SWAY_NORM = 10

export class CedarGrove extends Tree {
  private tier: Tier

  constructor(opts: { tier: Tier }, shape: GroveShape = groveShape(opts.tier)) {
    super()
    this.tier = opts.tier
    const tier = opts.tier
    const atlas = acquireAtlas('cedar', tier)
    const bark = barkMaterial(tier, 'cedar_bark', 0x4a3026, 0x9a8a82, 0.3, SWAY_NORM, 0.8)
    // the long fibrous strips should catch the low light
    bark.normalScale.set(1.8, 1.8)
    this.addMesh(shape.bark, bark, true)
    const mat = foliageMaterial({
      key: 'cedar',
      map: atlas.map,
      normalMap: atlas.normalMap,
      trans: 0.9,
      transTint: new THREE.Color(0.6, 0.95, 0.7),
      roughness: 0.95,
      branchAmp: 0.3,
      cardAmp: 0.05,
      swayNorm: SWAY_NORM,
      volumeNormals: true,
      instanced: false,
      farStart: 30,
      softEdge: true,
    })
    // sugi foliage is dark and a little blue beside the maples' warm reds
    mat.color.setRGB(0.4, 0.5, 0.66)
    this.addFoliage(shape.cards, mat)
    if (shape.rope) {
      const ropeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })
      this.addMesh(shape.rope, ropeMat, true)
    }
    this.object.updateMatrixWorld(true)
  }

  override dispose(): void {
    super.dispose()
    releaseAtlas('cedar', this.tier)
  }
}

export function groveShape(tier: Tier): GroveShape {
  const r = rng(5501)
  const tubes = new TubeBuilder()
  const parts: THREE.BufferGeometry[] = []
  const branchesPer = tier === 'ultra' ? 84 : tier === 'high' ? 62 : 34
  const cardsPer = tier === 'ultra' ? 3600 : tier === 'high' ? 2500 : 800
  let rope: THREE.BufferGeometry | null = null
  for (const c of CEDARS) {
    const H = c.height
    const gy = groundHeight(c.x, c.z)
    const base = new THREE.Vector3(c.x, gy, c.z)
    // the pair that flanks the hall is old and broad; the grove behind is younger
    const old = !c.back
    const r0 = c.girth ?? (0.4 + (H - 18) * 0.03) * (c.sacred ? 1.25 : 1)
    const limbs: Limb[] = []
    // old trees lean a touch away from the hall, so the pair opens like a gate
    const out = Math.sign(c.x) * (old ? 0.025 : 0)
    const lean = new THREE.Vector3(out + (r() - 0.5) * 0.03, 1, (r() - 0.5) * 0.03).normalize()
    const trunk = grow({
      start: new THREE.Vector3(0, -0.3, 0),
      dir: lean,
      length: H + 0.3,
      r0,
      r1: 0.04,
      depth: 0,
      sway0: 0,
      segLen: tier === 'phone' ? 1.6 : 0.9,
      bend: (d) => {
        d.x += (r() - 0.5) * 0.012
        d.z += (r() - 0.5) * 0.012
      },
    })
    // a straight column: the taper is close to linear, not a sapling's
    for (let i = 0; i < trunk.radii.length; i++) {
      const s = i / (trunk.radii.length - 1)
      trunk.radii[i] = 0.04 + (r0 - 0.04) * Math.pow(1 - s, 1.1)
    }
    limbs.push(trunk)
    // The old pair branch from about the eaves upwards, so their lowest limbs
    // frame the roof; the trees behind keep their crowns lower down too, so no
    // bare poles stand in a row.
    const crownBase = H * (old ? 0.22 + r() * 0.03 : 0.3 + r() * 0.08)
    // narrow: a sugi crown is a spire, a fifth as wide as the tree is tall
    const crownR = H * (old ? 0.12 + r() * 0.02 : 0.085 + r() * 0.025)
    const inward = -Math.sign(c.x)
    const golden = 2.39996
    const az0 = r() * 6.28
    const n = Math.round(branchesPer * (H / 22))
    const p = new THREE.Vector3()
    for (let k = 0; k < n; k++) {
      const u = (k + r() * 0.8) / n
      const h = crownBase + (H * 0.98 - crownBase) * u
      limbPoint(trunk, (h + 0.3) / (H + 0.3), p)
      const az = az0 + k * golden + (r() - 0.5) * 0.5
      // lower branches droop, upper ones climb; a few are short, which breaks the outline
      const elev = -0.25 + u * 0.75 + (r() - 0.5) * 0.2
      const d = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev))
      // a third are short or overlong, which breaks the outline into tufts
      const q = r()
      const short = q < 0.25 ? 0.45 : q > 0.88 ? 1.35 : 1
      // the old pair reach further over the hall than away from it
      const toHall = old ? 1 + 0.35 * Math.max(0, d.x * inward) : 1
      const L = Math.max(0.35, crownR * Math.pow(1 - u, 1.05) * (0.7 + r() * 0.55) * short * toHall)
      const rr = Math.max(0.025, 0.03 + 0.07 * (1 - u)) * (r0 / 0.55)
      limbs.push(
        grow({
          start: p.clone(),
          dir: d,
          length: L,
          r0: Math.min(rr, r0 * 0.3),
          r1: 0.012,
          depth: 1,
          sway0: h,
          segLen: tier === 'phone' ? 0.8 : 0.45,
          bend: (dd, s) => {
            dd.y += (s > 0.5 ? 0.05 : -0.03) + (r() - 0.5) * 0.06
            dd.x += (r() - 0.5) * 0.1
            dd.z += (r() - 0.5) * 0.1
          },
        }),
      )
    }
    // sway only in the crown: the flex measure starts where the branches start
    for (const l of limbs) {
      for (let i = 0; i < l.sway.length; i++) {
        l.sway[i] = Math.max(0, Math.min(1, (l.sway[i]! - crownBase) / (H - crownBase))) * SWAY_NORM
      }
    }
    const tips = collectTips(limbs.filter((l) => l.depth === 1), 1, 0.2, 0.35)
    tips.push(...collectTips([trunk], 0, crownBase / H + (1 - crownBase / H) * 0.55, 0.5))
    // to world space
    for (const l of limbs) for (const q of l.pts) q.add(base)
    for (const t of tips) t.p.add(base)
    for (const l of limbs) {
      tubes.add(l, {
        radial: l.depth === 0 ? (tier === 'phone' ? 12 : 20) : tier === 'phone' ? 3 : 5,
        texWorld: 0.85,
        vAspect: 2,
        gnarl: l.depth === 0 ? 0.03 : 0,
        flare: l.depth === 0 ? (old ? 0.5 : 0.28) : 0,
        seed: r() * 50,
      })
    }
    const crown: CrownShape = {
      centre: new THREE.Vector3(c.x, gy + (crownBase + H) / 2, c.z),
      radii: new THREE.Vector3(crownR, (H - crownBase) / 2, crownR),
      lowY: (H - crownBase) / 2,
    }
    // many small sprays rather than a few big cards: up close a crown is
    // built of layered, overlapping tufts, never of flat sheets
    const sz: [number, number] = tier === 'phone' ? [0.8, 1.4] : [0.42, 0.85]
    const cards = buildCards({
      tips, count: Math.round(cardsPer * (H / 22) * (old ? 1.45 : 0.7)), size: sz, crown, rand: r, volume: 0.72, plate: 0, depthShade: 0.85,
      clusterRadius: 0.75, perCluster: tier === 'phone' ? 8 : 9, flat: 0.55, reject: () => false, ballShade: 0.45,
    })
    if (!old) {
      // the grove behind stands in more air: lighter and bluer, so it falls back
      const col = cards.getAttribute('color') as THREE.BufferAttribute
      for (let i = 0; i < col.count; i++) col.setXYZ(i, col.getX(i) * 1.08, col.getY(i) * 1.14, col.getZ(i) * 1.32)
    }
    parts.push(cards)
    if (c.sacred) {
      // the rope sits at about 2 m, where the trunk is a little thinner than at the flare
      const at = trunk.radii[Math.min(trunk.radii.length - 1, Math.round((2.3 / (H + 0.3)) * (trunk.radii.length - 1)))]!
      rope = strawRope(c.x, gy + 2.0, c.z, at + 0.04, 77)
    }
  }
  const bark = tubes.build()
  const cards = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  return { bark, cards, rope }
}

// --- falling petals -----------------------------------------------------------------

function jsHash(x: number, y: number): number {
  let px = (x * 123.34) % 1
  let py = (y * 456.21) % 1
  if (px < 0) px += 1
  if (py < 0) py += 1
  const d = px * (px + 45.32) + py * (py + 45.32)
  px += d
  py += d
  const v = px * py
  return v - Math.floor(v)
}

function jsNoise(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = jsHash(ix, iy)
  const b = jsHash(ix + 1, iy)
  const c = jsHash(ix, iy + 1)
  const d = jsHash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

// the same travelling gust field the shaders use
function gustAt(x: number, z: number, t: number, wx: number, wz: number): number {
  const l = Math.hypot(wx, wz) + 1e-4
  const px = x * 0.045 - (wx / l) * t * 0.35
  const pz = z * 0.045 - (wz / l) * t * 0.35
  const v = jsNoise(px, pz) * 0.7 + jsNoise(px * 2.7 + 7.1, pz * 2.7 + 7.1) * 0.3
  const s = Math.max(0, Math.min(1, (v - 0.25) / 0.6))
  return s * s * (3 - 2 * s)
}

function petalTexture(): THREE.DataTexture {
  const size = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d', { willReadFrequently: true })!
  ctx.translate(size / 2, size * 0.98)
  petalPath(ctx, size * 0.95)
  const g = ctx.createLinearGradient(0, 0, 0, -size * 0.95)
  g.addColorStop(0, rgbStr(0.93, 0.68, 0.75))
  g.addColorStop(0.35, rgbStr(0.98, 0.86, 0.89))
  g.addColorStop(1, rgbStr(1, 0.96, 0.96))
  ctx.fillStyle = g
  ctx.fill()
  // faint veins fanning from the base
  ctx.strokeStyle = rgbStr(0.9, 0.74, 0.79, 0.35)
  ctx.lineWidth = 1.2
  for (let k = -4; k <= 4; k++) {
    ctx.beginPath()
    ctx.moveTo(0, -size * 0.04)
    ctx.quadraticCurveTo(k * size * 0.05, -size * 0.45, k * size * 0.07, -size * 0.85)
    ctx.stroke()
  }
  const d = ctx.getImageData(0, 0, size, size).data
  const out = new Uint8Array(d.length)
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3]!
    out[i] = a < 8 ? 250 : d[i]!
    out[i + 1] = a < 8 ? 228 : d[i + 1]!
    out[i + 2] = a < 8 ? 232 : d[i + 2]!
    out[i + 3] = a
  }
  const t = new THREE.DataTexture(out, size, size, THREE.RGBAFormat)
  t.colorSpace = THREE.SRGBColorSpace
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.flipY = false
  t.needsUpdate = true
  return t
}

// a curled sheet: cupped across, bent back along its length
function petalGeometry(): THREE.BufferGeometry {
  const L = 0.016
  const W = 0.0135
  const cols = 5
  const rows = 7
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let j = 0; j <= rows; j++) {
    const v = j / rows
    for (let i = 0; i <= cols; i++) {
      const u = i / cols
      const x = (u - 0.5) * W
      const nx = (u - 0.5) * 2
      const cup = 0.0028 * nx * nx * (0.3 + 0.7 * v)
      const bend = -0.003 * v * v
      pos.push(x, (v - 0.5) * L, cup + bend)
      // the texture is drawn with the base at the bottom row
      uv.push(u, 1 - (0.02 + v * 0.93))
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i
      const b = a + cols + 1
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const AIR = 0
const GROUND = 1
const WATER = 2

export class Petals implements RealmPart {
  readonly object: THREE.InstancedMesh
  private n: number
  private pos: Float32Array
  private vel: Float32Array
  private quat: Float32Array
  private spin: Float32Array
  private phase: Float32Array
  private age: Float32Array
  private rest: Float32Array
  private state: Uint8Array
  private size: Float32Array
  private yaw: Float32Array
  private rand = rng(77123)
  private geometry: THREE.BufferGeometry
  private material: THREE.MeshStandardMaterial
  private texture: THREE.DataTexture
  // the ground and the pond sampled once on a grid
  private gx0 = -19
  private gz0 = -26
  private gStep = 0.5
  private gw: number
  private gh: number
  private heights: Float32Array
  private water: Uint8Array
  private crownCentre: THREE.Vector3
  private crownRadii: THREE.Vector3
  private offIsland: Uint8Array
  private frameNo = 0
  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private dq = new THREE.Quaternion()
  private qFlat = new THREE.Quaternion()
  private p = new THREE.Vector3()
  private s = new THREE.Vector3()
  private axis = new THREE.Vector3()
  private camLocal = new THREE.Vector3()
  private euler = new THREE.Euler()
  private started = false

  constructor(opts: { tier: Tier }) {
    this.n = opts.tier === 'ultra' ? 340 : opts.tier === 'high' ? 240 : 110
    const n = this.n
    this.pos = new Float32Array(n * 3)
    this.vel = new Float32Array(n * 3)
    this.quat = new Float32Array(n * 4)
    this.spin = new Float32Array(n * 3)
    this.phase = new Float32Array(n)
    this.age = new Float32Array(n)
    this.rest = new Float32Array(n)
    this.state = new Uint8Array(n)
    this.size = new Float32Array(n)
    this.yaw = new Float32Array(n)
    this.offIsland = new Uint8Array(n)
    this.gw = Math.ceil(38 / this.gStep) + 1
    this.gh = Math.ceil(52 / this.gStep) + 1
    this.heights = new Float32Array(this.gw * this.gh)
    this.water = new Uint8Array(this.gw * this.gh)
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const x = this.gx0 + i * this.gStep
        const z = this.gz0 + j * this.gStep
        this.heights[j * this.gw + i] = groundHeight(x, z)
        this.water[j * this.gw + i] = pondSdf(x, z) < 0 ? 1 : 0
      }
    }
    const gy = groundHeight(CHERRY.x, CHERRY.z)
    this.crownCentre = new THREE.Vector3(CHERRY.x + CHERRY.lean.x * CHERRY.height * 0.08, gy + CHERRY.height * 0.5, CHERRY.z + CHERRY.lean.z * CHERRY.height * 0.08)
    this.crownRadii = new THREE.Vector3(CHERRY.spread * 1.1, CHERRY.height * 0.3, CHERRY.spread * 1.05)

    this.texture = petalTexture()
    this.geometry = petalGeometry()
    const tone = dressFor<BlossomDress>('Blossom')?.petals
    this.material = foliageMaterial({
      key: 'petal',
      map: this.texture,
      normalMap: null,
      trans: tone?.trans ?? 1.15,
      transTint: tone?.transTint ?? new THREE.Color(1.0, 0.85, 0.88),
      roughness: 0.5,
      branchAmp: 0,
      cardAmp: 0,
      swayNorm: 1,
      volumeNormals: false,
      instanced: true,
      farStart: 1000,
      softEdge: false,
    })
    if (tone) this.material.color.copy(tone.color)
    this.object = new THREE.InstancedMesh(this.geometry, this.material, n)
    this.object.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.object.frustumCulled = false
    this.object.castShadow = false
    this.object.receiveShadow = true
    this.m.makeScale(0, 0, 0)
    for (let i = 0; i < n; i++) this.object.setMatrixAt(i, this.m)
  }

  private ground(x: number, z: number): { h: number; water: boolean } {
    const fx = Math.max(0, Math.min(this.gw - 1.001, (x - this.gx0) / this.gStep))
    const fz = Math.max(0, Math.min(this.gh - 1.001, (z - this.gz0) / this.gStep))
    const i = Math.floor(fx)
    const j = Math.floor(fz)
    const u = fx - i
    const v = fz - j
    const k = j * this.gw + i
    const H = this.heights
    const h = (H[k]! * (1 - u) + H[k + 1]! * u) * (1 - v) + (H[k + this.gw]! * (1 - u) + H[k + this.gw + 1]! * u) * v
    if (this.water[k]! && this.water[k + 1]! && this.water[k + this.gw]!) return { h: Math.max(h, POND_LEVEL), water: true }
    return { h, water: false }
  }

  // petals drift from the cherry; near the maples a few that blew across
  private nearAnyTree(x: number, z: number): boolean {
    const cx = x - this.crownCentre.x
    const cz = z - this.crownCentre.z
    if (cx * cx + cz * cz < (this.crownRadii.x + 3.5) ** 2) return true
    for (const m of MAPLES) {
      const mx = x - m.x
      const mz = z - m.z
      if (mx * mx + mz * mz < (m.spread + 0.5) ** 2) return true
    }
    return false
  }

  private spawn(i: number, cam: THREE.PerspectiveCamera, anywhere: boolean): void {
    const r = this.rand
    const p = this.p
    const dx = cam.position.x - this.crownCentre.x
    const dz = cam.position.z - this.crownCentre.z
    const nearTree = dx * dx + dz * dz < 30 * 30
    // in the view ahead, but only where a tree is close: never loose in open sky
    let placed = false
    if (!nearTree || r() > 0.6) {
      for (let tries = 0; tries < 6 && !placed; tries++) {
        const depth = 1.0 + Math.pow(r(), 0.8) * 8
        const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5)) * depth
        const halfW = halfH * cam.aspect
        const top = anywhere ? halfH : halfH * 1.6
        p.set((r() * 2 - 1) * halfW * 1.15, -halfH + r() * (halfH + top), -depth)
        if (!anywhere && r() < 0.5) p.y = halfH * (1 + r() * 0.6)
        p.applyMatrix4(cam.matrixWorld)
        const g = this.ground(p.x, p.z).h
        if (p.y < g + 0.15) p.y = g + 0.15 + r() * 2
        placed = p.y < g + 4.5 && this.nearAnyTree(p.x, p.z)
      }
    }
    if (!placed) {
      // detach from the crown, mostly from its lower and outer shell
      randUnit(r, this.axis)
      if (this.axis.y > 0.3) this.axis.y *= 0.4
      this.axis.normalize().multiplyScalar(0.7 + r() * 0.3)
      p.set(this.axis.x * this.crownRadii.x, this.axis.y * this.crownRadii.y, this.axis.z * this.crownRadii.z).add(this.crownCentre)
    }
    const o = i * 3
    this.pos[o] = p.x
    this.pos[o + 1] = p.y
    this.pos[o + 2] = p.z
    this.vel[o] = 0
    this.vel[o + 1] = -0.4
    this.vel[o + 2] = 0
    this.euler.set(r() * 6.3, r() * 6.3, r() * 6.3)
    this.q.setFromEuler(this.euler)
    this.q.toArray(this.quat, i * 4)
    // a clear tumble: flips and spins of a few turns a second
    const sp = 4 + r() * 6
    randUnit(r, this.axis).multiplyScalar(sp)
    this.spin[o] = this.axis.x
    this.spin[o + 1] = this.axis.y
    this.spin[o + 2] = this.axis.z
    this.phase[i] = r() * 100
    this.age[i] = 0
    this.rest[i] = 0
    this.state[i] = AIR
    this.offIsland[i] = 0
    // 2 to 3 cm, the size of a real petal
    this.size[i] = 1.35 + r() * 0.55
    this.yaw[i] = r() * 6.3
  }

  update(frame: Frame): void {
    const cam = frame.camera
    const n = this.n
    if (!this.started) {
      this.started = true
      cam.updateMatrixWorld()
      for (let i = 0; i < n; i++) {
        this.spawn(i, cam, true)
        // start mid-life, already visible
        this.age[i] = 2
      }
    }
    const dt = Math.min(0.05, frame.dt) * frame.motion
    this.frameNo++
    const t = frame.t
    const wind = realmUniforms.uWind.value
    const wx = wind.x
    const wz = wind.y
    const ws = Math.hypot(wx, wz)
    const gustG = realmUniforms.uGust.value
    const sideX = -wz / (ws + 1e-4)
    const sideZ = wx / (ws + 1e-4)
    const inv = cam.matrixWorldInverse
    const ray = frame.pointer
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5))
    const pos = this.pos
    const vel = this.vel
    for (let i = 0; i < n; i++) {
      const o = i * 3
      let x = pos[o]!
      let y = pos[o + 1]!
      let z = pos[o + 2]!
      let vx = vel[o]!
      let vy = vel[o + 1]!
      let vz = vel[o + 2]!
      this.age[i] += dt
      const st = this.state[i]!
      // push away from the pointer ray, smoothly falling off to nothing at 1.2 m
      let px = 0
      let py = 0
      let pz = 0
      if (ray) {
        const ox = x - ray.origin.x
        const oy = y - ray.origin.y
        const oz = z - ray.origin.z
        const along = ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z
        if (along > 0) {
          const cx = ox - ray.direction.x * along
          const cy = oy - ray.direction.y * along
          const cz = oz - ray.direction.z * along
          const d = Math.hypot(cx, cy, cz)
          if (d < 1.2 && d > 1e-4) {
            const f = 1 - d / 1.2
            const a = f * f * 9 / d
            px = cx * a
            py = cy * a
            pz = cz * a
          }
        }
      }
      if (st === AIR) {
        const g = gustAt(x, z, t, wx, wz) * (0.55 + 0.45 * gustG)
        const flow = 0.35 + ws * (0.8 + g * 1.8)
        const swirl = Math.sin(t * 0.7 + x * 0.6 + this.phase[i]!) * 0.35 + Math.sin(t * 1.3 - z * 0.5) * 0.2
        const flutter = Math.sin(t * 2.6 + this.phase[i]!) * 0.9
        const ax = (wx / (ws + 1e-4)) * flow + sideX * (swirl + flutter * 0.4)
        const az = (wz / (ws + 1e-4)) * flow + sideZ * (swirl + flutter * 0.4)
        const fall = -0.55 - 0.25 * Math.sin(t * 1.9 + this.phase[i]! * 1.3) + g * 0.25
        const k = 1 - Math.exp(-dt * 2.2)
        vx += (ax - vx) * k + px * dt
        vy += (fall - vy) * k + py * dt
        vz += (az - vz) * k + pz * dt
        x += vx * dt
        y += vy * dt
        z += vz * dt
        // tumble, faster in stronger flow
        const sm = (0.8 + g) * dt
        this.axis.set(this.spin[o]!, this.spin[o + 1]!, this.spin[o + 2]!)
        const w = this.axis.length()
        if (w > 1e-4) {
          this.axis.multiplyScalar(1 / w)
          this.dq.setFromAxisAngle(this.axis, w * sm)
          this.q.fromArray(this.quat, i * 4).multiply(this.dq).normalize()
          this.q.toArray(this.quat, i * 4)
        }
        const gr = this.ground(x, z)
        if (y <= gr.h + 0.004) {
          y = gr.h + 0.004
          this.state[i] = gr.water ? WATER : GROUND
          this.rest[i] = 0
          vx *= 0.1
          vy = 0
          vz *= 0.1
        }
      } else {
        this.rest[i] += dt
        const k = 1 - Math.exp(-dt * 8)
        if (st === WATER) {
          vx += (wx * 0.08 - vx) * k
          vz += (wz * 0.08 - vz) * k
        } else {
          vx -= vx * k
          vz -= vz * k
        }
        vx += px * dt * 0.3
        vz += pz * dt * 0.3
        x += vx * dt
        z += vz * dt
        const gr = this.ground(x, z)
        y = gr.h + 0.004
        // lie down flat on whichever face it landed
        this.euler.set(-Math.PI / 2, 0, this.yaw[i]!)
        this.qFlat.setFromEuler(this.euler)
        this.q.fromArray(this.quat, i * 4).slerp(this.qFlat, 1 - Math.exp(-dt * 10))
        this.q.toArray(this.quat, i * 4)
        // a strong push lifts it again
        if (py > 2.5 && st === GROUND) {
          this.state[i] = AIR
          vy = 0.6
        }
      }
      pos[o] = x
      pos[o + 1] = y
      pos[o + 2] = z
      vel[o] = vx
      vel[o + 1] = vy
      vel[o + 2] = vz

      // respawn what has faded, what is out of view and what is too far away
      const restLimit = this.state[i] === WATER ? 9 : 3.5
      // one blown past the rim fades out rather than drifting on as a speck over the clouds
      if (this.state[i] === AIR && (i + this.frameNo) % 8 === 0 && islandSdf(x, z) < 0) this.offIsland[i] = 1
      if (this.offIsland[i]) this.rest[i] = Math.max(this.rest[i]!, restLimit) + dt
      this.camLocal.set(x, y, z).applyMatrix4(inv)
      const depth = -this.camLocal.z
      const outside =
        depth < -0.5 ||
        depth > 22 ||
        Math.abs(this.camLocal.x) > tanH * cam.aspect * Math.max(depth, 0.5) * 1.6 + 1.5 ||
        Math.abs(this.camLocal.y) > tanH * Math.max(depth, 0.5) * 2.2 + 3 ||
        y < -3
      if (this.rest[i]! > restLimit + 1.2 || this.age[i]! > 40 || (outside && this.age[i]! > 0.5)) {
        this.spawn(i, cam, false)
      }

      // fade in after a spawn and out after resting
      const fin = Math.min(1, this.age[i]! / 0.8)
      const fout = 1 - Math.max(0, Math.min(1, (this.rest[i]! - restLimit) / 1.2))
      // a petal brushing the lens would fill the screen as a blur; it shrinks away first
      const camDist = this.camLocal.length()
      const near = Math.max(0, Math.min(1, (camDist - 0.3) / 0.4))
      const sc = this.size[i]! * fin * fin * fout * near * near * (3 - 2 * near)
      this.p.set(pos[o]!, pos[o + 1]!, pos[o + 2]!)
      this.q.fromArray(this.quat, i * 4)
      this.s.set(sc, sc, sc)
      this.m.compose(this.p, this.q, this.s)
      this.object.setMatrixAt(i, this.m)
    }
    this.object.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}
