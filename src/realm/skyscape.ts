import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { loadPbr, pbrMaterial } from './assets'
import { SUN_DIRECTION, realmUniforms } from './atmosphere'
import { fbm2, rng } from './layout'
import type { Frame, RealmPart, Tier } from './types'

// The sky world around the island: a raymarched sea of cumulus far below,
// towering banks on the horizon, thin wisps past the rim and a few small
// islands floating in the distance.
//
// The clouds are traced offscreen at reduced resolution in prerender(). A
// depth-only pass of the host scene at that resolution stops each ray at the
// first opaque surface, so the rock that dips into the clouds is veiled by
// exactly the cloud in front of it. The composite runs inside the host's main
// pass as a fullscreen transparent quad that writes the cloud front into
// gl_FragDepth for the depth test only (it does not write depth), so the
// island in front stays crisp at full resolution.

interface TierSettings {
  scale: number // cloud target size relative to the drawing buffer
  depthScale: number // depth pass size relative to the drawing buffer
  steps: number
  towerSteps: number
  lightSteps: number
}

const TIERS: Record<Tier, TierSettings> = {
  ultra: { scale: 0.5, depthScale: 1, steps: 72, towerSteps: 40, lightSteps: 4 },
  high: { scale: 0.4, depthScale: 1, steps: 56, towerSteps: 32, lightSteps: 3 },
  phone: { scale: 0.22, depthScale: 0.5, steps: 30, towerSteps: 18, lightSteps: 2 },
}

const NOISE_SIZE = 64

// The depth copy only draws what is on this layer: the large, plain meshes
// the clouds actually meet (terrain, the island rock, buildings, the far
// islands). Instanced and transparent things are left to the main pass's
// depth test, so the copy compiles one program instead of one per material.
const DEPTH_LAYER = 29
const DEPTH_MIN_RADIUS = 4

// Towering banks: x, z, radius, height above the sea, all in metres. They
// stand behind the shrine, under the sun, over the right rim at the end of
// the walk and out past the landing, so every view has a far layer.
const TOWERS: readonly [number, number, number, number][] = [
  [260, -2350, 560, 500], // behind the shrine, right of the path axis
  [-700, -2850, 640, 430], // behind the shrine, left
  [-2500, -1550, 600, 380], // under the sun, backlit
  [2500, -2200, 650, 460], // right of the ema rack at the end
  [2600, 1800, 600, 420], // out past the landing
  [900, 2900, 520, 320],
  [-2900, 900, 560, 300],
  [1700, -600, 480, 280],
]
const TOWER_COUNT = TOWERS.length

// Distant massifs rising out of the sea: x, z, radius, peak height above the
// base, base height. Centre distance plus radius stays under 2600 m, inside
// the host's 3000 m far plane, so no edge is ever clipped into a straight line.
const MASSIFS: readonly [number, number, number, number, number][] = [
  [-438, -1726, 820, 300, -95], // the far range behind the shrine
  [505, -1623, 900, 250, -95],
  [1361, -1238, 760, 270, -95], // the end view, right of the rack
  [1744, 356, 820, 230, -95], // left of the opening view, mostly out of frame
  [-1717, -813, 700, 240, -95], // under the sun, a backlit silhouette
]

// Distant islands: position of the top centre, top radius.
const FAR_ISLANDS: readonly { x: number; y: number; z: number; r: number; seed: number; crown: 'grove' | 'shrine' | 'pine' | 'torii'; air?: number }[] = [
  // the prominent one behind the shrine, slightly left of the path, and a
  // smaller one to the right
  { x: -150, y: 135, z: -520, r: 38, seed: 61, crown: 'grove', air: 650 },
  { x: 122, y: 100, z: -320, r: 14, seed: 67, crown: 'pine' },
  { x: -160, y: -20, z: -210, r: 9, seed: 11, crown: 'pine' },
  { x: 235, y: 10, z: -190, r: 13, seed: 23, crown: 'grove' },
  { x: 430, y: -22, z: -390, r: 21, seed: 37, crown: 'shrine' },
  { x: -360, y: 26, z: 60, r: 12, seed: 41, crown: 'pine' },
  { x: 330, y: -4, z: 110, r: 16, seed: 71, crown: 'grove' },
  // the focal point of the opening view out over the rim, a little right of
  // centre, lit from the left by the low sun
  { x: 112, y: 10, z: 280, r: 17, seed: 83, crown: 'torii' },
  // a loose cluster further out to the left of the opening view
  { x: 306, y: 45, z: 333, r: 8, seed: 89, crown: 'pine', air: 1000 },
  { x: 452, y: 28, z: 417, r: 20, seed: 97, crown: 'grove', air: 1000 },
  { x: 656, y: -6, z: 464, r: 27, seed: 101, crown: 'shrine', air: 1000 },
  { x: 120, y: -30, z: -520, r: 16, seed: 53, crown: 'pine' },
]

// --- noise volume -------------------------------------------------------------

function hash3(x: number, y: number, z: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// Per cell random values for one period and seed, computed once: the noise
// below reads them from tables instead of hashing per sample, which keeps the
// volume's construction short on a phone.
function cellTable(p: number, seed: number, channels: number): Float64Array {
  const t = new Float64Array(p * p * p * channels)
  let k = 0
  for (let z = 0; z < p; z++) {
    for (let y = 0; y < p; y++) {
      for (let x = 0; x < p; x++) {
        for (let c = 0; c < channels; c++) t[k++] = hash3(x, y, z, seed + c)
      }
    }
  }
  return t
}

// Tileable value noise with period `p` cells; tab from cellTable(p, seed, 1).
function valueNoise(x: number, y: number, z: number, p: number, tab: Float64Array): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
  const x0 = ((ix % p) + p) % p
  const y0 = ((iy % p) + p) % p
  const z0 = ((iz % p) + p) % p
  const x1 = (x0 + 1) % p
  const y1 = (y0 + 1) % p
  const z1 = (z0 + 1) % p
  const at = (xx: number, yy: number, zz: number): number => tab[(zz * p + yy) * p + xx]!
  const a = at(x0, y0, z0) + (at(x1, y0, z0) - at(x0, y0, z0)) * ux
  const b = at(x0, y1, z0) + (at(x1, y1, z0) - at(x0, y1, z0)) * ux
  const c = at(x0, y0, z1) + (at(x1, y0, z1) - at(x0, y0, z1)) * ux
  const d = at(x0, y1, z1) + (at(x1, y1, z1) - at(x0, y1, z1)) * ux
  const e = a + (b - a) * uy
  const f = c + (d - c) * uy
  return e + (f - e) * uz
}

// Tileable cellular noise: 1 at feature points, 0 far from them; tab from
// cellTable(p, seed, 3).
function worley(x: number, y: number, z: number, p: number, tab: Float64Array): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  let best = 9
  for (let dz = -1; dz <= 1; dz++) {
    const cz = iz + dz
    const wz = ((cz % p) + p) % p
    for (let dy = -1; dy <= 1; dy++) {
      const cy = iy + dy
      const wy = ((cy % p) + p) % p
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx
        const wx = ((cx % p) + p) % p
        const k = ((wz * p + wy) * p + wx) * 3
        const px = cx + tab[k]! - x
        const py = cy + tab[k + 1]! - y
        const pz = cz + tab[k + 2]! - z
        const d = px * px + py * py + pz * pz
        if (d < best) best = d
      }
    }
  }
  return 1 - Math.min(1, Math.sqrt(best))
}

// r: billowy base shape (value fbm eroded by cellular fbm), g: fine cellular
// detail for the edges. Both tile, the shader breaks the period by mixing
// scales and rotations. The volume is filled a few slices per frame (see
// Skyscape.update), so building it never holds up the page in one go.
interface NoiseTables {
  v4: Float64Array
  v8: Float64Array
  v16: Float64Array
  w4: Float64Array
  w8: Float64Array
  w16: Float64Array
  d8: Float64Array
  d16: Float64Array
  d32: Float64Array
}

function noiseTables(): NoiseTables {
  return {
    v4: cellTable(4, 1, 1),
    v8: cellTable(8, 2, 1),
    v16: cellTable(16, 3, 1),
    w4: cellTable(4, 7, 3),
    w8: cellTable(8, 11, 3),
    w16: cellTable(16, 13, 3),
    d8: cellTable(8, 17, 3),
    d16: cellTable(16, 19, 3),
    d32: cellTable(32, 23, 3),
  }
}

function fillNoiseSlice(data: Uint8Array, z: number, t: NoiseTables): void {
  const n = NOISE_SIZE
  let i = z * n * n * 2
  const w = z / n
  for (let y = 0; y < n; y++) {
    const v = y / n
    for (let x = 0; x < n; x++) {
      const u = x / n
      const vn =
        valueNoise(u * 4, v * 4, w * 4, 4, t.v4) * 0.5 +
        valueNoise(u * 8, v * 8, w * 8, 8, t.v8) * 0.3 +
        valueNoise(u * 16, v * 16, w * 16, 16, t.v16) * 0.2
      const wf =
        worley(u * 4, v * 4, w * 4, 4, t.w4) * 0.625 +
        worley(u * 8, v * 8, w * 8, 8, t.w8) * 0.25 +
        worley(u * 16, v * 16, w * 16, 16, t.w16) * 0.125
      // remap the value noise by the cellular field: round billows
      const base = Math.min(1, Math.max(0, (vn - (1 - wf)) / Math.max(1e-3, wf) + 0.5 * wf))
      const det =
        worley(u * 8, v * 8, w * 8, 8, t.d8) * 0.55 +
        worley(u * 16, v * 16, w * 16, 16, t.d16) * 0.3 +
        worley(u * 32, v * 32, w * 32, 32, t.d32) * 0.15
      data[i++] = Math.round(base * 255)
      data[i++] = Math.round(det * 255)
    }
  }
}

