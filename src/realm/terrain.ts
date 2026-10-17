import * as THREE from 'three'
import {
  ISLAND_RX,
  ISLAND_RZ,
  rimScale,
  groundHeight,
  gravelWeight,
  pondSdf,
  fbm2,
  lawnWeight,
  pathWeight,
  TERRACE_FRONT_Z,
  CHERRY,
  MAPLES,
  PATH_HALF_WIDTH,
  GRAVEL_HALF_WIDTH,
  LANTERNS,
  SHRINE,
  OUTFLOW,
  rng,
} from './layout'
import { loadPbr, type PbrSet } from './assets'
import { LAWN_FLOOR_TINT } from './grass'
import { realmUniforms } from './atmosphere'
import type { RealmPart, Tier } from './types'

// The island itself: a ground surface that follows layout.groundHeight out to
// the rim, a rounded lip, and the rock it stands on, tapering down into the
// clouds. The ground blends four scanned materials (soil, gravel, moss and the
// pond's pebbles) per pixel, weighted by the layout and sharpened by height so
// the borders read as material meeting material, not as a cross-fade.

const RIM_DROP = 0.4 // how far the lip rounds down before the cliff starts
const UNDERSIDE_DEPTH = 34

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// moss gathers where the ground stays damp and shaded: around the pond, at
// the foot of the terrace wall, near the rim and in patches between
function mossWeight(x: number, z: number): number {
  const pond = 1 - smooth(0.2, 2.6, pondSdf(x, z))
  const wall = (1 - smooth(0, 1.4, Math.abs(z - (TERRACE_FRONT_Z + 0.6)))) * (z > TERRACE_FRONT_Z ? 1 : 0)
  const patches = smooth(0.52, 0.72, fbm2(x * 0.18 + 3.3, z * 0.18 - 7.1, 4))
  // under the trees' crowns the ground stays shaded and damp: a moss carpet
  let shade = 0
  for (const t of [{ x: CHERRY.x, z: CHERRY.z, r: CHERRY.spread }, ...MAPLES.map((m) => ({ x: m.x, z: m.z, r: m.spread }))]) {
    const d = Math.hypot(x - t.x, z - t.z) / t.r
    shade = Math.max(shade, 1 - smooth(0.15, 0.85, d))
  }
  // in clumps where the roots keep the ground damp, never a full ring
  shade *= smooth(0.38, 0.62, fbm2(x * 0.9 + 1.7, z * 0.9 - 4.2, 3))
  return Math.max(pond * 0.85, wall * 0.9, patches * 0.6, shade * 0.5)
}