function noiseTexture(data: Uint8Array): THREE.Data3DTexture {
  const n = NOISE_SIZE
  const tex = new THREE.Data3DTexture(data, n, n, n)
  tex.format = THREE.RGFormat
  tex.type = THREE.UnsignedByteType
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.wrapR = THREE.RepeatWrapping
  tex.minFilter = THREE.LinearMipmapLinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = true
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

// --- shared sky lookup --------------------------------------------------------

// The haze the far things fade into is the host's own sky near the horizon
// when it is an equirect texture, otherwise a warm late afternoon gradient.
// The haze the far things fade into is the host's own sky near the horizon.
// Mode 1 reads an equirect texture in the three.js convention, mode 2 the
// cropped panorama the host ships (bg.json: u = 0.5 looks down -z, rows cover
// elevations +90 to -25, values stored as (L * k)^(1 / 2.2)), turned by
// uSkyYaw about +y. Mode 0 is a warm late afternoon gradient.
const SKY_GLSL = /* glsl */ `
uniform sampler2D uSkyTex;
uniform float uSkyMode;
uniform float uSkyK;
uniform float uSkyYaw;
uniform vec3 uSunDir;
vec3 skyGradient(vec3 d) {
  float h = d.y;
  vec3 zenith = vec3(0.16, 0.30, 0.62);
  vec3 horizon = vec3(1.05, 0.82, 0.62);
  vec3 c = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.45));
  float s = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.62, 0.32) * (pow(s, 6.0) * 0.7 + pow(s, 48.0) * 1.6) * (1.0 - clamp(h, 0.0, 1.0) * 0.6);
  return c * 1.1;
}
vec3 skyLookup(vec3 d) {
  if (uSkyMode > 1.5) {
    float cy = cos(uSkyYaw);
    float sy = sin(uSkyYaw);
    vec3 r = vec3(cy * d.x - sy * d.z, d.y, sy * d.x + cy * d.z);
    float a = atan(r.x, -r.z);
    float e = asin(clamp(r.y, -0.42, 1.0));
    vec2 uv = vec2(a * 0.15915494 + 0.5, 1.0 - (0.5 - e * 0.31830989) / 0.6389);
    vec3 c = texture(uSkyTex, uv).rgb;
    return pow(c, vec3(2.2)) / uSkyK;
  }
  if (uSkyMode > 0.5) {
    vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
    return texture(uSkyTex, uv).rgb;
  }
  return skyGradient(d);
}
// the colour of the air in direction d, sampled just above the horizon
vec3 hazeColor(vec3 d) {
  vec3 h = normalize(vec3(d.x, 0.03, d.z));
  return skyLookup(h);
}
`

// --- the raymarch -------------------------------------------------------------

const MARCH_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const MARCH_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outFront;

uniform sampler3D uNoise;
uniform sampler2D uDepth;
uniform vec2 uTexel;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform float uTime;
uniform vec2 uDrift;
uniform vec3 uSunColor;
uniform vec3 uShadowColor;
uniform vec4 uTowers[${TOWER_COUNT}];
uniform vec4 uTowerBounds[${TOWER_COUNT}];
uniform float uMaxScene;
uniform float uFrame;
uniform int uSteps;
uniform int uTowerSteps;
uniform int uLightSteps;
uniform float uPixelAngle;
${SKY_GLSL}

const float SEA_BASE = -55.0;
const float SLAB_TOP = -22.0;
const float SLAB_BOTTOM = -105.0;
const float SIGMA = 0.21;
const float HAZE_DIST = 1900.0;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

// height of the cloud tops at xz, and how much of a tower this column is
float tops(vec2 xz, vec2 q, out float tower) {
  // two octaves of non periodic noise keep the sea from repeating
  float swell = vnoise(q * 0.00055 + 1.7);
  float h = SEA_BASE
    + (swell - 0.5) * 34.0
    + (vnoise(q * 0.0016 + 3.1) - 0.5) * 22.0
    + (vnoise(q * 0.0047 - 7.7) - 0.5) * 9.0;
  // cellular masses a few hundred metres across, with lower lanes between
  float mass = textureLod(uNoise, vec3(q.x, 0.0, q.y) * (1.0 / 1700.0) + vec3(0.0, 0.43, 0.0), 0.0).r;
  h += (smoothstep(0.15, 0.75, mass) - 0.5) * 36.0;
  // the sea heaps up around the foot of the island and wraps the lower rock
  // far out the sea lines up in long streets across the wind
  float farW = smoothstep(900.0, 2200.0, length(xz));
  vec2 across = vec2(-0.4, 0.92);
  float street = sin(dot(q, across) * (6.2832 / 640.0) + vnoise(q * 0.0021) * 4.0);
  h += street * 6.0 * farW;
  float r = length(xz * vec2(1.0, 0.75)) * (0.6 + 0.8 * vnoise(xz * 0.035 + q * 0.004));
  h = max(h, -4.0 - r * r * 0.005);
  tower = 0.0;
  for (int i = 0; i < ${TOWER_COUNT}; i++) {
    vec4 t = uTowers[i];
    vec2 o = xz - t.xy;
    float wob = vnoise(o * 0.006 + float(i) * 13.0) - 0.5;
    float d = length(o) / t.z + wob * 0.35;
    float k = clamp(1.0 - d * d, 0.0, 1.0);
    float th = SEA_BASE + t.w * pow(k, 0.55);
    if (th > h) { h = mix(h, th, smoothstep(0.0, 0.25, k)); }
    tower = max(tower, smoothstep(0.0, 0.5, k));
  }
  return h;
}

// Every lookup inside the march names its mip level: implicit derivatives in
// a loop make the shader compiler unroll it, which costs seconds to compile.
// lod is the mip level for the base shape at this distance; dTopOut and
// towerOut hand the column back to the lighting.
float density(vec3 p, float detail, float lod, out float dTopOut, out float towerOut) {
  vec3 q = p + vec3(uDrift.x, 0.0, uDrift.y);
  float tower;
  float top = tops(p.xz, q.xz, tower);
  float dTop = top - p.y;
  dTopOut = dTop;
  towerOut = tower;
  if (dTop < 0.0) return 0.0;
  // the billow size wanders across the sea so no two stretches match
  float wander = vnoise(q.xz * 0.0011 - 4.3);
  // smaller broken cumulus near the island, big billows stretched along the
  // wind far out
  float far = smoothstep(500.0, 1800.0, length(p.xz));
  float big = mix(0.75 + wander * 0.7, 2.6, tower) * mix(0.62, 1.3, far);
  vec2 along = vec2(0.92, 0.4);
  q.xz -= along * dot(q.xz, along) * 0.25 * far;
  vec3 warp = vec3(vnoise(q.xz * 0.004), 0.0, vnoise(q.zx * 0.004 + 9.1)) * 90.0;
  q += warp;
  float l = max(0.0, lod - log2(big));
  vec3 s1 = q * (1.0 / (210.0 * big));
  vec3 s2 = vec3(q.x * 0.8 + q.z * 0.6, q.y, q.z * 0.8 - q.x * 0.6) * (1.0 / (530.0 * big)) + vec3(0.31, uTime * 0.0011, 0.77);
  // a third, smaller octave gives the tops their cauliflower turrets
  vec3 sm = vec3(q.z * 0.6 - q.x * 0.8, q.y * 1.3, q.x * 0.6 + q.z * 0.8) * (1.0 / (88.0 * big)) + vec3(0.53, 0.0, 0.19);
  float shape = textureLod(uNoise, s1, l).r * 0.5 + textureLod(uNoise, s2, max(0.0, l - 1.34)).r * 0.3
              + textureLod(uNoise, sm, l + 1.25).r * 0.2;
  float fade = clamp(dTop / mix(26.0 + wander * 34.0, 120.0, tower), 0.0, 1.0);
  float d = shape * 1.0 + fade * 0.95 - 0.87 - (1.0 - far) * 0.025;
  if (d <= 0.0) return 0.0;
  if (detail > 0.0) {
    vec3 s3 = q * (1.0 / (48.0 * big)) + vec3(0.0, uTime * 0.008, 0.0);
    float det = textureLod(uNoise, s3, l + 2.13).g;
    d -= (1.0 - det) * 0.22 * detail * (1.0 - fade * 0.6) * (1.0 - tower * 0.75);
  }
  return clamp(d * 9.0, 0.0, 1.0);
}

float phaseHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5);
}