// Gravel: raked in lines along the approach that turn into rings around the
// lanterns, trodden flat with a few footprints near the paving, darker where
// it banks against the kerbs and the wall.
const glf = (n: number): string => n.toFixed(3)
const GRAVEL_GLSL = /* glsl */ `
const float G_SPACING = 0.065;
const float G_PATH = ${glf(PATH_HALF_WIDTH + 0.17)};
const float G_BED = ${glf(GRAVEL_HALF_WIDTH)};
const vec2 G_LANTERN[${LANTERNS.length}] = vec2[](${LANTERNS.map((l) => `vec2(${glf(l.x)}, ${glf(l.z)})`).join(', ')});
// a rake line: rounded crests, narrow troughs; returns height and d/du
vec2 gLine(float u) {
  float c = cos(6.2832 * u);
  float b = 0.5 + 0.5 * c;
  float sb = sqrt(b);
  return vec2(b * sb, -1.5 * sb * 3.1416 * sin(6.2832 * u));
}
// one footprint per cell along the path edge, on either side; returns depth 0..1
float gStep(vec2 p) {
  float side = sign(p.x);
  float cz = floor(p.y / 0.36);
  float hsh = tHash(vec2(cz, side * 7.0 + 3.0));
  if (hsh < 0.45) return 0.0;
  vec2 c = vec2(side * (G_PATH + 0.1 + tHash(vec2(cz, side + 11.0)) * 0.32), (cz + 0.3 + hsh * 0.4) * 0.36);
  vec2 q = p - c;
  float a = (tHash(vec2(cz, side - 5.0)) - 0.5) * 0.5;
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
  float e = length(q / vec2(0.055, 0.135));
  return 1.0 - smoothstep(0.55, 1.0, e);
}
void gravelDetail(vec2 xz, inout vec3 d, inout vec3 n, inout vec3 a) {
  float ax = abs(xz.x);
  bool terrace = xz.y < ${glf(TERRACE_FRONT_Z)};
  // lines along the approach, wandering a little like a rake drawn by hand
  float wob = (tNoise(vec2(xz.y * 0.35, 1.7)) - 0.5) * 0.2 + (tNoise(xz * vec2(0.6, 2.4)) - 0.5) * 0.02 + (tNoise(xz * vec2(3.0, 9.0)) - 0.5) * 0.006;
  vec2 ln = gLine((xz.x + wob) / G_SPACING);
  vec2 grad = vec2(ln.y / G_SPACING, 0.0);
  float hgt = ln.x;
  // around each lantern the lines turn into rings
  for (int i = 0; i < ${LANTERNS.length}; i++) {
    vec2 q = xz - G_LANTERN[i];
    float r = length(q);
    float k = 1.0 - smoothstep(0.8, 1.05, r);
    if (k > 0.0) {
      vec2 rl = gLine(r / G_SPACING);
      hgt = mix(hgt, rl.x, k);
      grad = mix(grad, rl.y / G_SPACING * q / max(r, 1e-3), k);
    }
  }
  // trodden near the paving: the lines break down, footprints press in
  float edge = ax - G_PATH;
  float tramp = (1.0 - smoothstep(0.05, 0.55, edge)) * (0.55 + 0.45 * tNoise(xz * 2.7));
  float fp = gStep(xz);
  vec2 fg = vec2(gStep(xz + vec2(0.01, 0.0)) - fp, gStep(xz + vec2(0.0, 0.01)) - fp) / 0.01;
  // the lines are softened by weather and feet in patches
  float fade = mix(0.6, 1.0, smoothstep(0.3, 0.7, tNoise(xz * 0.9 + 5.0)));
  float amp = 0.008 * fade * (1.0 - tramp * 0.8) * (1.0 - fp);
  grad = grad * amp - fg * 0.008;
  n = normalize(n * vec3(1.0, 1.0, 1.0 + fp * 0.6) + vec3(-grad.x, grad.y, 0.0) * 1.1);
  float crest = mix(hgt, 0.6, clamp(tramp * 0.8 + fp + (1.0 - fade), 0.0, 1.0));
  d *= mix(0.86, 1.03, crest);
  a.r *= mix(0.8, 1.0, crest);
  d *= 1.0 - fp * 0.12;
  // where the gravel banks against a kerb or the wall it is damp and dark
  float kd = 10.0;
  if (!terrace) kd = min(abs(edge), abs(G_BED - ax));
  else if (xz.y > ${glf(SHRINE.z + SHRINE.depth / 2 + 0.6)}) kd = abs(edge);
  if (terrace) kd = min(kd, abs(xz.y + 9.42));
  float dark = 1.0 - smoothstep(0.0, 0.07 + 0.06 * tNoise(xz * 9.0), kd);
  d *= mix(1.0, 0.6, dark);
  a.r *= mix(1.0, 0.7, dark);
  // light grey pebbles, a few patches warmer or cooler, never one flat white
  float tone = tNoise(xz * 4.3 + 2.0);
  d *= mix(vec3(0.84, 0.85, 0.87), vec3(0.92, 0.89, 0.84), tone) * mix(0.92, 1.04, tNoise(xz * 11.0));
}
`

const SPLAT_VERT_PARS = /* glsl */ `
attribute vec4 splat;
varying vec4 vSplat;
varying vec3 vWorld;
varying vec3 vWorldNormal;
`

const SPLAT_FRAG_PARS = /* glsl */ `
uniform sampler2D tSoilD, tSoilN, tSoilA;
uniform sampler2D tGravelD, tGravelN, tGravelA;
uniform sampler2D tMossD, tMossN, tMossA;
uniform sampler2D tPebD, tPebN, tPebA;
uniform vec3 uLawnFloor;
varying vec4 vSplat;
varying vec3 vWorld;
varying vec3 vWorldNormal;
vec3 splatNormal;
vec3 splatArm;

float tHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
}
// two lookups at unrelated scales and angles hide the repeat of a 2 m scan
void sampleSet(sampler2D d, sampler2D n, sampler2D a, vec2 uv, out vec3 cd, out vec3 cn, out vec3 ca) {
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37 + 0.31;
  float m = smoothstep(0.35, 0.65, tNoise(uv * 0.21));
  cd = mix(texture2D(d, uv).rgb, texture2D(d, uv2).rgb, m);
  cn = mix(texture2D(n, uv).rgb, texture2D(n, uv2).rgb, m) * 2.0 - 1.0;
  ca = mix(texture2D(a, uv).rgb, texture2D(a, uv2).rgb, m);
}
${GRAVEL_GLSL}
`

const SPLAT_MAP = /* glsl */ `
{
  vec2 xz = vWorld.xz;
  vec3 d0, n0, a0, d1, n1, a1, d2, n2, a2, d3, n3, a3;
  sampleSet(tSoilD, tSoilN, tSoilA, xz / 2.6, d0, n0, a0);
  sampleSet(tGravelD, tGravelN, tGravelA, xz / 1.6, d1, n1, a1);
  gravelDetail(xz, d1, n1, a1);
  sampleSet(tMossD, tMossN, tMossA, xz / 2.2, d2, n2, a2);
  // the scan is a forest floor with moss among the leaves: keep its detail
  // as brightness and colour it the deep, quiet green of garden moss
  d2 = vec3(dot(d2, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.4, 0.55, 0.24) * 1.55;
  sampleSet(tPebD, tPebN, tPebA, xz / 1.4, d3, n3, a3);
  vec4 w = vSplat;
  float soil = max(1.0 - w.x - w.y - w.z, 0.0);
  // height-sharpened blend: crevices (dark ambient occlusion) lose first
  vec4 h = vec4(soil * (0.4 + a0.r), w.x * (0.4 + a1.r), w.y * (0.4 + a2.r), w.z * (0.4 + a3.r));
  float hm = max(max(h.x, h.y), max(h.z, h.w));
  h = max(h - hm + 0.18, 0.0);
  h /= max(h.x + h.y + h.z + h.w, 1e-4);
  vec3 dif = d0 * h.x + d1 * h.y + d2 * h.z + d3 * h.w;
  splatNormal = normalize(n0 * h.x + n1 * h.y + n2 * h.z + n3 * h.w + vec3(0.0, 0.0, 1e-3));
  splatArm = a0 * h.x + a1 * h.y + a2 * h.z + a3 * h.w;
  // a broad tonal variation so the lawn floor never reads as one tile
  float macro = tNoise(xz * 0.07) * 0.6 + tNoise(xz * 0.23) * 0.4;
  dif *= mix(0.82, 1.12, macro);
  // the floor under the lawn: green-brown, so gaps between blades never read as bare dirt
  dif *= mix(vec3(1.0), uLawnFloor, w.w);
  diffuseColor.rgb *= dif;
}
`

const SPLAT_NORMAL = /* glsl */ `
{
  vec3 N = normalize(vWorldNormal);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(T, N);
  vec3 wn = normalize(T * splatNormal.x - B * splatNormal.y + N * splatNormal.z);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
`

function patchSplat(mat: THREE.MeshStandardMaterial, sets: PbrSet[]): void {
  const names = ['Soil', 'Gravel', 'Moss', 'Peb']
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLawnFloor = { value: LAWN_FLOOR_TINT }
    sets.forEach((s, i) => {
      shader.uniforms[`t${names[i]}D`] = { value: s.map }
      shader.uniforms[`t${names[i]}N`] = { value: s.normalMap }
      shader.uniforms[`t${names[i]}A`] = { value: s.arm }
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SPLAT_VERT_PARS}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vSplat = splat;
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SPLAT_FRAG_PARS}`)
      .replace('#include <map_fragment>', SPLAT_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * splatArm.g;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', SPLAT_NORMAL)
      .replace(
        '#include <aomap_fragment>',
        `float ambientOcclusion = mix(1.0, splatArm.r, 0.9);
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.indirectSpecular *= ambientOcclusion;`,
      )
  }
  mat.customProgramCacheKey = () => 'realm-terrain-splat'
}

function buildTop(tier: Tier): THREE.BufferGeometry {
  const rings = tier === 'phone' ? 70 : 120
  const segs = tier === 'phone' ? 180 : 300
  const pos: number[] = []
  const uv: number[] = []
  const splat: number[] = []
  const index: number[] = []
  for (let i = 0; i <= rings; i++) {
    // denser towards the rim, where the lip curves
    const r = 1 - Math.pow(1 - i / rings, 1.35)
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2
      const k = rimScale(a)
      const x = Math.cos(a) * ISLAND_RX * k * r
      const z = Math.sin(a) * ISLAND_RZ * k * r
      let y = groundHeight(x, z)
      const lip = smooth(0.965, 1, r)
      y -= lip * lip * RIM_DROP
      pos.push(x, y, z)
      uv.push(x, z)
      const g = gravelWeight(x, z)
      const p = smooth(0.1, -0.3, pondSdf(x, z))
      // moss fills the joints between the paving slabs
      const m = Math.max(mossWeight(x, z), pathWeight(x, z)) * (1 - g) * (1 - p)
      // the lip itself is bare soil and roots, never gravel
      splat.push(g * (1 - lip), m, p, lawnWeight(x, z))
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j
      const b = a + segs + 1
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('splat', new THREE.Float32BufferAttribute(splat, 4))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// The rock under the island. Below the lip the edge breaks into blocks that
// hold out over an undercut, then the rock narrows in strata towards a ragged
// point far below: hard layers stand out as ledges that catch the low sun,
// the soft layers between them are recessed, darker and damp.

const TAU = Math.PI * 2
const FALL_ANGLE = Math.atan2(OUTFLOW.z1, OUTFLOW.x1)
const RIM_CELLS = 64 // blocks around the lip, about two metres each
const STRATA = 15 // bands from the lip to the point
const JOINTS = 90 // vertical joints around the island

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const uz = fz * fz * (3 - 2 * fz)
  const z0 = lerp(
    lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux),
    lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux),
    uy,
  )
  const z1 = lerp(
    lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux),
    lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux),
    uy,
  )
  return lerp(z0, z1, uz)
}

function fbm3(x: number, y: number, z: number, octaves: number): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * f, y * f, z * f) * amp
    norm += amp
    amp *= 0.5
    f *= 2.07
  }
  return sum / norm
}

function angleDist(a: number, b: number): number {
  const d = (((a - b) % TAU) + TAU) % TAU
  return Math.min(d, TAU - d)
}

// what undersidePoint found at the last point it returned: how recessed
// (soft and damp) the layer is there, and how hard the band is
export const undersideSample = { soft: 0, hard: 0 }

// A point on the top surface at bearing `a` and fraction `r` of the way to
// the rim, lip rounding included, as buildTop lays it out.
export function rimTopPoint(a: number, r: number, out: THREE.Vector3): THREE.Vector3 {
  const k = rimScale(a)
  const x = Math.cos(a) * ISLAND_RX * k * r
  const z = Math.sin(a) * ISLAND_RZ * k * r
  const lip = smooth(0.965, 1, r)
  return out.set(x, groundHeight(x, z) - lip * lip * RIM_DROP, z)
}

function undersideDepth(a: number): number {
  return UNDERSIDE_DEPTH * (0.8 + fbm2(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 2) * 0.45)
}

// A point on the rock under the island at bearing `a` (radians, as in
// layout.rimScale) and depth fraction `f` (0 at the lip, 1 at the bottom).
// Every noise reads the bearing through its cosine and sine, so the rock
// closes on itself without a seam.
export function undersidePoint(a: number, f: number, out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const k = rimScale(a)
  const rx = c * ISLAND_RX * k
  const rz = s * ISLAND_RZ * k
  const yRim = groundHeight(rx, rz) - RIM_DROP
  // the water has worn the rock smooth and back under the fall
  const fall = 1 - smooth(0.05, 0.2, angleDist(a, FALL_ANGLE))

  // an undercut just below the lip, then the long bowl-shaped taper
  const body = Math.pow(1 - smooth(0, 1, f), 1.15) * (1 - f * 0.08) * (1 - 0.075 * smooth(0, 0.09, f))

  // strata, tilted and warped so no band runs level all the way round
  const warp = (fbm3(c * 1.4 + 3.1, s * 1.4, f * 1.6, 3) - 0.5) * 1.8 + c * 0.4 - s * 0.25
  const d = Math.pow(f, 0.85) * STRATA + warp
  const band = Math.floor(d)
  const t = d - band
  const hn = noise3(c * 3.4 + band * 3.1, s * 3.4 - band * 1.3, band * 1.37) * 0.7 + noise3(c * 9 + band, s * 9, band * 2.1) * 0.3
  // vertical joints break each hard layer into blocks, offset band to band
  // like courses of masonry, each block standing out by its own amount
  // joints wander and lean a little, so blocks never read as cut masonry
  const ju = (a / TAU) * JOINTS + hash3(band, 8.1, 3.3) * JOINTS + (noise3(c * 6, s * 6, f * 24) - 0.5) * 0.7
  const jc = Math.floor(ju)
  const jl = ju - jc
  const jid = ((jc % JOINTS) + JOINTS) % JOINTS
  const jw = 0.1 + 0.12 * hash3(jid, band, 5.1)
  const joint = (1 - smooth(0, jw, Math.min(jl, 1 - jl))) * (hash3(jid, band, 2.7) < 0.45 ? 1 : 0)
  const hard =
    smooth(0.42, 0.72, 1 - Math.abs(hn * 2 - 1)) * (0.45 + 0.55 * hash3(band, 2.2, 7.7)) * (0.55 + 0.45 * hash3(jid, band, 9.9)) * (1 - joint * 0.6)
  // a hard layer: a sharp top that catches the light, a flat underside; each
  // band splits at its own height so the layers are not evenly spaced
  const split = 0.35 + hash3(band, 4.4, 1.9) * 0.45
  const slab = smooth(0, 0.06, t) * (1 - smooth(split, split + 0.16, t))
  const reach = smooth(0.006, 0.05, f) * (1 - 0.92 * smooth(0.45, 0.85, f)) * (1 - fall * 0.85)
  const strata = (slab * hard - 0.2) * 0.08 * reach

  const n = fbm3(c * 2.2 + 11, s * 2.2, f * 6, 4)
  const bulge = 1 + (n - 0.5) * 0.3 * smooth(0.02, 0.2, f)
  const grain = (fbm3(c * 11 + 5, s * 11, f * 34, 3) - 0.5) * 0.022 * smooth(0, 0.03, f) * (1 - 0.7 * smooth(0.5, 0.9, f))
  let sc = body * (bulge + strata + grain)

  // the lip breaks into blocks of different depth with cracks between them
  const cu = (a / TAU) * RIM_CELLS + (noise3(c * 3, s * 3, 5.5) - 0.5) * 1.4
  const ci = Math.floor(cu)
  const cl = cu - ci
  const id = ((ci % RIM_CELLS) + RIM_CELLS) % RIM_CELLS
  const h1 = hash3(id, 1.7, 3.1)
  const h2 = hash3(id, 9.2, 0.4)
  const crack = 1 - smooth(0, 0.14, Math.min(cl, 1 - cl))
  const fb = (0.01 + h1 * h1 * 0.085) * (1 - 0.65 * crack) * (0.8 + noise3(c * 24, s * 24, 1.3) * 0.4) * (1 - fall * 0.6)
  const lean = 0.004 + h2 * h2 * 0.045
  const cap = (1 - lean * smooth(0, fb, f) - crack * 0.028 * smooth(0, 0.008, f)) * (1 - smooth(fb, fb + 0.012, f))
  sc = Math.max(sc, cap, 0.004)

  // water seeps out along the bedding under each hard layer
  undersideSample.soft = (1 - slab) * hard * reach * 14
  undersideSample.hard = hard * slab
  // the lower part closes in a short, broken base instead of running out
  // into a point; the rock fingers hang below it
  const base = smooth(BASE_F, 1, f)
  // ragged, with short points hanging all over it
  const spike = noise3(c * 7 + 2.1, s * 7, f * 6)
  const rag = base * ((fbm3(c * 2.4 + 1.7, s * 2.4, 7.3, 3) - 0.3) * 6 + spike * spike * spike * 7 * smooth(0.55, 0.8, f))
  const y = yRim - fallFraction(f) * undersideDepth(a) - (f > 0 ? 0.15 : 0) - rag
  return out.set(rx * sc, y, rz * sc)
}

const BASE_F = 0.4
function fallFraction(f: number): number {
  return f < BASE_F ? f : BASE_F + (f - BASE_F) * 0.4
}

// The depth fraction at bearing `a` that lies at height `y`, for parts that
// hang down the rock.
export function undersideFraction(a: number, y: number): number {
  const k = rimScale(a)
  const yRim = groundHeight(Math.cos(a) * ISLAND_RX * k, Math.sin(a) * ISLAND_RZ * k) - RIM_DROP
  const g = (yRim - 0.15 - y) / undersideDepth(a)
  return Math.max(0, Math.min(1, g < BASE_F ? g : BASE_F + (g - BASE_F) / 0.4))
}

// cliff tiles around the island; a whole number so the texture closes on itself
const CLIFF_TILES = 24

function buildUnderside(tier: Tier): THREE.BufferGeometry {
  const rings = tier === 'phone' ? 90 : 176
  const segs = tier === 'phone' ? 240 : 420
  const pos: number[] = []
  const uv: number[] = []
  const rock: number[] = []
  const index: number[] = []
  const p = new THREE.Vector3()
  for (let i = 0; i <= rings; i++) {
    // denser near the lip, where the blocks and ledges are
    const f = Math.pow(i / rings, 1.3)
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU
      undersidePoint(a, f, p)
      pos.push(p.x, p.y, p.z)
      uv.push((j / segs) * CLIFF_TILES, p.y / 6)
      rock.push(Math.min(undersideSample.soft, 1), undersideSample.hard, f)
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j
      const b = a + segs + 1
      index.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const geo = new THREE.BufferGeometry()
  buildFingers(tier, pos, uv, rock, index)
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('aCliff', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('aRock', new THREE.Float32BufferAttribute(rock, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

// Rock fingers under the broken base: a few pinnacles of the same layered
// stone, clustered to one side, each its own length and lean, set deep into
// the body so the join never shows. Same mesh and material as the rest.
function buildFingers(tier: Tier, pos: number[], uv: number[], rock: number[], index: number[]): void {
  const phone = tier === 'phone'
  const rings = phone ? 16 : 36
  const segs = phone ? 18 : 40
  const rand = rng(2203)
  const p = new THREE.Vector3()
  // bearing, distance out as a share of the base, radius, visible length:
  // a long one off the middle, the rest spread to the base's edge, getting
  // thinner and shorter the further out they hang
  const specs: [number, number, number, number][] = [
    [1.6, 0.25, 2.3, 15],
    [2.5, 0.45, 1.8, 10],
    [0.8, 0.55, 1.5, 8],
    [3.1, 0.82, 1.0, 5],
    [4.7, 0.6, 1.4, 7],
    [5.7, 0.86, 0.75, 3.5],
    [0.1, 0.88, 0.85, 4],
    [2.0, 0.9, 0.8, 4.5],
  ]
  const used = phone ? specs.slice(0, 6) : specs
  for (const [n, spec] of used.entries()) {
    const [b0, share, rr, visible] = spec
    const b = b0 + (rand() - 0.5) * 0.3
    const r0 = rr * (0.85 + rand() * 0.3)
    // each one starts a little way up inside the broken base, wherever it hangs
    undersidePoint(b, BASE_F, p)
    const rb = Math.hypot(p.x, p.z)
    const d = Math.min(share * rb, rb - r0 - 0.5)
    const cx = Math.cos(b) * d
    const cz = Math.sin(b) * d
    const q = d / rb
    // from the height where the base starts to close, so the top is always
    // buried, down past the base by its own visible length
    const y0 = p.y + 1.5
    const hidden = 1.5 + (1 - q * q) * (1 - BASE_F) * 0.4 * undersideDepth(b) + 3
    const length = visible * (0.85 + rand() * 0.3) + hidden
    const lx = (rand() - 0.5) * 0.12
    const lz = (rand() - 0.5) * 0.12
    const seed = n * 13.7
    const start = pos.length / 3
    for (let i = 0; i <= rings; i++) {
      const t = i / rings
      const yy = y0 - t * length
      // strata in the finger too, at world heights so they line up with the body
      const dd = -yy / 2.3 + (noise3(seed, t * 2, 1.1) - 0.5) * 1.2
      const band = Math.floor(dd)
      const bt = dd - band
      const hard = smooth(0.35, 0.7, hash3(band, seed, 4.2))
      const slab = smooth(0, 0.08, bt) * (1 - smooth(0.5, 0.7, bt))
      // they narrow, then end broken off rather than in a point
      const tv = Math.max(0, (t * length - hidden) / Math.max(length - hidden, 1))
      const flare = 1 + 0.6 * (1 - smooth(0, 0.3, tv))
      const taper = (1 - 0.72 * Math.pow(tv, 1.15)) * flare * (i === rings ? 0 : 1)
      const ax = cx + lx * t * length
      const az = cz + lz * t * length
      for (let j = 0; j <= segs; j++) {
        const th = (j / segs) * TAU
        const c = Math.cos(th)
        const s = Math.sin(th)
        const lump = (fbm3(c * 1.3 + seed, s * 1.3, t * length * 0.18, 3) - 0.5) * 0.9
        const r = Math.max(r0 * taper * (1 + lump + (slab * hard - 0.3) * 0.18), 0.02)
        // the break is a ragged, slightly domed face
        const brk = i >= rings - 1 ? (noise3(c * 2 + seed, s * 2, 3.3) - 0.5) * r0 * 0.7 : 0
        pos.push(ax + c * r, yy + brk - (i === rings ? r0 * 0.25 : 0), az + s * r)
        uv.push((j / segs) * 4, yy / 6)
        rock.push(Math.min((1 - slab) * hard, 1), hard * slab, 0.6 + 0.35 * t)
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = start + i * (segs + 1) + j
        const b2 = a + segs + 1
        index.push(a, a + 1, b2, a + 1, b2 + 1, b2)
      }
    }
  }
}

// two thin springs seep out under the lip and run down the rock, besides
// the waterfall; bearings in cliff tiles
const TRICKLES = [(1.32 / TAU) * CLIFF_TILES, (2.72 / TAU) * CLIFF_TILES]
const TILE_M = (((ISLAND_RX + ISLAND_RZ) / 2) * TAU) / CLIFF_TILES

const CLIFF_VERT_PARS = /* glsl */ `
attribute vec2 aCliff;
attribute vec3 aRock;
varying vec2 vCUv;
varying vec3 vRock;
varying vec3 vCWorld;
varying vec3 vCNormal;
`

const CLIFF_FRAG_PARS = /* glsl */ `
uniform sampler2D tCliffD, tCliffN, tCliffA;
uniform sampler2D tRockD, tRockN, tRockA;
uniform sampler2D tMossD, tMossN, tMossA;
uniform sampler2D tSoilD;
uniform float uTime;
varying vec2 vCUv;
varying vec3 vRock;
varying vec3 vCWorld;
varying vec3 vCNormal;
vec3 cliffNormal;
vec3 cliffArm;
const float C_TRICKLE[${TRICKLES.length}] = float[](${TRICKLES.map((v) => v.toFixed(4)).join(', ')});
float cHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float cNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1, 0)), u.x), mix(cHash(i + vec2(0, 1)), cHash(i + vec2(1, 1)), u.x), u.y);
}
// tangent frames: faces are mapped around the island and down, ledge tops from above
vec3 sideToWorld(vec3 n, vec3 N) {
  vec3 T = normalize(vec3(-N.z, 0.0, N.x) + vec3(1e-4, 0.0, 0.0));
  vec3 B = cross(T, N);
  return T * n.x + B * n.y + N * n.z;
}
vec3 topToWorld(vec3 n, vec3 N) {
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(T, N);
  return T * n.x - B * n.y + N * n.z;
}
`

const CLIFF_MAP = /* glsl */ `
{
  vec3 N = normalize(vCNormal);
  vec2 uv = vCUv;
  float y = vCWorld.y;
  // faces: the cliff scan at two scales, the rock scan along the hard layers
  vec3 dA = texture2D(tCliffD, uv).rgb;
  vec3 nA = texture2D(tCliffN, uv).rgb * 2.0 - 1.0;
  vec3 aA = texture2D(tCliffA, uv).rgb;
  vec3 sd = dA;
  vec3 sn = nA;
  vec3 sa = aA;
#ifndef CLIFF_LITE
  vec2 uv2 = uv * 0.5 + vec2(0.37, 0.21);
  vec3 dB = texture2D(tCliffD, uv2).rgb;
  vec3 nB = texture2D(tCliffN, uv2).rgb * 2.0 - 1.0;
  vec3 aB = texture2D(tCliffA, uv2).rgb;
  vec2 ruv = uv * 2.0 + vec2(0.0, 0.5);
  vec3 dR = texture2D(tRockD, ruv).rgb;
  vec3 nR = texture2D(tRockN, ruv).rgb * 2.0 - 1.0;
  vec3 aR = texture2D(tRockA, ruv).rgb;
  float big = smoothstep(0.3, 0.7, cNoise(vec2(uv.x * 1.3, y * 0.11)));
  sd = mix(dA, dB, big * 0.4);
  sn = normalize(mix(nA, nB, big * 0.3));
  sa = mix(aA, aB, big * 0.4);
  float hardW = smoothstep(0.25, 0.7, vRock.y) * smoothstep(0.35, 0.65, cNoise(uv * 3.0)) * 0.6;
  sd = mix(sd, dR * vec3(0.95, 0.97, 1.0), hardW);
  sn = normalize(mix(sn, nR, hardW));
  sa = mix(sa, vec3(aR.r, max(aR.g, 0.8), 0.0), hardW);
#endif

  // ledge tops: the cliff scan seen from above, moss where water and soil collect
  float top = smoothstep(0.55, 0.85, N.y);
  // any face that is near level, up or down, is mapped from above so nothing stretches
  float plan = max(smoothstep(0.5, 0.8, N.y), smoothstep(0.82, 0.96, -N.y));
  vec2 puv = vCWorld.xz / 2.4;
  vec3 dT = texture2D(tCliffD, puv).rgb;
  vec3 nT = texture2D(tCliffN, puv).rgb * 2.0 - 1.0;
  vec3 aT = texture2D(tCliffA, puv).rgb;
  // seen from above the scan's lichen reads as grass; keep the stone's own colour
  dT = mix(vec3(dot(dT, vec3(0.3, 0.55, 0.15))) * vec3(1.08, 0.97, 0.88), dT, 0.4);
  vec2 muv = vCWorld.xz / 1.8;
  vec3 dM = texture2D(tMossD, muv).rgb;
  vec3 nM = texture2D(tMossN, muv).rgb * 2.0 - 1.0;
  vec3 aM = texture2D(tMossA, muv).rgb;
  float lipNear = 1.0 - smoothstep(0.05, 0.4, vRock.z);
  float moss = smoothstep(0.74, 0.86, cNoise(vCWorld.xz * 0.7) * 0.6 + cNoise(vCWorld.xz * 2.3) * 0.4 + lipNear * 0.06);
  moss *= smoothstep(0.6, 0.85, N.y + 0.1 * lipNear);
  dT = mix(dT, dM * vec3(0.15, 0.28, 0.11), moss);
  nT = normalize(mix(nT, nM, moss));
  aT = mix(aT, aM, moss);

  // towards the point the wrap-around mapping crowds; map it from the sides
  float tip = smoothstep(0.55, 0.8, vRock.z);
  {
    vec2 w2 = abs(N.xz) + 1e-3;
    w2 /= w2.x + w2.y;
    vec2 ux = vec2(vCWorld.z, y) / 5.0;
    vec2 uz = vec2(vCWorld.x, y) / 5.0 + 0.5;
    vec3 tD = texture2D(tCliffD, ux).rgb * w2.x + texture2D(tCliffD, uz).rgb * w2.y;
    vec3 tN = (texture2D(tCliffN, ux).rgb * w2.x + texture2D(tCliffN, uz).rgb * w2.y) * 2.0 - 1.0;
    vec3 tA = texture2D(tCliffA, ux).rgb * w2.x + texture2D(tCliffA, uz).rgb * w2.y;
    sd = mix(sd, tD, tip);
    sn = normalize(mix(sn, tN, tip));
    sa = mix(sa, tA, tip);
  }
  // undersides are seen edge on and in shade: there the scan's sharp cracks
  // only alias into stripes, so they take a softened, flatter version
  float under = smoothstep(-0.15, -0.65, N.y);
  sd = mix(sd, texture2D(tCliffD, uv, 2.5).rgb, under);
  sn = normalize(mix(sn, vec3(0.0, 0.0, 1.0), under * 0.7));
  vec3 dif = mix(sd, dT, plan);
  // a thin, ragged horizon of soil and roots right under the turf
  float soilW = 1.0 - smoothstep(0.003, 0.01 + 0.014 * cNoise(vec2(uv.x * 26.0, 3.0)) + 0.006 * cNoise(vec2(uv.x * 90.0, 1.0)), vRock.z);
  dif = mix(dif, texture2D(tSoilD, uv * vec2(2.0, 2.0)).rgb * vec3(0.7, 0.62, 0.55), soilW);
  vec3 wn = normalize(mix(sideToWorld(sn, N), topToWorld(nT, N), plan));
  vec3 arm = mix(sa, aT, plan);

  // overhang undersides stay in their own shade
  arm.r *= mix(1.0, 0.55, under);
  dif *= mix(1.0, 0.8, under);

  // soft layers seep: dark, a little glossy, streaking down from each ledge
  float streak = cNoise(vec2(uv.x * 10.0, y * 0.25)) * 0.7 + cNoise(vec2(uv.x * 26.0, y * 0.5)) * 0.3;
  float damp = clamp(vRock.x * (0.6 + 0.4 * streak), 0.0, 1.0) * (1.0 - top);
  dif *= mix(1.0, 0.68, damp);
  arm.g *= mix(1.0, 0.85, damp);
  // greyer and cooler deeper down, warmer stained bands near the top
  float bandTone = cNoise(vec2(uv.x * 0.6, y * 0.45));
  dif *= mix(vec3(1.04, 0.98, 0.92), vec3(0.9, 0.93, 0.97), smoothstep(0.1, 0.8, vRock.z));
  dif *= mix(0.86, 1.08, bandTone);

  // the springs: a dark wet run, a thin glossy core where the water moves
  float wetAll = 0.0;
  float coreAll = 0.0;
  for (int i = 0; i < ${TRICKLES.length}; i++) {
    float fi = float(i);
    float xc = C_TRICKLE[i] + (cNoise(vec2(y * 0.22, fi * 7.0)) - 0.5) * 0.14 + (cNoise(vec2(y * 0.9, fi * 3.0)) - 0.5) * 0.03;
    float dx = abs(uv.x - xc) * ${TILE_M.toFixed(3)};
    float run = smoothstep(0.004, 0.03, vRock.z) * (1.0 - smoothstep(0.3, 0.55 + 0.1 * fi, vRock.z));
    float wet = (1.0 - smoothstep(0.12, 0.55 + 0.25 * cNoise(vec2(y * 0.6, fi)), dx)) * run;
    float core = (1.0 - smoothstep(0.03, 0.11, dx)) * run * (1.0 - smoothstep(0.25, 0.5, abs(N.y)));
    wetAll = max(wetAll, wet);
    coreAll = max(coreAll, core);
  }
  dif *= mix(1.0, 0.45, wetAll);
  dif *= mix(1.0, 0.7, coreAll);
  arm.g = mix(arm.g, 0.22, wetAll * 0.8);
  arm.g = mix(arm.g, 0.05, coreAll);
  float ripple = sin((y + uTime * 2.6) * 9.0 + cNoise(vec2(uv.x * 200.0, y * 3.0)) * 6.0);
  wn = normalize(wn + vec3(-N.z, 0.0, N.x) * ripple * 0.35 * coreAll + vec3(0.0, 1.0, 0.0) * ripple * 0.2 * coreAll);

  // rough stone everywhere but on the water itself
  arm.g = max(arm.g, mix(0.86, 0.35, max(coreAll, wetAll * 0.5)));
  cliffNormal = wn;
  cliffArm = arm;
  diffuseColor.rgb *= dif;
}
`

function patchCliff(mat: THREE.MeshStandardMaterial, cliff: PbrSet, rock: PbrSet, moss: PbrSet, soil: PbrSet, tier: Tier): void {
  // phones skip the second cliff scale and the rock scan on the faces
  if (tier === 'phone') mat.defines = { CLIFF_LITE: '' }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = realmUniforms.uTime
    shader.uniforms.tSoilD = { value: soil.map }
    const sets: [string, PbrSet][] = [
      ['Cliff', cliff],
      ['Rock', rock],
      ['Moss', moss],
    ]
    for (const [name, s] of sets) {
      shader.uniforms[`t${name}D`] = { value: s.map }
      shader.uniforms[`t${name}N`] = { value: s.normalMap }
      shader.uniforms[`t${name}A`] = { value: s.arm }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CLIFF_VERT_PARS}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vCUv = aCliff;
        vRock = aRock;
        vCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vCNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLIFF_FRAG_PARS}`)
      .replace('#include <map_fragment>', CLIFF_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * cliffArm.g;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = 0.0;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(cliffNormal, 0.0)).xyz);')
      .replace(
        '#include <aomap_fragment>',
        `float ambientOcclusion = mix(1.0, cliffArm.r, 0.9);
        reflectedLight.indirectDiffuse *= ambientOcclusion;
        reflectedLight.indirectSpecular *= ambientOcclusion * ambientOcclusion;`,
      )
  }
  mat.customProgramCacheKey = () => `realm-terrain-cliff-${tier === 'phone' ? 'lite' : 'full'}`
}