// One step of the march: the light towards the sun, scattering, haze.
void marchStep(vec3 p, float t, float dt, float phase, float warm, vec3 haze, vec3 skyUp, vec3 sunC, vec3 shadowC,
               inout vec3 col, inout float trans, inout float front) {
  // mip level of the base shape for this pixel's footprint at distance t
  float lod = log2(max(1.0, t * uPixelAngle * (64.0 / 210.0)));
  float detail = clamp(1.0 - t / 1300.0, 0.0, 1.0);
  float dTop;
  float tower;
  float dens = density(p, detail, lod, dTop, tower);
  if (dens <= 0.001) return;
  if (front > 1e4 && dens > 0.02) front = t;
  float od = 0.0;
  float ls = 4.0;
  float lt = 0.0;
  float dl;
  float tl2;
  for (int j = 0; j < 4; j++) {
    if (j >= uLightSteps) break;
    lt += ls * 0.5;
    od += density(p + uSunDir * lt, 0.0, lod, dl, tl2) * ls;
    lt += ls * 0.5;
    ls *= 2.3;
  }
  // light is shadowed harder than the eye sees through: deep valleys
  float tl = exp(-od * SIGMA * 1.7);
  // a cheap stand in for multiple scattering: a softer second lobe
  float ms = exp(-od * SIGMA * 0.12) * 0.05;
  float lift = clamp(1.0 - dTop / mix(55.0, 220.0, tower), 0.0, 1.0);
  // the hollows between billows sink into a deeper blue shade
  vec3 amb = mix(shadowC * 0.3, skyUp * 0.08 + shadowC * 0.75, lift * lift);
  float powder = 1.0 - exp(-dens * 2.5);
  // thin sunlit edges glow gold: the rims of the billows on the sun side
  float rim = tl * (1.0 - smoothstep(0.0, 0.45, dens)) * 0.55;
  vec3 lit = sunC * (tl * phase * mix(0.55, 1.0, powder) + ms + rim * vec3(1.0, 0.78, 0.45)) + amb;
  float fog = 1.0 - exp(-t / HAZE_DIST);
  // warm light scattered into the long air on the sun side, strongest in the
  // middle distance so the far edge still meets the sky's own horizon
  vec3 air = haze + sunC * warm * fog * (1.0 - fog) * 1.2;
  lit = mix(lit, air, fog * fog * 0.92 + fog * 0.08);
  float stepT = exp(-dens * SIGMA * dt);
  col += trans * lit * (1.0 - stepT);
  trans *= stepT;
}

bool hitEllipsoid(vec3 ro, vec3 rd, vec4 b, float ry, out float ta, out float tb) {
  vec3 sc = vec3(1.0 / b.w, 1.0 / ry, 1.0 / b.w);
  vec3 o = (ro - b.xyz) * sc;
  vec3 d = rd * sc;
  float a = dot(d, d);
  float bb = dot(o, d);
  float c = dot(o, o) - 1.0;
  float disc = bb * bb - a * c;
  if (disc < 0.0) return false;
  float s = sqrt(disc);
  ta = (-bb - s) / a;
  tb = (-bb + s) / a;
  return tb > 0.0;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec4 v = uInvProj * vec4(ndc, 1.0, 1.0);
  vec3 viewDir = normalize(v.xyz / v.w);
  vec3 rd = normalize((uCamWorld * vec4(viewDir, 0.0)).xyz);
  vec3 ro = uCamPos;

  // the scene surface under this texel's centre, from the full resolution
  // depth; the composite matches it against each screen pixel's own depth
  float dmax = texture(uDepth, vUv).r;
  float sceneT = 1e7;
  if (dmax < 0.99999) {
    vec4 sp = uInvProj * vec4(ndc, dmax * 2.0 - 1.0, 1.0);
    sceneT = length(sp.xyz / sp.w);
    // a sky drawn as a mesh near the far plane is not a surface
    if (sceneT > uMaxScene) sceneT = 1e7;
  }

  // interleaved gradient noise, moved every frame; the resolve pass averages it out
  vec2 jp = gl_FragCoord.xy + mod(uFrame, 64.0) * vec2(5.588238, 5.588238);
  float jitter = fract(52.9829189 * fract(dot(jp, vec2(0.06711056, 0.00583715))));

  float cosT = dot(rd, uSunDir);
  float phase = mix(phaseHG(cosT, 0.7), phaseHG(cosT, -0.2), 0.3) * 0.6 + 0.25;
  vec3 haze = hazeColor(rd);
  vec2 hd = normalize(rd.xz + vec2(1e-5));
  float warm = pow(max(dot(hd, normalize(uSunDir.xz)), 0.0), 5.0);
  vec3 skyUp = skyLookup(vec3(0.0, 1.0, 0.0)) * 0.6 + skyLookup(normalize(vec3(-uSunDir.x, 0.4, -uSunDir.z))) * 0.4;
  // light is set relative to the sky itself, so the clouds sit right in
  // whatever exposure the host gives its panorama
  float ref = dot(skyLookup(normalize(vec3(-uSunDir.x, 0.15, -uSunDir.z))), vec3(0.2126, 0.7152, 0.0722));
  vec3 sunC = uSunColor * ref;
  vec3 shadowC = uShadowColor * ref;

  vec3 col = vec3(0.0);
  float trans = 1.0;
  float front = 1e5;

  // the sea segment
  float s0 = 0.0;
  float s1 = -1.0;
  if (rd.y < -1e-4) {
    s0 = max(0.0, (SLAB_TOP - ro.y) / rd.y);
    s1 = (SLAB_BOTTOM - ro.y) / rd.y;
    s1 = min(s1, s0 + 5000.0);
  }
  // the nearest tower the ray passes through
  float w0 = 1e9;
  float w1 = -1.0;
  for (int i = 0; i < ${TOWER_COUNT}; i++) {
    float ta, tb;
    vec4 b = uTowerBounds[i];
    if (hitEllipsoid(ro, rd, b, uTowers[i].w * 0.62 + 20.0, ta, tb)) {
      ta = max(ta, 0.0);
      if (ta < w0) { w0 = ta; w1 = tb; }
    }
  }

  // in ray order: sea before the tower, the tower with its own finer steps
  // (its base included, so there is no seam at the slab top), sea after it.
  // The segments go into one loop so its body exists once in the shader.
  vec3 seg0 = vec3(0.0);
  vec3 seg1 = vec3(0.0);
  vec3 seg2 = vec3(0.0);
  int count = 0;
  float fs = float(uSteps);
  float ft = float(uTowerSteps);
  if (w1 > 0.0) {
    if (s1 > 0.0 && s0 < w0) { seg0 = vec3(s0, min(min(s1, w0), sceneT), fs); count = 1; }
    vec3 tw = vec3(w0, min(w1, sceneT), ft);
    if (count == 0) seg0 = tw; else seg1 = tw;
    count += 1;
    if (s1 > w1) {
      vec3 after = vec3(max(s0, w1), min(s1, sceneT), fs);
      if (count == 1) seg1 = after; else seg2 = after;
      count += 1;
    }
  } else if (s1 > 0.0) {
    seg0 = vec3(s0, min(s1, sceneT), fs);
    count = 1;
  }
  for (int k = 0; k < 3; k++) {
    if (k >= count || trans < 0.01) break;
    vec3 seg = k == 0 ? seg0 : (k == 1 ? seg1 : seg2);
    float len = seg.y - seg.x;
    if (len <= 0.0) continue;
    int steps = int(seg.z);
    float dt = len / seg.z;
    float t = seg.x + dt * jitter;
    for (int i = 0; i < 96; i++) {
      if (i >= steps || trans < 0.01) break;
      marchStep(ro + rd * t, t, dt, phase, warm, haze, skyUp, sunC, shadowC, col, trans, front);
      t += dt * (0.85 + 0.3 * fract(jitter + float(i) * 0.618));
    }
  }

  // below the traced depth the sea is solid: shaded cloud interior fading
  // into the haze, so no ray ever sees through to the bottom of the sky
  if (rd.y < 0.0 && s1 > 0.0 && s1 < sceneT && trans > 0.0) {
    float fog = 1.0 - exp(-s1 / HAZE_DIST);
    // a lower deck shows through the gaps, mottled so it never reads as a floor
    vec3 sp = ro + rd * s1 + vec3(uDrift.x, 0.0, uDrift.y) * 0.6;
    float dl = log2(max(1.0, s1 * uPixelAngle * (64.0 / 900.0)));
    float deck = textureLod(uNoise, sp * (1.0 / 900.0), dl).r * 0.6 + textureLod(uNoise, sp * (1.0 / 260.0), dl + 1.8).r * 0.4;
    // the gaps look down into deep shade between the billows, not onto a floor
    vec3 deep = mix(mix(shadowC * 0.5, shadowC * 0.95 + sunC * 0.05, smoothstep(0.2, 0.8, deck)), haze, fog * fog * 0.92 + fog * 0.08);
    col += trans * deep;
    if (front > 1e4) front = s1;
    trans = 0.0;
  }
  outColor = vec4(col, 1.0 - trans);
  outFront = vec4(front, min(sceneT, 60000.0), 0.0, 1.0);
}
`

// --- the temporal resolve ----------------------------------------------------

// Blends this frame's trace with the last resolved frame, reprojected through
// the cloud front, and clamps the history to the neighbourhood so moving
// views do not smear.
const RESOLVE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 outColor;
uniform sampler2D uRaw;
uniform sampler2D uRawFront;
uniform sampler2D uHistory;
uniform vec2 uTexel;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform mat4 uPrevViewProj;
uniform float uBlend;
void main() {
  vec4 mn = vec4(1e9);
  vec4 mx = vec4(-1e9);
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  vec2 here = texture(uRawFront, vUv).rg;
  float front = here.r;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y)) * uTexel;
      vec4 c = texture(uRaw, vUv + o);
      // only texels that ended on the same surface take part, so the cloud
      // never bleeds across a silhouette
      float sd = texture(uRawFront, vUv + o).g;
      float same = exp(-abs(log(sd / here.g)) * 14.0);
      float w = ((x == 0 && y == 0) ? 4.0 : ((x == 0 || y == 0) ? 2.0 : 1.0)) * same;
      if (same > 0.5) {
        mn = min(mn, c);
        mx = max(mx, c);
      }
      sum += c * w;
      wsum += w;
    }
  }
  vec4 cur = sum / wsum;
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize((uCamWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
  vec3 wp = uCamPos + rd * min(front, 20000.0);
  vec4 pc = uPrevViewProj * vec4(wp, 1.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  float valid = (pc.w > 0.0 && all(greaterThan(puv, vec2(0.0))) && all(lessThan(puv, vec2(1.0)))) ? uBlend : 0.0;
  vec4 hist = clamp(texture(uHistory, puv), mn, mx);
  outColor = mix(cur, hist, valid);
}
`

// --- the composite ------------------------------------------------------------

const COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const COMPOSITE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uCloud;
uniform sampler2D uFront;
uniform sampler2D uSceneDepth;
uniform vec2 uTexel;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform float uMaxFront;
uniform float uMaxScene;
void main() {
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 dir = normalize(v.xyz / v.w);
  // this pixel's own scene distance at full resolution
  float d = texture2D(uSceneDepth, vUv).r;
  float dist = 60000.0;
  if (d < 0.99999) {
    vec4 sp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    dist = min(length(sp.xyz / sp.w), 60000.0);
    if (dist > uMaxScene) dist = 60000.0;
  }
  // depth aware upsample: the four nearest texels, weighted by how well the
  // surface each was traced against matches this pixel
  vec2 size = 1.0 / uTexel;
  vec2 p = vUv * size - 0.5;
  vec2 b = floor(p);
  vec2 f = p - b;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  float bestR = 1e9;
  vec4 bestC = vec4(0.0);
  float bestF = 60000.0;
  float front = 60000.0;
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i - (i / 2) * 2), float(i / 2));
    vec2 uv = (b + o + 0.5) * uTexel;
    vec4 c = texture2D(uCloud, uv);
    vec2 fs = texture2D(uFront, uv).rg;
    float r = abs(log(max(fs.g, 0.01) / max(dist, 0.01)));
    float bil = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
    float w = bil * exp(-r * 14.0);
    sum += c * w;
    wsum += w;
    if (w > 1e-4) front = min(front, fs.r);
    if (r < bestR) { bestR = r; bestC = c; bestF = fs.r; }
  }
  vec4 c = wsum > 1e-3 ? sum / wsum : bestC;
  if (wsum <= 1e-3) front = bestF;
  if (c.a < 0.002) discard;
  // the cloud front still takes part in the depth test, for things the depth
  // pass leaves out (grass)
  vec4 clip = uProj * vec4(dir * min(front, uMaxFront), 1.0);
  gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 0.999999);
  gl_FragColor = c;
}
`

// --- wisps --------------------------------------------------------------------

const WISP_VERT = /* glsl */ `
attribute vec4 wisp; // x: phase, y: width, z: height, w: opacity
varying vec2 vUv;
varying vec3 vWorld;
varying float vAlpha;
varying float vPhase;
varying float vSize;
uniform float uTime;
uniform vec2 uWind;
void main() {
  vUv = uv;
  vec3 centre = (modelMatrix * vec4(position, 1.0)).xyz;
  // big veils drift further and a little faster than the small rim wisps
  float span = max(32.0, wisp.y * 1.4);
  float drift = mod(uTime * (0.3 + wisp.y * 0.006) + wisp.x * span, span) - span * 0.5;
  vec2 wd = normalize(uWind + vec2(1e-4));
  centre.xz += wd * drift;
  vec3 toCam = cameraPosition - centre;
  vec3 fwd = normalize(vec3(toCam.x, 0.0, toCam.z));
  vec3 right = vec3(fwd.z, 0.0, -fwd.x);
  vec3 p = centre + right * (uv.x - 0.5) * wisp.y + vec3(0.0, 1.0, 0.0) * (uv.y - 0.5) * wisp.z;
  vWorld = p;
  // a wisp fades in and out over its drift and never sits in front of the eye
  float life = 1.0 - smoothstep(span * 0.3, span * 0.5, abs(drift));
  float near = smoothstep(6.0, 22.0, length(toCam));
  vAlpha = wisp.w * life * near;
  vPhase = wisp.x;
  vSize = wisp.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`

const WISP_FRAG = /* glsl */ `
precision highp sampler3D;
varying vec2 vUv;
varying vec3 vWorld;
varying float vAlpha;
varying float vPhase;
varying float vSize;
uniform sampler3D uNoise;
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uShadowColor;
${SKY_GLSL}
void main() {
  // streaky along the wind, features sized to the sheet
  float k = 1.35 / vSize;
  vec3 w = vWorld;
  vec3 q = vec3(w.x * 0.92 + w.z * 0.4, w.y * 2.2, w.z * 0.92 - w.x * 0.4) * vec3(k * 0.45, k, k) + vec3(vPhase * 3.7, uTime * 0.004, vPhase);
  float n = texture(uNoise, q).r * 0.6 + texture(uNoise, q * 2.7 + 0.4).g * 0.4;
  vec2 c = (vUv - 0.5) * 2.0;
  float mask = 1.0 - smoothstep(0.2, 1.0, length(c * vec2(1.0, 1.25)));
  float a = smoothstep(0.32, 0.8, n * (0.5 + mask * 0.65)) * mask * vAlpha;
  if (a < 0.003) discard;
  vec3 ray = vWorld - cameraPosition;
  float dist = length(ray);
  vec3 view = ray / dist;
  float fwd = pow(max(dot(view, uSunDir), 0.0), 4.0);
  float ref = dot(skyLookup(normalize(vec3(-uSunDir.x, 0.15, -uSunDir.z))), vec3(0.2126, 0.7152, 0.0722));
  vec3 col = (uSunColor * (0.5 + fwd * 1.4) * mix(0.55, 1.0, n) + uShadowColor * 1.1) * ref;
  // far veils fade into the air like everything else out there
  col = mix(col, hazeColor(view), 1.0 - exp(-dist / 1600.0));
  gl_FragColor = vec4(col * a, a);
}
`

// --- distant islands ------------------------------------------------------------

function displaceUnderside(geo: THREE.BufferGeometry, r: number, depth: number, seed: number): void {
  const pos = geo.attributes.position as THREE.BufferAttribute
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    // y runs from 0 at the top rim to -depth at the tip
    const k = -v.y / depth
    const a = Math.atan2(v.z, v.x)
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const rim = 1 + (fbm2(ca * 1.7 + seed, sa * 1.7 - seed, 3) - 0.5) * 0.35
    // ridged noise for buttresses and gullies, stepped strata down the face
    const n = fbm2(ca * 2.4 + k * 3.0 + seed * 3.1, sa * 2.4 + k * 6.0 + seed, 4)
    const ridge = 1 - Math.abs(n * 2 - 1)
    const strata = Math.sin(k * 26 + fbm2(ca * 3 + seed, sa * 3, 2) * 6) * 0.035
    const kk = Math.min(1, Math.max(0, k + strata))
    const bulge = 1 + Math.sin(Math.min(1, k / 0.18) * Math.PI) * 0.1
    const profile = Math.pow(Math.max(0, 1 - kk), 0.62) * bulge
    const crag = 1 + (ridge - 0.5) * 0.55 * Math.min(1, k * 2.5)
    const radial = r * rim * crag * profile
    const lean = (fbm2(seed * 0.7, k * 2.0, 2) - 0.5) * r * 0.5 * k
    v.x = ca * radial + lean
    v.z = sa * radial
    v.y = -k * depth * (1 + (fbm2(ca * 3 + seed, sa * 3, 2) - 0.5) * 0.3 * k)
    pos.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
}

function buildTop(r: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(r, 40, 0, Math.PI * 2)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const d = Math.hypot(v.x, v.z) / r
    const a = Math.atan2(v.z, v.x)
    const rim = 1 + (fbm2(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7 - seed, 3) - 0.5) * 0.35
    v.x *= rim
    v.z *= rim
    v.y = (1 - d * d) * r * 0.12 + (fbm2(v.x * 0.15 + seed, v.z * 0.15, 3) - 0.5) * r * 0.08
    pos.setXYZ(i, v.x, v.y, v.z)
    const g = fbm2(v.x * 0.2 + seed * 2, v.z * 0.2, 3)
    const edge = Math.max(0, d - 0.8) * 3
    colors[i * 3] = 0.16 + g * 0.06 + edge * 0.08
    colors[i * 3 + 1] = 0.24 + g * 0.08 + edge * 0.02
    colors[i * 3 + 2] = 0.08 + g * 0.03 + edge * 0.03
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

// A black pine read at a distance: a leaning trunk, a few long branches and
// flat irregular cloud pads at their ends, the shape gardeners train them to.
function buildPine(rand: () => number, h: number): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const trunks: THREE.BufferGeometry[] = []
  const pads: THREE.BufferGeometry[] = []
  const lean = (rand() - 0.5) * 0.6
  const top = new THREE.Vector3(-Math.sin(lean) * h, Math.cos(lean) * h, 0)
  const trunk = new THREE.CylinderGeometry(h * 0.025, h * 0.055, h, 6, 1)
  trunk.translate(0, h / 2, 0)
  trunk.rotateZ(lean)
  trunks.push(trunk)
  const up = new THREE.Vector3(0, 1, 0)
  const q = new THREE.Quaternion()
  const addPad = (x: number, y: number, z: number, w: number): void => {
    const pad = new THREE.IcosahedronGeometry(1, 2)
    const pp = pad.attributes.position as THREE.BufferAttribute
    const o = rand() * 10
    for (let i = 0; i < pp.count; i++) {
      const px = pp.getX(i)
      const py = pp.getY(i)
      const pz = pp.getZ(i)
      // lumpy outline and a flat underside
      const lump = 0.75 + fbm2(px * 1.8 + o, pz * 1.8 - o, 2) * 0.55
      pp.setXYZ(i, px * lump, py > 0 ? py * (0.8 + lump * 0.4) : py * 0.35, pz * lump)
    }
    pad.scale(w, w * 0.5, w * (0.7 + rand() * 0.3))
    pad.rotateY(rand() * Math.PI)
    pad.translate(x, y, z)
    pads.push(pad)
  }
  const branches = 4 + Math.floor(rand() * 2)
  for (let b = 0; b < branches; b++) {
    const k = 0.42 + (b / branches) * 0.5
    const base = top.clone().multiplyScalar(k)
    const ang = b * 2.4 + rand() * 0.8
    const reach = h * (0.42 - k * 0.22) * (0.8 + rand() * 0.4)
    const end = new THREE.Vector3(base.x + Math.cos(ang) * reach, base.y + h * (0.02 + rand() * 0.08), base.z + Math.sin(ang) * reach)
    const len = end.distanceTo(base)
    const limb = new THREE.CylinderGeometry(h * 0.012, h * 0.022, len, 4, 1)
    limb.translate(0, len / 2, 0)
    q.setFromUnitVectors(up, end.clone().sub(base).normalize())
    limb.applyQuaternion(q)
    limb.translate(base.x, base.y, base.z)
    trunks.push(limb)
    addPad(end.x, end.y + h * 0.04, end.z, h * (0.3 - k * 0.1) * (0.85 + rand() * 0.3))
  }
  addPad(top.x, top.y, top.z, h * 0.24)
  return { trunk: mergeGeometries(trunks), leaves: mergeGeometries(pads) }
}

// A Japanese cedar read at a distance: a straight trunk and a narrow spire of
// lumpy foliage clumps.
function buildCedar(rand: () => number, h: number): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(h * 0.015, h * 0.03, h * 0.9, 5, 1)
  trunk.translate(0, h * 0.45, 0)
  const clumps: THREE.BufferGeometry[] = []
  const n = 6
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1)
    const c = new THREE.IcosahedronGeometry(1, 1)
    const cp = c.attributes.position as THREE.BufferAttribute
    const o = rand() * 10
    for (let j = 0; j < cp.count; j++) {
      const lump = 0.8 + fbm2(cp.getX(j) * 2 + o, cp.getZ(j) * 2 + cp.getY(j) - o, 2) * 0.45
      cp.setXYZ(j, cp.getX(j) * lump, cp.getY(j) * lump, cp.getZ(j) * lump)
    }
    const w = h * (0.17 - k * 0.12) * (0.85 + rand() * 0.3)
    c.scale(w, h * 0.13, w)
    c.translate((rand() - 0.5) * w * 0.4, h * (0.3 + k * 0.66), (rand() - 0.5) * w * 0.4)
    clumps.push(c)
  }
  const leaves = mergeGeometries(clumps)
  clumps.forEach((g) => g.dispose())
  return { trunk, leaves }
}

// Low shrubs along a rim so the grass edge breaks into a living outline.
function buildRimShrubs(rand: () => number, r: number, count: number, seed: number): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2
    const rim = 1 + (fbm2(Math.cos(a) * 1.7 + seed, Math.sin(a) * 1.7 - seed, 3) - 0.5) * 0.35
    const d = r * rim * (0.82 + rand() * 0.14)
    const g = new THREE.IcosahedronGeometry(1, 1)
    const w = r * (0.06 + rand() * 0.07)
    g.scale(w * (1 + rand() * 0.6), w * 0.6, w)
    g.translate(Math.cos(a) * d, w * 0.15 + r * 0.02, Math.sin(a) * d)
    list.push(g)
  }
  const merged = mergeGeometries(list)
  list.forEach((g) => g.dispose())
  return merged
}

// A distant range: ridged peaks over a broad base whose skirt sinks below the
// cloud tops, so only the crests stand out of the sea.
function buildMassif(r: number, h: number, seed: number, seg: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(r * 2, r * 2, seg, seg)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position as THREE.BufferAttribute
  const turn = seed * 0.37
  const ct = Math.cos(turn)
  const st = Math.sin(turn)
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) / r
    const pz = pos.getZ(i) / r
    // a long range rather than a cone: the spine runs along a turned axis
    const x = px * ct - pz * st
    const z = px * st + pz * ct
    const spine = Math.abs(z + (fbm2(x * 1.3 + seed, seed, 2) - 0.5) * 0.5) / 0.42
    const d = Math.min(1, Math.hypot(x, spine))
    const fall = Math.pow(Math.max(0, 1 - d), 1.3)
    let ridge = 0
    let amp = 0.6
    let f = 1.15
    for (let o = 0; o < 6; o++) {
      // each octave is warped by the last, so ridges branch into spurs
      const n = fbm2(x * f + seed * 1.3 + ridge * 0.6, z * f - seed * 0.7, 1)
      ridge += (1 - Math.abs(n * 2 - 1)) ** 2 * amp
      amp *= 0.5
      f *= 2.2
    }
    // gullies cut down the faces
    const gully = 1 - (1 - Math.abs(fbm2(x * 9 + seed, z * 3, 2) * 2 - 1)) ** 4 * 0.18
    // past the foot the skirt plunges well below the cloud deck, so no flat
    // edge of the grid can show through a thin patch of cloud as a line
    const plunge = Math.max(0, d - 0.85) / 0.15
    pos.setY(i, h * Math.pow(fall, 0.8) * (0.12 + ridge * 1.55) * gully - plunge * plunge * 320)
  }
  geo.computeVertexNormals()
  // rock with darker strata, snow on the gentler upper slopes, dark forest
  // low down where the cloud tops break against the range
  const nor = geo.attributes.normal as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / h
    const ny = nor.getY(i)
    const n = fbm2(pos.getX(i) * 0.01 + seed, pos.getZ(i) * 0.01, 2)
    const strata = 0.82 + 0.2 * Math.sin(y * 26 + n * 5)
    let cr = 0.3 * strata
    let cg = 0.3 * strata
    let cb = 0.33 * strata
    const forest = 1 - Math.min(1, Math.max(0, (y - 0.12) / 0.18))
    cr += (0.09 - cr) * forest
    cg += (0.12 - cg) * forest
    cb += (0.11 - cb) * forest
    const snow = Math.min(1, Math.max(0, (y - 0.78 - n * 0.18) / 0.08)) * Math.min(1, Math.max(0, (ny - 0.45) / 0.2))
    cr += (0.62 - cr) * snow
    cg += (0.64 - cg) * snow
    cb += (0.7 - cb) * snow
    col.set([cr, cg, cb], i * 3)
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

// A torii seen from far away: two posts, the tie beam and the top beam
// with its ends swept up, all vermilion.
function buildTorii(h: number): THREE.BufferGeometry {
  const list: THREE.BufferGeometry[] = []
  for (const side of [-1, 1]) {
    const post = new THREE.CylinderGeometry(h * 0.045, h * 0.055, h, 6, 1)
    post.translate(side * h * 0.42, h / 2, 0)
    list.push(post)
  }
  const tie = new THREE.BoxGeometry(h * 1.0, h * 0.06, h * 0.06)
  tie.translate(0, h * 0.78, 0)
  list.push(tie)
  const top = new THREE.BoxGeometry(h * 1.35, h * 0.08, h * 0.1, 8, 1, 1)
  const tp = top.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i) / (h * 0.675)
    tp.setY(i, tp.getY(i) + x * x * h * 0.07)
  }
  top.translate(0, h * 0.97, 0)
  list.push(top)
  const merged = mergeGeometries(list)
  list.forEach((g) => g.dispose())
  return merged
}

// A small hall with a curved hip roof, only ever seen as a silhouette.
function buildShrine(s: number): { body: THREE.BufferGeometry; roof: THREE.BufferGeometry } {
  const body = new THREE.BoxGeometry(s, s * 0.55, s * 0.8)
  body.translate(0, s * 0.275, 0)
  const roof = new THREE.BoxGeometry(s * 1.5, s * 0.5, s * 1.25, 6, 1, 6)
  const pos = roof.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    if (y > 0) {
      // the top shrinks to a ridge
      pos.setXYZ(i, x * 0.55, y, z * 0.08)
    } else {
      // the eaves sweep up at the corners
      const cx = Math.abs(x) / (s * 0.75)
      const cz = Math.abs(z) / (s * 0.625)
      pos.setY(i, y + Math.pow(Math.max(cx, cz), 3) * s * 0.12)
    }
  }
  roof.translate(0, s * 0.55 + s * 0.25, 0)
  roof.computeVertexNormals()
  return { body, roof }
}

// distance: the air's fade length in metres, or omitted to read it per
// vertex from an `aerial` attribute (one material for near and far things)
function patchAerial(mat: THREE.MeshStandardMaterial, key: string, skyUniforms: Record<string, THREE.IUniform>, distance?: number): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, skyUniforms)
    const perVertex = distance === undefined
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vAerialWorld;
varying float vAerialLength;
${perVertex ? 'attribute float aerial;' : ''}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vAerialWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
vAerialLength = ${perVertex ? 'aerial' : distance.toFixed(1)};`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vAerialWorld;
varying float vAerialLength;
${SKY_GLSL}`)
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        vec3 aerialRay = vAerialWorld - cameraPosition;
        float aerialDist = length(aerialRay);
        float aerial = 1.0 - exp(-aerialDist / vAerialLength);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor(aerialRay / aerialDist), aerial);`,
      )
  }
  mat.customProgramCacheKey = () => key
}