export class Terrain implements RealmPart {
  readonly object = new THREE.Group()
  private materials: THREE.Material[] = []
  private geometries: THREE.BufferGeometry[] = []

  static async create(tier: Tier): Promise<Terrain> {
    const [soil, gravel, moss, pebbles, cliff, rock] = await Promise.all([
      loadPbr('soil', tier),
      loadPbr('gravel', tier),
      loadPbr('moss', tier),
      loadPbr('pebbles', tier),
      loadPbr('cliff', tier),
      loadPbr('rock', tier),
    ])
    return new Terrain(tier, [soil, gravel, moss, pebbles], cliff, rock)
  }

  private constructor(tier: Tier, ground: PbrSet[], cliff: PbrSet, rock: PbrSet) {
    const topGeo = buildTop(tier)
    const topMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    patchSplat(topMat, ground)
    const top = new THREE.Mesh(topGeo, topMat)
    top.receiveShadow = true
    top.castShadow = true
    top.name = 'ground'

    const [soil, , moss] = ground
    const underGeo = buildUnderside(tier)
    const underMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.92, 0.88, 0.84), roughness: 1, metalness: 0 })
    if (soil && moss) patchCliff(underMat, cliff, rock, moss, soil, tier)
    const under = new THREE.Mesh(underGeo, underMat)
    under.receiveShadow = true
    under.castShadow = true
    under.name = 'underside'
    // faces almost along the low sun would shade themselves in stripes; the
    // far side of the rock casts instead
    underMat.shadowSide = THREE.BackSide

    this.object.add(top, under)
    this.geometries.push(topGeo, underGeo)
    this.materials.push(topMat, underMat)
  }

  update(): void {}

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
  }
}