// --- the part -----------------------------------------------------------------

export class Skyscape implements RealmPart {
  readonly object = new THREE.Group()

  private readonly settings: TierSettings
  private readonly noise: THREE.Data3DTexture
  private readonly noiseData = new Uint8Array(NOISE_SIZE * NOISE_SIZE * NOISE_SIZE * 2)
  private noiseTables: NoiseTables | null = null
  private noiseSlice = 0
  private readonly fallbackSky: THREE.DataTexture
  private readonly skyUniforms: {
    uSkyTex: THREE.IUniform<THREE.Texture>
    uSkyMode: THREE.IUniform<number>
    uSkyK: THREE.IUniform<number>
    uSkyYaw: THREE.IUniform<number>
    uSunDir: THREE.IUniform<THREE.Vector3>
  }

  private readonly depthTarget: THREE.WebGLRenderTarget
  private readonly cloudTarget: THREE.WebGLRenderTarget
  private historyRead: THREE.WebGLRenderTarget
  private historyWrite: THREE.WebGLRenderTarget
  private readonly resolveMaterial: THREE.RawShaderMaterial
  private readonly resolveScene = new THREE.Scene()
  private readonly prevViewProj = new THREE.Matrix4()
  private frameIndex = 0
  private historyValid = false
  private readonly depthMaterial = new THREE.MeshBasicMaterial({ colorWrite: false })
  private readonly depthCamera = new THREE.PerspectiveCamera()
  private readonly proxyGeometry = new THREE.PlaneGeometry(1, 1)
  private tagCountdown = 0
  private readonly tagVisitor = (o: THREE.Object3D): void => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh) return
    if (o.layers.isEnabled(DEPTH_LAYER)) return
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    if (!mat || mat.transparent || !mat.depthWrite) return
    // meshes whose shaders move their vertices would land in the copy at the
    // wrong place, a hard edge in the clouds; the main pass's depth test
    // covers them instead
    if ((mat as THREE.ShaderMaterial).isShaderMaterial || mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return
    const geo = mesh.geometry
    if (!geo.boundingSphere) geo.computeBoundingSphere()
    const r = (geo.boundingSphere?.radius ?? 0) * mesh.matrixWorld.getMaxScaleOnAxis()
    if (r >= DEPTH_MIN_RADIUS) o.layers.enable(DEPTH_LAYER)
  }
  private readonly marchMaterial: THREE.RawShaderMaterial
  private readonly marchScene = new THREE.Scene()
  private readonly marchCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.BufferGeometry
  private readonly composite: THREE.Mesh
  private readonly compositeMaterial: THREE.ShaderMaterial
  private readonly wisps: THREE.Mesh
  private readonly wispMaterial: THREE.ShaderMaterial
  private readonly wispGeometry: THREE.BufferGeometry

  private readonly islandGeometries: THREE.BufferGeometry[] = []
  private readonly islandMaterials: THREE.Material[] = []
  private readonly cliffMaterial: THREE.MeshStandardMaterial
  private disposed = false
  private readonly placeholders: THREE.Texture[] = []

  private readonly size = new THREE.Vector2()
  private readonly drift = new THREE.Vector2()
  private readonly clearColor = new THREE.Color()

  constructor(opts: { tier: Tier }) {
    this.depthCamera.layers.set(DEPTH_LAYER)
    this.depthCamera.matrixWorldAutoUpdate = false
    this.settings = TIERS[opts.tier]
    this.noise = noiseTexture(this.noiseData)

    // a one texel stand in until the host's sky is seen
    this.fallbackSky = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    this.fallbackSky.needsUpdate = true
    this.skyUniforms = {
      uSkyTex: { value: this.fallbackSky },
      uSkyMode: { value: 0 },
      uSkyK: { value: 1 },
      uSkyYaw: { value: 0 },
      uSunDir: { value: SUN_DIRECTION },
    }

    this.depthTarget = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true })
    this.depthTarget.depthTexture = new THREE.DepthTexture(4, 4, THREE.UnsignedIntType)
    this.depthTarget.depthTexture.minFilter = THREE.NearestFilter
    this.depthTarget.depthTexture.magFilter = THREE.NearestFilter
    this.cloudTarget = new THREE.WebGLRenderTarget(4, 4, {
      count: 2,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    })
    const historyOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
    this.historyRead = new THREE.WebGLRenderTarget(4, 4, historyOpts)
    this.historyWrite = new THREE.WebGLRenderTarget(4, 4, historyOpts)
    const front = this.cloudTarget.textures[1]
    if (front) {
      front.minFilter = THREE.NearestFilter
      front.magFilter = THREE.NearestFilter
    }

    const sunColor = new THREE.Color(1.0, 0.64, 0.23).multiplyScalar(3.2)
    const shadowColor = new THREE.Color(0.29, 0.3, 0.66).multiplyScalar(0.78)
    const towers = TOWERS.map(([x, z, r, h]) => new THREE.Vector4(x, z, r, h))
    const bounds = TOWERS.map(([x, z, r, h]) => new THREE.Vector4(x, -55 + h * 0.4, z, r * 1.45))

    this.quad = new THREE.BufferGeometry()
    this.quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3))

    const s = this.settings
    this.marchMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: MARCH_VERT,
      fragmentShader: MARCH_FRAG,
      uniforms: {
        ...this.skyUniforms,
        uNoise: { value: this.noise },
        uDepth: { value: this.depthTarget.depthTexture },
        uTexel: { value: new THREE.Vector2() },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uTime: realmUniforms.uTime,
        uDrift: { value: this.drift },
        uSunColor: { value: sunColor },
        uShadowColor: { value: shadowColor },
        uTowers: { value: towers },
        uTowerBounds: { value: bounds },
        uMaxScene: { value: 1e6 },
        uFrame: { value: 0 },
        uSteps: { value: s.steps },
        uTowerSteps: { value: s.towerSteps },
        uLightSteps: { value: s.lightSteps },
        uPixelAngle: { value: 0.002 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.resolveMaterial = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: MARCH_VERT,
      fragmentShader: RESOLVE_FRAG,
      uniforms: {
        uRaw: { value: this.cloudTarget.textures[0] },
        uRawFront: { value: this.cloudTarget.textures[1] },
        uHistory: { value: this.historyRead.texture },
        uTexel: this.marchMaterial.uniforms.uTexel as THREE.IUniform,
        uInvProj: this.marchMaterial.uniforms.uInvProj as THREE.IUniform,
        uCamWorld: this.marchMaterial.uniforms.uCamWorld as THREE.IUniform,
        uCamPos: this.marchMaterial.uniforms.uCamPos as THREE.IUniform,
        uPrevViewProj: { value: this.prevViewProj },
        uBlend: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    const resolveMesh = new THREE.Mesh(this.quad, this.resolveMaterial)
    resolveMesh.frustumCulled = false
    this.resolveScene.add(resolveMesh)
    const marchMesh = new THREE.Mesh(this.quad, this.marchMaterial)
    marchMesh.frustumCulled = false
    this.marchScene.add(marchMesh)

    // The offscreen passes draw with materials the host never sees. Proxies
    // on a layer no camera renders carry them into the host's parallel
    // compile of this part, so they do not compile one by one, blocking, on
    // the first frame.
    for (const m of [this.marchMaterial, this.resolveMaterial, this.depthMaterial]) {
      const proxy = new THREE.Mesh(this.proxyGeometry, m)
      proxy.layers.set(30)
      proxy.frustumCulled = false
      this.object.add(proxy)
    }

    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: COMPOSITE_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        uCloud: { value: this.historyWrite.texture },
        uFront: { value: this.cloudTarget.textures[1] },
        uTexel: this.marchMaterial.uniforms.uTexel as THREE.IUniform,
        uInvProj: { value: new THREE.Matrix4() },
        uProj: { value: new THREE.Matrix4() },
        uMaxFront: { value: 1e6 },
        uMaxScene: { value: 1e6 },
        uSceneDepth: { value: this.depthTarget.depthTexture },
      },
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    })
    this.composite = new THREE.Mesh(this.quad, this.compositeMaterial)
    this.composite.frustumCulled = false
    // first among the transparent things, after every opaque one
    this.composite.renderOrder = -10
    this.object.add(this.composite)

    // wisps: a few soft sheets drifting past below and beside the rim
    const spots: [number, number, number, number, number][] = [
      // x, y, z, width, opacity
      [27, -8, -4, 30, 0.5],
      [-28, -11, 6, 34, 0.45],
      [24, -15, 20, 26, 0.4],
      [-22, -6, -24, 24, 0.36],
      [30, -4, -26, 28, 0.34],
      [-30, -17, -10, 38, 0.42],
      // veils further out at different heights; some cross in front of the
      // far islands
      [-75, 62, -300, 170, 0.42],
      [90, 22, -240, 120, 0.38],
      [70, -2, 200, 140, 0.45],
      [150, 26, 430, 210, 0.38],
      [-30, -14, 160, 110, 0.42],
      [180, 14, -150, 130, 0.4],
      [330, 42, -310, 190, 0.34],
      [-90, -12, -120, 120, 0.42],
      [60, -22, -70, 90, 0.42],
      [-210, 30, 80, 160, 0.38],
      [250, -6, 40, 140, 0.4],
      [-320, 55, -180, 220, 0.32],
    ]
    const quads: THREE.BufferGeometry[] = []
    spots.forEach(([x, y, z, w, a], i) => {
      const g = new THREE.PlaneGeometry(1, 1)
      const pos = g.attributes.position as THREE.BufferAttribute
      for (let j = 0; j < pos.count; j++) pos.setXYZ(j, x, y, z)
      const attr = new Float32Array(pos.count * 4)
      for (let j = 0; j < pos.count; j++) attr.set([i * 0.173 + 0.05, w, w * (w > 60 ? 0.22 : 0.32), a], j * 4)
      g.setAttribute('wisp', new THREE.BufferAttribute(attr, 4))
      g.deleteAttribute('normal')
      quads.push(g)
    })
    this.wispGeometry = mergeGeometries(quads)
    quads.forEach((g) => g.dispose())
    this.wispMaterial = new THREE.ShaderMaterial({
      vertexShader: WISP_VERT,
      fragmentShader: WISP_FRAG,
      uniforms: {
        ...this.skyUniforms,
        uNoise: { value: this.noise },
        uTime: realmUniforms.uTime,
        uWind: realmUniforms.uWind,
        uSunColor: { value: sunColor },
        uShadowColor: { value: shadowColor },
      },
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    })
    this.wisps = new THREE.Mesh(this.wispGeometry, this.wispMaterial)
    this.wisps.frustumCulled = false
    this.wisps.renderOrder = -5
    this.object.add(this.wisps)

    // distant islands: the scanned cliff, and one vertex coloured material for
    // grass, foliage, wood, roofs and the far ranges, so they cost two
    // programs between them
    // one texel stand ins until the scanned set arrives, so swapping in the
    // real maps changes no program
    const texel = (r: number, g: number, b: number, srgb: boolean): THREE.DataTexture => {
      const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      t.needsUpdate = true
      this.placeholders.push(t)
      return t
    }
    const arm = texel(255, 242, 0, false)
    this.cliffMaterial = new THREE.MeshStandardMaterial({
      color: 0x6d6258,
      roughness: 1,
      map: texel(255, 255, 255, true),
      normalMap: texel(128, 128, 255, false),
      aoMap: arm,
      roughnessMap: arm,
    })
    patchAerial(this.cliffMaterial, 'skyscape-far-cliff', this.skyUniforms)
    const plainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 })
    patchAerial(plainMaterial, 'skyscape-far-plain', this.skyUniforms)
    this.islandMaterials.push(this.cliffMaterial, plainMaterial)
    // per part: colour (null keeps the vertex colours) and fade length
    const looks: [number | null, number][] = [
      [null, 1300], // cliff, unused here
      [null, 1300], // grass
      [0x1f3320, 1300], // foliage
      [0x5a2c1e, 1300], // wood
      [0x2a2a2e, 1300], // roofs
      [null, 2300], // the far ranges, coloured per vertex: much longer air to the eye
    ]
    const tint = new THREE.Color()

    // phones get the far shapes at lower density; they are small on screen
    const lowPoly = opts.tier === 'phone'
    const parts: THREE.BufferGeometry[][] = [[], [], [], [], []]
    for (const isl of FAR_ISLANDS) {
      const marks = parts.map((l) => l.length)
      const rand = rng(isl.seed)
      const depth = isl.r * (1.5 + rand() * 0.8)
      const under = new THREE.CylinderGeometry(1, 0.02, depth, lowPoly ? 32 : 48, lowPoly ? 14 : 24, true)
      under.translate(0, -depth / 2, 0)
      displaceUnderside(under, isl.r, depth, isl.seed)
      // planar uvs scaled to metres so the rock grain reads at the right size
      const pos = under.attributes.position as THREE.BufferAttribute
      const uv = under.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < pos.count; i++) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i))
        uv.setXY(i, (a / (Math.PI * 2)) * isl.r * 0.6, pos.getY(i) * 0.1)
      }
      under.translate(isl.x, isl.y + 0.2, isl.z)
      parts[0]?.push(under)
      // smaller crags hang beside the main one so the underside is never a cone
      const lobes = 2 + Math.floor(rand() * 2)
      for (let l = 0; l < lobes; l++) {
        const lr = isl.r * (0.4 + rand() * 0.2)
        const ld = depth * (0.45 + rand() * 0.35)
        const lobe = new THREE.CylinderGeometry(1, 0.02, ld, lowPoly ? 16 : 24, lowPoly ? 8 : 12, true)
        lobe.translate(0, -ld / 2, 0)
        displaceUnderside(lobe, lr, ld, isl.seed + l * 7 + 3)
        const la = rand() * Math.PI * 2
        const lo = isl.r * (0.25 + rand() * 0.25)
        lobe.translate(isl.x + Math.cos(la) * lo, isl.y - depth * 0.04, isl.z + Math.sin(la) * lo)
        parts[0]?.push(lobe)
      }
      const top = buildTop(isl.r * 1.02, isl.seed)
      top.translate(isl.x, isl.y, isl.z)
      parts[1]?.push(top)
      const ground = isl.y + isl.r * 0.06
      const plant = (tree: { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry }, x: number, z: number): void => {
        tree.trunk.translate(x, ground, z)
        tree.leaves.translate(x, ground, z)
        parts[3]?.push(tree.trunk)
        parts[2]?.push(tree.leaves)
      }
      const shrubs = buildRimShrubs(rand, isl.r, Math.round(isl.r * 1.2), isl.seed)
      shrubs.translate(isl.x, isl.y, isl.z)
      parts[2]?.push(shrubs)
      if (isl.crown === 'grove') {
        // a leaning pine near the edge and a stand of cedars behind it
        plant(buildPine(rand, isl.r * (0.75 + rand() * 0.2)), isl.x + isl.r * 0.45, isl.z + isl.r * 0.1)
        const cedars = isl.r > 20 ? 7 : 4
        for (let k = 0; k < cedars; k++) {
          const a = rand() * Math.PI * 2
          const d = isl.r * (0.1 + rand() * 0.45)
          plant(buildCedar(rand, isl.r * (0.7 + rand() * 0.5)), isl.x + Math.cos(a) * d - isl.r * 0.15, isl.z + Math.sin(a) * d)
        }
        if (isl.r > 20) plant(buildPine(rand, isl.r * 0.6), isl.x - isl.r * 0.55, isl.z + isl.r * 0.3)
      } else if (isl.crown === 'torii') {
        // a leaning pine near the edge, a gate and two cedars behind
        plant(buildPine(rand, isl.r * 0.9), isl.x - isl.r * 0.3, isl.z + isl.r * 0.15)
        const gate = buildTorii(isl.r * 0.45)
        gate.rotateY(-0.5)
        gate.translate(isl.x + isl.r * 0.25, ground, isl.z - isl.r * 0.1)
        // its own vermilion, carried with the grass, which keeps vertex colours
        const red = new THREE.Color(0xb23a22)
        const gc = new Float32Array(gate.attributes.position!.count * 3)
        for (let k = 0; k < gc.length; k += 3) gc.set([red.r, red.g, red.b], k)
        gate.setAttribute('color', new THREE.BufferAttribute(gc, 3))
        parts[1]?.push(gate)
        plant(buildCedar(rand, isl.r * 0.75), isl.x + isl.r * 0.05, isl.z + isl.r * 0.45)
        plant(buildCedar(rand, isl.r * 0.6), isl.x + isl.r * 0.4, isl.z + isl.r * 0.35)
      } else if (isl.crown === 'pine') {
        plant(buildPine(rand, isl.r * (0.8 + rand() * 0.3)), isl.x + (rand() - 0.5) * isl.r * 0.6, isl.z + (rand() - 0.5) * isl.r * 0.6)
        plant(buildCedar(rand, isl.r * 0.7), isl.x - isl.r * 0.35, isl.z - isl.r * 0.2)
      } else {
        const sh = buildShrine(isl.r * 0.28)
        sh.body.rotateY(0.6)
        sh.roof.rotateY(0.6)
        sh.body.translate(isl.x + isl.r * 0.15, isl.y + isl.r * 0.1, isl.z)
        sh.roof.translate(isl.x + isl.r * 0.15, isl.y + isl.r * 0.1, isl.z)
        parts[3]?.push(sh.body)
        parts[4]?.push(sh.roof)
        plant(buildPine(rand, isl.r * 0.55), isl.x - isl.r * 0.4, isl.z + isl.r * 0.2)
        plant(buildCedar(rand, isl.r * 0.6), isl.x - isl.r * 0.1, isl.z - isl.r * 0.4)
        plant(buildCedar(rand, isl.r * 0.5), isl.x + isl.r * 0.1, isl.z - isl.r * 0.45)
      }
      // the air between the eye and this island, read per vertex
      parts.forEach((l, k) => {
        for (let m = marks[k] ?? 0; m < l.length; m++) l[m]!.userData.air = isl.air ?? 1300
      })
    }
    // the far ranges
    const ranges: THREE.BufferGeometry[] = []
    MASSIFS.forEach(([x, z, r, h, y], k) => {
      const g = buildMassif(r, h, 101 + k * 17, lowPoly ? 56 : 96)
      g.translate(x, y, z)
      ranges.push(g)
    })
    parts.push(ranges)
    const plainParts: THREE.BufferGeometry[] = []
    parts.forEach((list, i) => {
      if (list.length === 0) return
      const [hex, fadeLength] = looks[i] ?? [null, 1300]
      if (hex !== null) tint.set(hex)
      const cleaned = list.map((g) => {
        const air = (g.userData.air as number | undefined) ?? fadeLength
        const ng = g.index ? g.toNonIndexed() : g
        if (ng !== g) g.dispose()
        for (const name of Object.keys(ng.attributes)) {
          if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') ng.deleteAttribute(name)
        }
        const n = ng.attributes.position!.count
        if (!ng.attributes.color || hex !== null) {
          const c = new Float32Array(n * 3)
          for (let k = 0; k < n; k++) c.set(hex !== null ? [tint.r, tint.g, tint.b] : [1, 1, 1], k * 3)
          ng.setAttribute('color', new THREE.BufferAttribute(c, 3))
        }
        if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
        ng.setAttribute('aerial', new THREE.BufferAttribute(new Float32Array(n).fill(air), 1))
        return ng
      })
      if (i === 0) {
        const merged = mergeGeometries(cleaned)
        cleaned.forEach((g) => g.dispose())
        this.addFar(merged, this.cliffMaterial, true)
      } else if (i === 5) {
        // the ranges stay out of the depth copy: the cloud deck is traced
        // through them and the main pass's depth test settles the overlap, so
        // their long low silhouettes never cut the clouds at the trace's
        // coarse resolution
        const merged = mergeGeometries(cleaned)
        cleaned.forEach((g) => g.dispose())
        this.addFar(merged, plainMaterial, false)
      } else {
        plainParts.push(...cleaned)
      }
    })
    const plain = mergeGeometries(plainParts)
    plainParts.forEach((g) => g.dispose())
    this.addFar(plain, plainMaterial, true)

    loadPbr('cliff', opts.tier)
      .then((set) => {
        if (this.disposed) return
        const scanned = pbrMaterial(set, { color: 0xb8aca0 })
        this.cliffMaterial.map = scanned.map
        this.cliffMaterial.normalMap = scanned.normalMap
        this.cliffMaterial.aoMap = scanned.aoMap
        this.cliffMaterial.roughnessMap = scanned.roughnessMap
        this.cliffMaterial.color.set(0xb8aca0)
        scanned.dispose()
      })
      .catch(() => {
        // the plain rock colour stays until the scanned set exists
      })
  }

  private addFar(geo: THREE.BufferGeometry, mat: THREE.Material, depth: boolean): void {
    this.islandGeometries.push(geo)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    // the clouds stop at the far islands, so they go into the depth copy
    if (depth) mesh.layers.enable(DEPTH_LAYER)
    this.object.add(mesh)
  }

  // Hands over the host's sky so the haze matches it. Pass the cropped
  // panorama with its bg.json k and the yaw the host turns it by (radians
  // about +y, applied to view directions before the lookup), or an equirect
  // texture in the three.js convention without options.
  setSky(texture: THREE.Texture | null, panorama?: { k: number; yaw: number }): void {
    this.skyUniforms.uSkyTex.value = texture ?? this.fallbackSky
    this.skyUniforms.uSkyMode.value = texture ? (panorama ? 2 : 1) : 0
    this.skyUniforms.uSkyK.value = panorama?.k ?? 1
    this.skyUniforms.uSkyYaw.value = panorama?.yaw ?? 0
  }

  update(frame: Frame): void {
    // fill the noise volume a few slices at a time, a few milliseconds per
    // frame, and upload it once it is whole
    if (this.noiseSlice < NOISE_SIZE) {
      const t0 = performance.now()
      if (!this.noiseTables) this.noiseTables = noiseTables()
      while (this.noiseSlice < NOISE_SIZE && performance.now() - t0 < 4) {
        fillNoiseSlice(this.noiseData, this.noiseSlice++, this.noiseTables)
      }
      if (this.noiseSlice === NOISE_SIZE) {
        this.noise.needsUpdate = true
        this.noiseTables = null
      }
    }
    // the sea drifts slowly with the wind
    const w = realmUniforms.uWind.value
    this.drift.x += w.x * frame.dt * 2.6 * frame.motion
    this.drift.y += w.y * frame.dt * 2.6 * frame.motion
  }

  prerender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const bg = scene.background
    if (bg && (bg as THREE.Texture).isTexture && (bg as THREE.Texture).mapping === THREE.EquirectangularReflectionMapping) {
      if (this.skyUniforms.uSkyMode.value === 0) this.setSky(bg as THREE.Texture)
    }

    renderer.getDrawingBufferSize(this.size)
    const w = Math.max(16, Math.round(this.size.x * this.settings.scale))
    const h = Math.max(16, Math.round(this.size.y * this.settings.scale))
    if (this.cloudTarget.width !== w || this.cloudTarget.height !== h) {
      this.cloudTarget.setSize(w, h)
      this.historyRead.setSize(w, h)
      this.historyWrite.setSize(w, h)
      this.historyValid = false
    }
    ;(this.marchMaterial.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h)
    this.marchMaterial.uniforms.uPixelAngle!.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / (h * camera.zoom)
    // the depth pass runs at full resolution so the upsample can match
    // every screen pixel against its own surface; phones use half, read with
    // nearest filtering, since a full extra scene draw costs too much there
    const dw = Math.max(16, Math.round(this.size.x * this.settings.depthScale))
    const dh = Math.max(16, Math.round(this.size.y * this.settings.depthScale))
    if (this.depthTarget.width !== dw || this.depthTarget.height !== dh) {
      this.depthTarget.setSize(dw, dh)
    }

    camera.updateMatrixWorld()
    const u = this.marchMaterial.uniforms
    ;(u.uInvProj!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
    ;(u.uCamWorld!.value as THREE.Matrix4).copy(camera.matrixWorld)
    ;(u.uCamPos!.value as THREE.Vector3).setFromMatrixPosition(camera.matrixWorld)
    ;(this.compositeMaterial.uniforms.uInvProj!.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
    ;(this.compositeMaterial.uniforms.uProj!.value as THREE.Matrix4).copy(camera.projectionMatrix)
    // clouds stay in front of a sky mesh drawn near the far plane
    u.uMaxScene!.value = camera.far * 0.95
    this.compositeMaterial.uniforms.uMaxFront!.value = camera.far * 0.8
    this.compositeMaterial.uniforms.uMaxScene!.value = camera.far * 0.95

    const prevTarget = renderer.getRenderTarget()
    const prevAutoClear = renderer.autoClear
    const prevBackground = scene.background
    const prevOverride = scene.overrideMaterial
    // tag new large meshes for the depth copy now and then; parts arrive
    // over the first seconds
    if (this.tagCountdown-- <= 0) {
      scene.traverse(this.tagVisitor)
      this.tagCountdown = 90
    }
    const dc = this.depthCamera
    dc.matrixWorld.copy(camera.matrixWorld)
    dc.matrixWorldInverse.copy(camera.matrixWorldInverse)
    dc.projectionMatrix.copy(camera.projectionMatrix)
    dc.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
    dc.near = camera.near
    dc.far = camera.far
    const sm = renderer.shadowMap
    const prevAuto = sm.autoUpdate
    const prevNeeds = sm.needsUpdate
    renderer.getClearColor(this.clearColor)
    const prevAlpha = renderer.getClearAlpha()

    // depth of the large opaque meshes
    scene.background = null
    scene.overrideMaterial = this.depthMaterial
    sm.autoUpdate = false
    sm.needsUpdate = false
    renderer.autoClear = true
    renderer.setRenderTarget(this.depthTarget)
    renderer.render(scene, dc)
    scene.overrideMaterial = prevOverride
    scene.background = prevBackground
    sm.autoUpdate = prevAuto
    sm.needsUpdate = prevNeeds

    renderer.setRenderTarget(this.cloudTarget)
    renderer.setClearColor(0x000000, 0)
    u.uFrame!.value = this.frameIndex++
    renderer.render(this.marchScene, this.marchCamera)

    // resolve into the write history, then swap so the composite reads it
    const ru = this.resolveMaterial.uniforms
    ru.uHistory!.value = this.historyRead.texture
    ru.uBlend!.value = this.historyValid ? 0.88 : 0
    renderer.setRenderTarget(this.historyWrite)
    renderer.render(this.resolveScene, this.marchCamera)
    this.compositeMaterial.uniforms.uCloud!.value = this.historyWrite.texture
    const swap = this.historyRead
    this.historyRead = this.historyWrite
    this.historyWrite = swap
    this.historyValid = true
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

    renderer.setClearColor(this.clearColor, prevAlpha)
    renderer.autoClear = prevAutoClear
    renderer.setRenderTarget(prevTarget)
  }

  dispose(): void {
    this.disposed = true
    this.noise.dispose()
    this.fallbackSky.dispose()
    this.depthTarget.depthTexture?.dispose()
    this.depthTarget.dispose()
    this.cloudTarget.dispose()
    this.historyRead.dispose()
    this.historyWrite.dispose()
    this.resolveMaterial.dispose()
    this.depthMaterial.dispose()
    this.marchMaterial.dispose()
    this.compositeMaterial.dispose()
    this.quad.dispose()
    this.wispGeometry.dispose()
    this.wispMaterial.dispose()
    for (const g of this.islandGeometries) g.dispose()
    for (const m of this.islandMaterials) m.dispose()
    for (const t of this.placeholders) t.dispose()
    this.proxyGeometry.dispose()
  }
}
