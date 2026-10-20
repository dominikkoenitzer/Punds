import * as THREE from 'three'
import { SUN_DIRECTION, realmUniforms, sceneSize } from './atmosphere'
import { OUTFLOW, POND_BOUNDS, POND_LEVEL, groundHeight, islandSdf, noise2, pondSdf, rng } from './layout'
import type { Frame, RealmPart, Tier } from './types'

// The koi pond: the water surface with its planar reflection and ripple
// simulation, the koi and the outflow channel that spills off the island. The host's terrain draws the bed; everything wet is here.

const BW = POND_BOUNDS.xMax - POND_BOUNDS.xMin
const BH = POND_BOUNDS.zMax - POND_BOUNDS.zMin
const SUN_RADIANCE = new THREE.Vector3(1.0, 0.82, 0.62).multiplyScalar(3.0)
const SKY_RADIANCE = new THREE.Vector3(0.42, 0.52, 0.68).multiplyScalar(0.55)
const MAX_DROPS = 12

// The koi keep to the open water, out of the channel.
function koiSdf(x: number, z: number): number {
  return Math.max(pondSdf(x, z), -12.2 - x)
}

const OUT_DIR = new THREE.Vector2(OUTFLOW.x1 - OUTFLOW.x0, OUTFLOW.z1 - OUTFLOW.z0)
const OUT_LEN = OUT_DIR.length()
OUT_DIR.divideScalar(OUT_LEN)

// where the channel meets the rim
function findLip(): THREE.Vector3 {
  let t = 0
  for (; t < 2; t += 0.005) {
    if (islandSdf(OUTFLOW.x0 + OUT_DIR.x * OUT_LEN * t, OUTFLOW.z0 + OUT_DIR.y * OUT_LEN * t) <= 0) break
  }
  return new THREE.Vector3(OUTFLOW.x0 + OUT_DIR.x * OUT_LEN * t, POND_LEVEL - 0.07, OUTFLOW.z0 + OUT_DIR.y * OUT_LEN * t)
}

const NOISE_GLSL = /* glsl */ `
float pHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// value noise and its gradient
vec3 pNoised(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = pHash(i);
  float b = pHash(i + vec2(1.0, 0.0));
  float c = pHash(i + vec2(0.0, 1.0));
  float d = pHash(i + vec2(1.0, 1.0));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
              du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}
float pNoise(vec2 x) { return pNoised(x).x; }
float pFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * pNoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
`

// --- the ripple simulation ---------------------------------------------------

const SIM_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const SIM_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uState;
uniform sampler2D uShape;
uniform vec2 uTexel;
uniform vec4 uBounds;
uniform vec4 uDrops[${MAX_DROPS}];
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uState, vUv);
  float l = texture2D(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float r = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float d = texture2D(uState, vUv - vec2(0.0, uTexel.y)).r;
  float u = texture2D(uState, vUv + vec2(0.0, uTexel.y)).r;
  // the wave equation with a slow wave speed, so rings spread at the pace of
  // real ripples on still water
  float lap = l + r + d + u - 4.0 * c.r;
  float h = (2.0 * c.r - c.g + 0.16 * lap) * 0.988;
  vec2 world = uBounds.xy + vUv * uBounds.zw;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec4 drop = uDrops[i];
    vec2 dd = world - drop.xy;
    h += drop.w * exp(-dot(dd, dd) / (drop.z * drop.z));
  }
  // the shore reflects the waves
  float sdf = texture2D(uShape, vUv).g * 3.0 - 1.0;
  h *= 1.0 - smoothstep(-0.05, 0.05, sdf);
  gl_FragColor = vec4(h, c.r, 0.0, 1.0);
}
`

// --- the water surface -----------------------------------------------------

const WATER_VERT = /* glsl */ `
uniform vec4 uBounds;
uniform vec4 uOutflow;
uniform float uOutHalf;
uniform vec2 uLip;
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vChan; // distance along the channel 0..1 (past 1 at the lip), across distance
void main() {
  vec3 p = position;
  vec2 a = uOutflow.xy;
  vec2 b = uLip;
  vec2 ab = b - a;
  float t = dot(p.xz - a, ab) / dot(ab, ab);
  vec2 q = a + ab * clamp(t, 0.0, 1.0);
  float across = length(p.xz - q);
  vChan = vec2(t, across);
  // the channel water speeds up and drops a little towards the lip
  float inChan = 1.0 - smoothstep(uOutHalf, uOutHalf + 0.6, across);
  p.y -= 0.06 * smoothstep(0.55, 1.0, t) * inChan;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vUv = (world.xz - uBounds.xy) / uBounds.zw;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const WATER_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uShape;
uniform sampler2D uSim;
uniform sampler2D uKoiDepth;
uniform sampler2D uReflection;
uniform mat4 uReflMatrix;
uniform vec2 uReflTexel;
uniform float uReflBlur;
uniform vec2 uSimTexel;
uniform vec4 uBounds;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uSkyColor;
uniform vec3 uShallow;
uniform vec3 uDeep;
uniform float uOutHalf;
uniform vec4 uOutflow;
uniform vec2 uLip;
uniform float uTime;
uniform vec2 uWind;
uniform float uGust;
varying vec3 vWorld;
varying vec2 vUv;
varying vec2 vChan;
${NOISE_GLSL}

float simH(vec2 uv) { return texture2D(uSim, uv).r; }

vec2 detailGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  g += pNoised(p * 1.7 + vec2(t * 0.11, t * 0.07)).yz * 0.5;
  g += pNoised(p * 3.9 - vec2(t * 0.09, -t * 0.13)).yz * 0.28;
  g += pNoised(p * 9.1 + vec2(-t * 0.21, t * 0.17)).yz * 0.14;
  return g;
}

void main() {
  vec4 shape = texture2D(uShape, vUv);
  float bed = shape.r * 1.5;
  float sdf = shape.g * 3.0 - 1.0;
  float rim = shape.b * 3.0 - 1.0;
  if (sdf > 0.12 || rim < -0.02) discard;

  vec3 toEye = cameraPosition - vWorld;
  float dist = length(toEye);
  vec3 V = toEye / dist;

  // channel flow: scrolling detail that runs to the lip and speeds up
  float inChan = (1.0 - smoothstep(uOutHalf - 0.1, uOutHalf + 0.5, vChan.y)) * smoothstep(-0.05, 0.12, vChan.x);
  float flowT = clamp(vChan.x, 0.0, 1.2);
  float speed = 0.35 + 1.6 * flowT * flowT;
  vec2 chanDir = normalize(uLip - uOutflow.xy);
  vec2 chanSide = vec2(-chanDir.y, chanDir.x);
  vec2 local = vec2(dot(vWorld.xz - uOutflow.xy, chanDir), dot(vWorld.xz - uOutflow.xy, chanSide));

  // ripples from the simulation
  float hl = simH(vUv - vec2(uSimTexel.x, 0.0));
  float hr = simH(vUv + vec2(uSimTexel.x, 0.0));
  float hd = simH(vUv - vec2(0.0, uSimTexel.y));
  float hu = simH(vUv + vec2(0.0, uSimTexel.y));
  vec2 texelWorld = uSimTexel * uBounds.zw;
  vec2 simGrad = vec2(hr - hl, hu - hd) / (2.0 * texelWorld);

  // A still pond: a slow broad swell everywhere, fine ripples only inside
  // the cat's-paws the wind pushes across the surface.
  vec2 windDir = normalize(uWind + vec2(1e-4));
  vec2 broad = pNoised(vWorld.xz * 0.16 + vec2(uTime * 0.02, -uTime * 0.015)).yz * 0.16 * 0.012;
  float paw = pNoise(vWorld.xz * 0.11 - windDir * uTime * 0.06) * 0.65 + pNoise(vWorld.xz * 0.27 - windDir * uTime * 0.1 + 3.0) * 0.35;
  paw = smoothstep(0.58, 0.82, paw) * (0.35 + 0.65 * uGust);
  vec2 still = broad + detailGrad(vWorld.xz * 0.55 - windDir * uTime * 0.12, uTime) * mix(0.0015, 0.01, paw);
  vec2 flowP = vec2(local.x * 1.4 - uTime * speed * 1.4, local.y * 3.2);
  vec2 flowG = pNoised(flowP).yz * 0.5 + pNoised(flowP * 2.3 + 4.0).yz * 0.25;
  vec2 flowGrad = vec2(flowG.x * chanDir + flowG.y * chanSide) * (0.05 + 0.1 * flowT);
  vec2 grad = simGrad * 2.5 + mix(still, flowGrad, inChan);
  // the detail fades with distance so the far surface does not shimmer
  grad *= mix(1.0, 0.45, smoothstep(10.0, 60.0, dist));
  vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

  // Fresnel, Schlick with water's F0
  float cosV = clamp(dot(N, V), 0.0, 1.0);
  // a little below Schlick at middle angles, so the body of the water and
  // the koi read through it and only the far surface turns to mirror
  float F = 0.015 + 0.985 * pow(1.0 - cosV, 6.0);

  // planar reflection, distorted by the surface normal
  vec4 rc = uReflMatrix * vec4(vWorld, 1.0);
  vec2 ruv = rc.xy / rc.w + N.xz * 0.06 / (1.0 + dist * 0.04);
  // On phones the reflection is small; four taps spread a little further
  // with distance and ripple strength keep its edges from stepping.
  float spreadPx = uReflBlur * (0.6 + dist * 0.025 + length(simGrad) * 6.0);
  vec2 o1 = vec2(0.5, 0.2) * uReflTexel * spreadPx;
  vec2 o2 = vec2(-0.2, 0.5) * uReflTexel * spreadPx;
  vec3 refl = (texture2D(uReflection, clamp(ruv + o1, 0.001, 0.999)).rgb +
               texture2D(uReflection, clamp(ruv - o1, 0.001, 0.999)).rgb +
               texture2D(uReflection, clamp(ruv + o2, 0.001, 0.999)).rgb +
               texture2D(uReflection, clamp(ruv - o2, 0.001, 0.999)).rgb) * 0.25;

  // how much water the eye looks through: the bed, or a koi above it
  // the eye ray bends down as it enters the water
  float cosI = clamp(V.y, 0.0, 1.0);
  float cosT = sqrt(1.0 - (1.0 - cosI * cosI) / 1.77);
  // march the view ray to the koi seen from above: from a few starting
  // depths, refine by fixed point steps and keep a consistent hit
  float column = bed;
  // the koi are drawn along the straight ray, so the march follows it too
  vec2 drift = -V.xz / max(V.y, 0.06);
  for (int g = 0; g < 3; g++) {
    float d = 0.1 + float(g) * 0.2;
    float kd = 9.0;
    for (int i = 0; i < 2; i++) {
      vec2 kuv = (vWorld.xz + drift * d - uBounds.xy) / uBounds.zw;
      float near = texture2D(uKoiDepth, vec2(kuv.x, 1.0 - kuv.y)).r;
      kd = near > 0.02 ? 1.0 - near : 9.0;
      if (kd > 4.0) break;
      d = kd;
    }
    if (kd < 4.0) column = min(column, kd);
  }
  float path = column / cosT;
  // silt hangs in the water, so even the shallows veil the pebble bed
  float T = exp(-path * 4.6) * mix(1.0, 0.5, smoothstep(0.02, 0.14, bed));

  // in-scattered light: clear green in the shallows, deep jade further in
  vec3 albedo = mix(uDeep, uShallow, exp(-bed * 3.5));
  vec3 scatter = albedo * (uSkyColor + uSunColor * max(uSunDir.y, 0.0) * 0.35);

  // sun glints on the ripples
  vec3 H = normalize(uSunDir + V);
  float nh = max(dot(N, H), 0.0);
  float spec = pow(nh, 1400.0) * 80.0 + pow(nh, 260.0) * 0.5;
  vec3 sun = uSunColor * spec * F * 4.0;

  // foam where the channel water breaks over the lip
  float lipFoam = smoothstep(0.82, 1.08, vChan.x) * inChan;
  float streak = pFbm(vec2(local.x * 2.2 - uTime * speed * 2.0, local.y * 7.0));
  lipFoam *= smoothstep(0.45, 0.75, streak + lipFoam * 0.35);
  vec3 foam = vec3(0.85, 0.88, 0.86) * (uSkyColor * 1.4 + uSunColor * 0.45);

  float edge = smoothstep(0.0, 0.035, bed) * (1.0 - smoothstep(0.02, 0.12, sdf));
  float trans = T * (1.0 - F);
  vec3 col = scatter * (1.0 - T) * (1.0 - F) + refl * F + sun;
  float alpha = 1.0 - trans;
  col = mix(col, foam, lipFoam * 0.8);
  alpha = mix(alpha, 1.0, lipFoam * 0.8);
  gl_FragColor = vec4(col * edge, alpha * edge);
}
`

// --- the wet ring on the banks -------------------------------------------

const WET_VERT = /* glsl */ `
attribute float aWet;
varying float vWet;
void main() {
  vWet = aWet;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`
const WET_FRAG = /* glsl */ `
varying float vWet;
void main() { gl_FragColor = vec4(vec3(mix(1.0, 0.68, vWet)), 1.0); }
`

// --- koi -------------------------------------------------------------------

// The swim wave: a travelling bend that grows towards the tail, plus the turn
// bend and the fin motion. aKoi: x body coordinate from the nose (0) to the
// tail tip (1.3), y fin type, z distance from the fin root (0..1).
// aSwim: phase, amplitude, turn bend, pectoral beat.
const SWIM_GLSL = /* glsl */ `
attribute vec3 aKoi;
attribute vec4 aSwim;
vec3 koiSwim(vec3 p, inout vec3 n) {
  float b = aKoi.x;
  float fin = aKoi.y;
  float root = aKoi.z;
  float phase = aSwim.x;
  float amp = aSwim.y;
  // pectoral fins row slowly about their root
  if (fin > 2.5 && fin < 4.5) {
    float side = fin < 3.5 ? 1.0 : -1.0;
    float beat = sin(phase * 0.5 + side * 0.6) * aSwim.w + 0.25;
    p.y -= root * 0.03 * beat;
    p.z += side * root * 0.03 * beat;
    p.x += root * 0.02 * sin(phase * 0.5 + 1.3);
  }
  // fins trail a secondary ripple
  if (fin > 0.5) {
    p.z += root * root * 0.025 * sin(b * 9.0 - phase * 1.2 + fin);
    p.y += root * 0.012 * sin(b * 7.0 - phase * 0.9);
  }
  float env = 0.12 + 0.88 * pow(clamp(b / 1.3, 0.0, 1.0), 1.7);
  float k = 6.2;
  float wave = amp * env * sin(b * k - phase);
  float dwave = amp * (env * cos(b * k - phase) * k);
  float bend = aSwim.z * b * b;
  p.z += wave + bend;
  // tilt the normal with the local slope of the bend
  float slope = dwave + aSwim.z * 2.0 * b;
  n = normalize(vec3(n.x - n.z * slope, n.y, n.z));
  return p;
}
`

// varieties by index: 0 kohaku, 1 sanke, 2 showa, 3 ogon, 4 karasu
function buildKoiGeometry(): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const koi: number[] = []
  const idx: number[] = []

  // The body runs from the nose at x = 0.5 to the tail root at x = -0.5. The
  // profile: a rounded head, the broadest point a little ahead of the middle,
  // a slim peduncle.
  const profile = (s: number): number => {
    if (s >= 0.6) return Math.sqrt(Math.max(0, 1 - ((s - 0.6) / 0.4) ** 2.2))
    const t = s / 0.6
    return 0.16 + 0.84 * (t * t * (3 - 2 * t)) ** 0.8
  }
  const RINGS = 44
  const SEG = 20
  for (let i = 0; i <= RINGS; i++) {
    const s = i / RINGS
    const f = profile(s)
    const x = -0.5 + s
    const w = 0.105 * f
    const h = 0.125 * f
    const cy = 0.012 * f
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2
      const sy = Math.sin(a)
      const cz = Math.cos(a)
      const belly = sy < 0 ? 0.82 : 1
      pos.push(x, cy + h * sy * belly, w * cz)
      koi.push(0.5 - x, 0, 0)
      nor.push(0, 0, 0)
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j
      const b = a + SEG + 1
      idx.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }

  // A fin is a grid between a root line and a trailing edge.
  const fin = (type: number, cols: number, rows: number, at: (u: number, v: number) => [number, number, number]) => {
    const base = pos.length / 3
    for (let i = 0; i <= rows; i++) {
      for (let j = 0; j <= cols; j++) {
        const u = j / cols
        const v = i / rows
        const p = at(u, v)
        pos.push(p[0], p[1], p[2])
        nor.push(0, 0, 0)
        koi.push(0.5 - p[0], type, v)
      }
    }
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = base + i * (cols + 1) + j
        const b = a + cols + 1
        idx.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
  }
  const half = (s: number) => 0.125 * profile(s)
  const halfW = (s: number) => 0.105 * profile(s)

  // tail: a broad, lightly forked fan that flows behind the peduncle
  fin(1, 12, 10, (u, v) => {
    const span = (u - 0.5) * 2
    const rootH = 0.02
    const len = 0.3 - 0.07 * Math.cos(span * Math.PI * 0.5) ** 2
    const x = -0.49 - v * len
    const spread = rootH + v * (0.17 + 0.02 * v)
    return [x, 0.012 + span * spread, 0]
  })
  // dorsal: a long low sail along the back
  fin(2, 14, 5, (u, v) => {
    const s = 0.22 + u * 0.4
    const top = half(s) * 0.98 + 0.012
    const height = 0.075 * Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.6 * (1 - 0.35 * u)
    return [-0.5 + s - v * 0.05, top + v * height, 0]
  })
  // pectorals: broad rounded fans held out from the flanks and swept back
  const fan = (u: number, v: number, len: number, root: number, spread: number) => {
    const chord = (root + spread * Math.sin(Math.min(1, v * 1.15) * Math.PI * 0.5)) * Math.sqrt(Math.max(0, 1 - v ** 6))
    return { out: v * len, along: (u - 0.5) * chord }
  }
  for (const side of [1, -1]) {
    fin(side > 0 ? 3 : 4, 6, 8, (u, v) => {
      const s = 0.74
      const f = fan(u, v, 0.15, 0.05, 0.1)
      return [-0.5 + s - f.out * 0.65 - f.along, -half(s) * 0.5 - f.out * 0.16, side * (halfW(s) * 0.82 + f.out * 0.8)]
    })
  }
  // pelvic fins: small fans under the belly
  for (const side of [1, -1]) {
    fin(5, 4, 5, (u, v) => {
      const s = 0.42
      const f = fan(u, v, 0.07, 0.03, 0.05)
      return [-0.5 + s - f.out * 0.7 - f.along, -half(s) * 0.7 - f.out * 0.3, side * (halfW(s) * 0.45 + f.out * 0.7)]
    })
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aKoi', new THREE.Float32BufferAttribute(koi, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  // the closed seam of each body ring shares a position but not an index;
  // average the normals across it so the seam does not show
  const n = g.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i <= RINGS; i++) {
    const a = i * (SEG + 1)
    const b = a + SEG
    const nx = n.getX(a) + n.getX(b)
    const ny = n.getY(a) + n.getY(b)
    const nz = n.getZ(a) + n.getZ(b)
    const l = Math.hypot(nx, ny, nz) || 1
    n.setXYZ(a, nx / l, ny / l, nz / l)
    n.setXYZ(b, nx / l, ny / l, nz / l)
  }
  return g
}

interface Koi {
  x: number
  z: number
  y: number
  heading: number
  speed: number
  baseSpeed: number
  turn: number
  phase: number
  size: number
  seed: number
  depthGoal: number
  rise: number
}

const KOI_DEPTH_VERT = /* glsl */ `
${SWIM_GLSL}
varying float vDepth;
void main() {
  vec3 n = normal;
  vec3 p = koiSwim(position, n);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vDepth = ${POND_LEVEL.toFixed(3)} - w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`
const KOI_DEPTH_FRAG = /* glsl */ `
varying float vDepth;
// stored as nearness to the surface, 0 where there is no koi, so the
// filtered edge of a koi fades instead of jumping to a far value
void main() { gl_FragColor = vec4(clamp(1.0 - vDepth, 0.0, 1.0), 0.0, 0.0, 1.0); }
`

export class Pond implements RealmPart {
  readonly kind = 'Pond'
  readonly object = new THREE.Group()

  private readonly tier: Tier
  private readonly shapeTex: THREE.DataTexture
  private readonly simSize: number
  private simA: THREE.WebGLRenderTarget
  private simB: THREE.WebGLRenderTarget
  private readonly simScene = new THREE.Scene()
  private readonly simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly simMaterial: THREE.ShaderMaterial
  private readonly simQuad: THREE.Mesh
  private readonly drops: THREE.Vector4[] = []
  private dropCount = 0
  private simAccum = 0

  private readonly reflectionRT: THREE.WebGLRenderTarget
  private readonly reflectionScale: number
  private readonly reflectCamera = new THREE.PerspectiveCamera()
  private readonly reflMatrix = new THREE.Matrix4()

  private readonly water: THREE.Mesh
  private readonly waterMaterial: THREE.ShaderMaterial
  private readonly wet: THREE.Mesh

  private readonly koi: Koi[] = []
  private readonly koiMesh: THREE.InstancedMesh
  private readonly koiDepthMesh: THREE.InstancedMesh
  private readonly koiGeometry: THREE.BufferGeometry
  private readonly koiMaterial: THREE.MeshPhysicalMaterial
  private readonly koiDepthMaterial: THREE.ShaderMaterial
  private readonly koiSwim: THREE.InstancedBufferAttribute
  private readonly koiDepthRT: THREE.WebGLRenderTarget
  private readonly koiDepthCamera: THREE.OrthographicCamera


  private readonly pointer = new THREE.Vector3()
  private readonly lastPointer = new THREE.Vector3()
  private hasPointer = false
  private hadPointer = false
  private pointerTravel = 0
  private time = 0

  private readonly dummy = new THREE.Object3D()
  private readonly v3 = new THREE.Vector3()
  private readonly v3b = new THREE.Vector3()
  private readonly v3c = new THREE.Vector3()
  private readonly m4 = new THREE.Matrix4()
  private readonly plane = new THREE.Plane()
  private readonly clip = new THREE.Vector4()
  private readonly q = new THREE.Vector4()
  private readonly size = new THREE.Vector2()
  private readonly prevClear = new THREE.Color()

  constructor(opts: { tier: Tier }) {
    this.tier = opts.tier
    const phone = this.tier === 'phone'
    this.object.name = 'pond'

    this.shapeTex = this.bakeShape()

    // ripple simulation
    this.simSize = phone ? 128 : 256
    const simOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    }
    this.simA = new THREE.WebGLRenderTarget(this.simSize, this.simSize, simOpts)
    this.simB = new THREE.WebGLRenderTarget(this.simSize, this.simSize, simOpts)
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push(new THREE.Vector4(0, 0, 1, 0))
    this.simMaterial = new THREE.ShaderMaterial({
      vertexShader: SIM_VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        uState: { value: this.simA.texture },
        uShape: { value: this.shapeTex },
        uTexel: { value: new THREE.Vector2(1 / this.simSize, 1 / this.simSize) },
        uBounds: { value: new THREE.Vector4(POND_BOUNDS.xMin, POND_BOUNDS.zMin, BW, BH) },
        uDrops: { value: this.drops },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMaterial)
    this.simQuad.frustumCulled = false
    this.simScene.add(this.simQuad)

    // reflection
    this.reflectionScale = 0.5
    this.reflectionRT = new THREE.WebGLRenderTarget(16, 16, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    })

    // koi depth seen from above, so the water clears over a koi near the top
    const kd = phone ? 128 : 256
    this.koiDepthRT = new THREE.WebGLRenderTarget(kd, Math.round((kd * BH) / BW), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    })
    this.koiDepthCamera = new THREE.OrthographicCamera(-BW / 2, BW / 2, BH / 2, -BH / 2, 0.1, 20)
    this.koiDepthCamera.position.set(POND_BOUNDS.xMin + BW / 2, POND_LEVEL + 5, POND_BOUNDS.zMin + BH / 2)
    this.koiDepthCamera.up.set(0, 0, -1)
    this.koiDepthCamera.lookAt(POND_BOUNDS.xMin + BW / 2, POND_LEVEL - 5, POND_BOUNDS.zMin + BH / 2)
    this.koiDepthCamera.updateMatrixWorld()

    const lip = findLip()

    // water surface
    this.waterMaterial = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: {
        uShape: { value: this.shapeTex },
        uSim: { value: this.simA.texture },
        uKoiDepth: { value: this.koiDepthRT.texture },
        uReflection: { value: this.reflectionRT.texture },
        uReflMatrix: { value: this.reflMatrix },
        uReflTexel: { value: new THREE.Vector2(1 / 16, 1 / 16) },
        uReflBlur: { value: phone ? 1 : 0 },
        uSimTexel: { value: new THREE.Vector2(1 / this.simSize, 1 / this.simSize) },
        uBounds: { value: new THREE.Vector4(POND_BOUNDS.xMin, POND_BOUNDS.zMin, BW, BH) },
        uOutflow: { value: new THREE.Vector4(OUTFLOW.x0, OUTFLOW.z0, OUTFLOW.x1, OUTFLOW.z1) },
        uOutHalf: { value: OUTFLOW.halfWidth },
        uLip: { value: new THREE.Vector2(lip.x, lip.z) },
        uSunDir: { value: SUN_DIRECTION },
        uSunColor: { value: SUN_RADIANCE },
        uSkyColor: { value: SKY_RADIANCE },
        uShallow: { value: new THREE.Vector3(0.05, 0.08, 0.032) },
        uDeep: { value: new THREE.Vector3(0.009, 0.036, 0.022) },
        uTime: realmUniforms.uTime,
        uWind: realmUniforms.uWind,
        uGust: realmUniforms.uGust,
      },
      transparent: true,
      depthWrite: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    this.water = new THREE.Mesh(this.buildSurface(), this.waterMaterial)
    this.water.name = 'pond-water'
    this.water.renderOrder = 1
    this.object.add(this.water)

    this.wet = new THREE.Mesh(
      this.buildWetRing(),
      new THREE.ShaderMaterial({
        vertexShader: WET_VERT,
        fragmentShader: WET_FRAG,
        transparent: true,
        premultipliedAlpha: true,
        blending: THREE.MultiplyBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -16,
      }),
    )
    this.wet.name = 'pond-wet'
    this.object.add(this.wet)

    // koi
    this.koiGeometry = buildKoiGeometry()
    const count = phone ? 6 : 9
    const swim = new Float32Array(count * 4)
    this.koiSwim = new THREE.InstancedBufferAttribute(swim, 4)
    this.koiSwim.setUsage(THREE.DynamicDrawUsage)
    this.koiGeometry.setAttribute('aSwim', this.koiSwim)
    const looks = new Float32Array(count * 2)
    const r = rng(7171)
    const order = [0, 1, 2, 3, 0, 4, 1, 2, 0]
    for (let i = 0; i < count; i++) {
      looks[i * 2] = order[i % order.length] ?? 0
      looks[i * 2 + 1] = r()
      let x = 0
      let z = 0
      for (let tries = 0; tries < 200; tries++) {
        x = POND_BOUNDS.xMin + r() * BW
        z = POND_BOUNDS.zMin + r() * BH
        if (koiSdf(x, z) < -0.9) break
      }
      const baseSpeed = 0.17 + r() * 0.1
      this.koi.push({
        x,
        z,
        y: POND_LEVEL - 0.35,
        heading: r() * Math.PI * 2,
        speed: baseSpeed,
        baseSpeed,
        turn: 0,
        phase: r() * 10,
        size: 0.58 + r() * 0.3,
        seed: r() * 100,
        depthGoal: 0.1 + r() * 0.25,
        rise: 0,
      })
    }
    this.koiGeometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(looks, 2))
    this.koiMaterial = this.buildKoiMaterial()
    this.koiMesh = new THREE.InstancedMesh(this.koiGeometry, this.koiMaterial, count)
    this.koiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.koiMesh.frustumCulled = false
    this.koiMesh.castShadow = false
    this.koiMesh.receiveShadow = true
    this.koiMesh.name = 'koi'
    this.object.add(this.koiMesh)

    this.koiDepthMaterial = new THREE.ShaderMaterial({
      vertexShader: KOI_DEPTH_VERT,
      fragmentShader: KOI_DEPTH_FRAG,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    })
    this.koiDepthMesh = new THREE.InstancedMesh(this.koiGeometry, this.koiDepthMaterial, count)
    this.koiDepthMesh.instanceMatrix = this.koiMesh.instanceMatrix
    this.koiDepthMesh.frustumCulled = false

    this.updateKoi(0.016, 1)
  }

  setPointer(point: THREE.Vector3 | null): void {
    if (point) {
      this.pointer.copy(point)
      this.hasPointer = true
    } else {
      this.hasPointer = false
    }
  }

  // r: bed depth / 1.5, g: (pond sdf + 1) / 3, b: (island sdf + 1) / 3
  private bakeShape(): THREE.DataTexture {
    const w = 192
    const h = Math.round((w * BH) / BW)
    const data = new Uint8Array(w * h * 4)
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = POND_BOUNDS.xMin + ((i + 0.5) / w) * BW
        const z = POND_BOUNDS.zMin + ((j + 0.5) / h) * BH
        const o = (j * w + i) * 4
        data[o] = c((POND_LEVEL - groundHeight(x, z)) / 1.5)
        data[o + 1] = c((pondSdf(x, z) + 1) / 3)
        data[o + 2] = c((islandSdf(x, z) + 1) / 3)
        data[o + 3] = 255
      }
    }
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }

  // A grid clipped to the shore. Cells just past the shore stay, so the water
  // meets the bank under the terrain instead of ending in a visible edge.
  private buildSurface(): THREE.BufferGeometry {
    const step = 0.2
    const nx = Math.ceil(BW / step)
    const nz = Math.ceil(BH / step)
    const keep = new Uint8Array((nx + 1) * (nz + 1))
    const pos: number[] = []
    const map = new Int32Array((nx + 1) * (nz + 1)).fill(-1)
    const idx: number[] = []
    const ok = (x: number, z: number) => pondSdf(x, z) < 0.35 && islandSdf(x, z) > -0.3
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) keep[j * (nx + 1) + i] = ok(POND_BOUNDS.xMin + i * step, POND_BOUNDS.zMin + j * step) ? 1 : 0
    const vert = (i: number, j: number) => {
      const k = j * (nx + 1) + i
      let v = map[k] ?? -1
      if (v < 0) {
        v = pos.length / 3
        map[k] = v
        pos.push(POND_BOUNDS.xMin + i * step, POND_LEVEL, POND_BOUNDS.zMin + j * step)
      }
      return v
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const any = keep[j * (nx + 1) + i]! | keep[j * (nx + 1) + i + 1]! | keep[(j + 1) * (nx + 1) + i]! | keep[(j + 1) * (nx + 1) + i + 1]!
        if (!any) continue
        const a = vert(i, j)
        const b = vert(i + 1, j)
        const c = vert(i, j + 1)
        const d = vert(i + 1, j + 1)
        idx.push(a, c, b, b, c, d)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeBoundingSphere()
    g.computeBoundingBox()
    return g
  }

  // The bank just above the waterline, draped on the terrain and darkened.
  private buildWetRing(): THREE.BufferGeometry {
    const step = 0.12
    const nx = Math.ceil((BW + 1) / step)
    const nz = Math.ceil((BH + 1) / step)
    const x0 = POND_BOUNDS.xMin - 0.5
    const z0 = POND_BOUNDS.zMin - 0.5
    const pos: number[] = []
    const wet: number[] = []
    const idx: number[] = []
    const map = new Int32Array((nx + 1) * (nz + 1)).fill(-1)
    const inRing = (x: number, z: number) => {
      const d = pondSdf(x, z)
      return d > -0.9 && d < 0.75 && islandSdf(x, z) > 0.05
    }
    const vert = (i: number, j: number) => {
      const k = j * (nx + 1) + i
      let v = map[k] ?? -1
      if (v < 0) {
        v = pos.length / 3
        map[k] = v
        const x = x0 + i * step
        const z = z0 + j * step
        const y = groundHeight(x, z)
        pos.push(x, y + 0.015, z)
        // the darkening starts at the waterline and fades up the bank
        // zero under the water (the water shades the bed there), darkest at
        // the waterline, fading up the bank
        const above = y - POND_LEVEL
        const sub = Math.min(1, Math.max(0, (above + 0.01) / 0.05))
        const up = Math.max(0, 1 - Math.max(0, above) / 0.28) * 0.55 + Math.max(0, 1 - Math.max(0, pondSdf(x, z)) / 1.0) * 0.45
        const sm = up * up * (3 - 2 * up)
        wet.push(sub * sm * (0.8 + 0.2 * noise2(x * 1.1, z * 1.1)))
      }
      return v
    }
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * step
        const z = z0 + (j + 0.5) * step
        if (!inRing(x, z)) continue
        const a = vert(i, j)
        const b = vert(i + 1, j)
        const c = vert(i, j + 1)
        const d = vert(i + 1, j + 1)
        idx.push(a, c, b, b, c, d)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('aWet', new THREE.Float32BufferAttribute(wet, 1))
    g.setIndex(idx)
    g.computeBoundingSphere()
    return g
  }

  private buildKoiMaterial(): THREE.MeshPhysicalMaterial {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.32,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.25,
      side: THREE.DoubleSide,
      alphaHash: true,
    })
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
${SWIM_GLSL}
attribute vec2 aLook;
varying vec3 vKoiPos;
varying vec3 vKoiInfo;
varying vec2 vLook;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 objectNormal = vec3(normal);
vec3 koiP = koiSwim(position, objectNormal);
vKoiPos = position;
vKoiInfo = aKoi;
vLook = aLook;
#ifdef USE_TANGENT
vec3 objectTangent = vec3(tangent.xyz);
#endif`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = koiP;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vKoiPos;
varying vec3 vKoiInfo;
varying vec2 vLook;
${NOISE_GLSL}
float kNoise3(vec3 p) {
  return pNoise(p.xy + p.z * 1.7) * 0.5 + pNoise(p.zx * 1.3 - p.y * 2.1 + 5.0) * 0.5;
}
float crisp(float v, float t) {
  float w = fwidth(v) * 1.2 + 0.01;
  return smoothstep(t - w, t + w, v);
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float variety = vLook.x;
float seed = vLook.y * 37.0;
vec3 kp = vKoiPos;
float fin = vKoiInfo.y;
float root = vKoiInfo.z;
float top = smoothstep(-0.03, 0.06, kp.y);
vec3 white = vec3(0.8, 0.78, 0.72);
vec3 red = vec3(0.5, 0.022, 0.006);
vec3 black = vec3(0.012, 0.012, 0.014);
float big = kNoise3(kp * vec3(3.4, 4.6, 4.6) + seed);
float spots = kNoise3(kp * vec3(14.0, 16.0, 16.0) + seed * 1.7);
// bold red blocks across the back, the belly stays white
float redMask = crisp(big + 0.42 * top - 0.25 * (1.0 - top) + 0.06 * sin(kp.x * 9.0 + seed), 0.62);
// a red cap on the head, the hallmark of a good kohaku
redMask = max(redMask, crisp(top * smoothstep(0.32, 0.4, kp.x) * (1.0 - smoothstep(0.47, 0.5, kp.x)), 0.5) * step(fin, 0.5));
vec3 body = mix(white, red, redMask);
float metal = 0.0;
if (variety > 0.5 && variety < 1.5) {
  // sanke: small black spots on the white and red
  float sumi = crisp(spots * (0.4 + 0.7 * top), 0.6);
  body = mix(body, black, sumi * step(fin, 0.5));
} else if (variety > 1.5 && variety < 2.5) {
  // showa: black base, red and white over it, black wraps the belly
  float wh = crisp(kNoise3(kp * vec3(6.0, 8.0, 8.0) + seed + 3.0) * (0.4 + 0.6 * top), 0.42);
  body = mix(black, mix(white, red, redMask), wh * (0.4 + 0.6 * top));
} else if (variety > 2.5 && variety < 3.5) {
  // ogon: one metallic gold
  body = vec3(0.62, 0.38, 0.085) * (0.85 + 0.25 * big) * mix(0.8, 1.05, top);
  metal = 0.45;
} else if (variety > 3.5) {
  // karasu: dark charcoal, a warm orange glow low on the flanks
  body = mix(vec3(0.03, 0.028, 0.03), vec3(0.32, 0.11, 0.03), (1.0 - top) * 0.6);
}
// fins are translucent and pale at the edges; showa fins keep a black root
if (fin > 0.5) {
  vec3 finBase = variety > 2.5 && variety < 3.5 ? vec3(0.75, 0.5, 0.14) : variety > 3.5 ? vec3(0.04, 0.035, 0.035) : white;
  if (variety > 1.5 && variety < 2.5) finBase = mix(black, white, smoothstep(0.15, 0.5, root));
  // fin rays run out from the root
  float rayCoord = fin < 1.5 ? kp.y * 240.0 : fin < 2.5 ? kp.x * 240.0 : (kp.x - kp.z) * 200.0;
  float rays = 0.9 + 0.1 * sin(rayCoord);
  body = mix(body, finBase, 0.75) * rays;
  bool pec = fin > 2.5 && fin < 4.5;
  bool pelvic = fin > 4.5;
  diffuseColor.a = mix(pec || pelvic ? 0.6 : 0.9, pec || pelvic ? 0.12 : 0.35, smoothstep(0.15, 1.0, root));
}
// scale rows catch the light one by one
vec2 sc = vec2(kp.x * 70.0, atan(kp.z, kp.y) * 9.0);
vec2 sid = floor(sc + vec2(0.0, floor(sc.x) * 0.5));
float scaleRnd = pHash(sid + seed);
diffuseColor.rgb = body * (0.96 + 0.06 * scaleRnd * step(fin, 0.5));
float koiMetal = metal;
float koiScale = scaleRnd;`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `float roughnessFactor = roughness * mix(1.0, 0.6 + 0.8 * koiScale, step(fin, 0.5));
if (fin > 0.5) roughnessFactor = 0.45;`,
        )
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = koiMetal;')
    }
    m.customProgramCacheKey = () => 'realm-koi'
    return m
  }

  // a click on the water from the bank
  drop(x: number, z: number): void {
    this.addDrop(x, z, 0.35, 0.03)
  }

  private addDrop(x: number, z: number, radius: number, strength: number): void {
    if (this.dropCount >= MAX_DROPS) return
    this.drops[this.dropCount++]!.set(x, z, radius, strength)
  }

  private updateKoi(dt: number, motion: number): void {
    const koi = this.koi
    const pace = 0.35 + 0.65 * motion
    const step = dt * pace
    const grad = this.v3
    for (let i = 0; i < koi.length; i++) {
      const k = koi[i]!
      let dx = Math.cos(k.heading)
      let dz = Math.sin(k.heading)
      // a slow wander
      const wander = (noise2(this.time * 0.13 + k.seed, k.seed * 3.1) - 0.5) * 2.2
      let wx = dx + -dz * wander * 0.5
      let wz = dz + dx * wander * 0.5
      // keep off the shore: look ahead and steer down the distance gradient
      const ax = k.x + dx * 1.1
      const az = k.z + dz * 1.1
      const sAhead = koiSdf(ax, az)
      if (sAhead > -0.9) {
        const e = 0.15
        grad.set(koiSdf(ax + e, az) - koiSdf(ax - e, az), 0, koiSdf(ax, az + e) - koiSdf(ax, az - e))
        const gl = Math.hypot(grad.x, grad.z) || 1
        const w = Math.min(3, (sAhead + 0.9) * 3.5)
        wx -= (grad.x / gl) * w
        wz -= (grad.z / gl) * w
      }
      // loose schooling: keep apart, drift with the neighbours
      let ncx = 0
      let ncz = 0
      let nax = 0
      let naz = 0
      let nn = 0
      for (let j = 0; j < koi.length; j++) {
        if (j === i) continue
        const o = koi[j]!
        const ox = k.x - o.x
        const oz = k.z - o.z
        const d = Math.hypot(ox, oz)
        if (d < 0.9 && d > 1e-4) {
          const push = ((0.9 - d) / 0.9) * 2.0
          wx += (ox / d) * push
          wz += (oz / d) * push
        }
        if (d < 3) {
          ncx += o.x
          ncz += o.z
          nax += Math.cos(o.heading)
          naz += Math.sin(o.heading)
          nn++
        }
      }
      if (nn > 0) {
        wx += nax / nn * 0.35 + (ncx / nn - k.x) * 0.12
        wz += naz / nn * 0.35 + (ncz / nn - k.z) * 0.12
      }
      // the pointer draws nearby koi up to it
      let goal = k.depthGoal
      let speedGoal = k.baseSpeed
      if (this.hasPointer) {
        const px = this.pointer.x - k.x
        const pz = this.pointer.z - k.z
        const d = Math.hypot(px, pz)
        if (d < 5 && koiSdf(this.pointer.x, this.pointer.z) < 0) {
          const pull = (1 - d / 5) * 2.2 * (d > 0.45 ? 1 : d / 0.45)
          wx += (px / (d + 1e-4)) * pull
          wz += (pz / (d + 1e-4)) * pull
          const near = 1 - Math.min(1, d / 3.5)
          goal = goal + (0.07 - goal) * near
          speedGoal = k.baseSpeed * (1 + 0.6 * near * (d > 0.6 ? 1 : 0.3))
        }
      }
      const want = Math.atan2(wz, wx)
      let diff = want - k.heading
      diff = Math.atan2(Math.sin(diff), Math.cos(diff))
      const maxTurn = 1.1
      const turn = Math.max(-maxTurn, Math.min(maxTurn, diff * 1.6))
      k.turn += (turn - k.turn) * Math.min(1, step * 3)
      k.heading += k.turn * step
      k.speed += (speedGoal - k.speed) * Math.min(1, step * 1.5)
      dx = Math.cos(k.heading)
      dz = Math.sin(k.heading)
      k.x += dx * k.speed * step
      k.z += dz * k.speed * step
      // never through the bank
      const s = koiSdf(k.x, k.z)
      if (s > -0.35) {
        const e = 0.1
        const gx = koiSdf(k.x + e, k.z) - koiSdf(k.x - e, k.z)
        const gz = koiSdf(k.x, k.z + e) - koiSdf(k.x, k.z - e)
        const gl = Math.hypot(gx, gz) || 1
        k.x -= (gx / gl) * (s + 0.35)
        k.z -= (gz / gl) * (s + 0.35)
      }
      // depth: between the surface and the bed
      const bed = POND_LEVEL - groundHeight(k.x, k.z)
      const depth = Math.max(0.07, Math.min(goal, bed - 0.1 * k.size - 0.05))
      const yGoal = POND_LEVEL - depth
      const dy = (yGoal - k.y) * Math.min(1, step * 0.8)
      k.y += dy
      k.rise = dy / Math.max(step, 1e-4)
      k.phase += step * (4.2 + k.speed * 16)

      this.dummy.position.set(k.x, k.y, k.z)
      this.dummy.rotation.set(0, -k.heading, Math.max(-0.25, Math.min(0.25, k.rise * 1.5)), 'YXZ')
      this.dummy.scale.setScalar(k.size)
      this.dummy.updateMatrix()
      this.koiMesh.setMatrixAt(i, this.dummy.matrix)
      const amp = 0.035 + 0.11 * Math.min(1, k.speed / 0.35)
      this.koiSwim.setXYZW(i, k.phase, amp, -k.turn * 0.12, 0.6 + Math.abs(k.turn) * 0.8)

      // a koi near the surface stirs it with its tail
      const nearTop = 1 - Math.min(1, (depth - 0.05) / 0.3)
      if (nearTop > 0 && Math.sin(k.phase) > 0.92) {
        const tx = k.x - dx * 0.35 * k.size
        const tz = k.z - dz * 0.35 * k.size
        this.addDrop(tx, tz, 0.1, 0.002 * nearTop * (0.5 + k.speed * 3) * step * 60)
      }
    }
    this.koiMesh.instanceMatrix.needsUpdate = true
    this.koiSwim.needsUpdate = true
  }

  update(frame: Frame): void {
    this.time = frame.t
    this.dropCount = 0
    // the pointer leaves a soft ring where it moves over the water
    if (this.hasPointer && pondSdf(this.pointer.x, this.pointer.z) < -0.1) {
      this.pointerTravel += this.hadPointer ? Math.min(0.5, this.pointer.distanceTo(this.lastPointer)) : 0
      if (this.pointerTravel > 0.08) {
        this.addDrop(this.pointer.x, this.pointer.z, 0.15, 0.005)
        this.pointerTravel = 0
      }
    }
    this.hadPointer = this.hasPointer
    this.lastPointer.copy(this.pointer)
    this.updateKoi(frame.dt, frame.motion)
    for (let i = this.dropCount; i < MAX_DROPS; i++) this.drops[i]!.w = 0
    this.simAccum += frame.dt
  }

  prerender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const prevTarget = renderer.getRenderTarget()
    const prevAutoClear = renderer.autoClear
    const prevAlpha = renderer.getClearAlpha()
    renderer.getClearColor(this.prevClear)

    // ripple simulation at a fixed 60 steps per second
    let steps = Math.min(3, Math.floor(this.simAccum * 60))
    this.simAccum -= steps / 60
    if (this.simAccum > 0.05) this.simAccum = 0
    if (steps === 0 && this.dropCount > 0) steps = 1
    for (let s = 0; s < steps; s++) {
      this.simMaterial.uniforms.uState!.value = this.simA.texture
      renderer.setRenderTarget(this.simB)
      renderer.render(this.simScene, this.simCamera)
      const t = this.simA
      this.simA = this.simB
      this.simB = t
      // drops land once
      if (s === 0) for (let i = 0; i < MAX_DROPS; i++) this.drops[i]!.w = 0
    }
    this.waterMaterial.uniforms.uSim!.value = this.simA.texture

    // koi depth from above
    renderer.setRenderTarget(this.koiDepthRT)
    renderer.setClearColor(0x000000, 1)
    renderer.autoClear = false
    renderer.clear(true, false, false)
    renderer.render(this.koiDepthMesh, this.koiDepthCamera)

    // planar reflection
    this.size.copy(sceneSize)
    // half the drawn scene, but never so few texels across that the far
    // shore turns into blocks when the host renders a phone at a low ratio
    const rs = Math.max(this.reflectionScale, Math.min(1, 360 / Math.max(1, Math.min(this.size.x, this.size.y))))
    const rw = Math.max(16, Math.round(this.size.x * rs))
    const rh = Math.max(16, Math.round(this.size.y * rs))
    if (this.reflectionRT.width !== rw || this.reflectionRT.height !== rh) {
      this.reflectionRT.setSize(rw, rh)
      ;(this.waterMaterial.uniforms.uReflTexel!.value as THREE.Vector2).set(1 / rw, 1 / rh)
    }
    this.updateReflectCamera(camera)
    this.water.visible = false
    renderer.setRenderTarget(this.reflectionRT)
    renderer.setClearColor(this.prevClear, prevAlpha)
    renderer.autoClear = true
    renderer.render(scene, this.reflectCamera)
    this.water.visible = true

    renderer.setRenderTarget(prevTarget)
    renderer.autoClear = prevAutoClear
    renderer.setClearColor(this.prevClear, prevAlpha)
  }

  private updateReflectCamera(camera: THREE.PerspectiveCamera): void {
    const rc = this.reflectCamera
    camera.updateMatrixWorld()
    const camPos = this.v3.setFromMatrixPosition(camera.matrixWorld)
    this.m4.extractRotation(camera.matrixWorld)
    const look = this.v3b.set(0, 0, -1).applyMatrix4(this.m4).add(camPos)
    rc.position.set(camPos.x, 2 * POND_LEVEL - camPos.y, camPos.z)
    rc.up.set(0, 1, 0).applyMatrix4(this.m4)
    rc.up.y = -rc.up.y
    look.y = 2 * POND_LEVEL - look.y
    rc.lookAt(look)
    rc.near = camera.near
    rc.far = camera.far
    rc.updateMatrixWorld()
    rc.projectionMatrix.copy(camera.projectionMatrix)
    rc.layers.mask = camera.layers.mask

    this.reflMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    this.reflMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse)

    // an oblique near plane at the water surface, so nothing below it reflects
    this.plane.set(this.v3c.set(0, 1, 0), -POND_LEVEL)
    this.plane.applyMatrix4(rc.matrixWorldInverse)
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant)
    const e = rc.projectionMatrix.elements
    this.q.set((Math.sign(this.clip.x) + e[8]!) / e[0]!, (Math.sign(this.clip.y) + e[9]!) / e[5]!, -1, (1 + e[10]!) / e[14]!)
    this.clip.multiplyScalar(2 / this.clip.dot(this.q))
    e[2] = this.clip.x
    e[6] = this.clip.y
    e[10] = this.clip.z + 1 - 0.003
    e[14] = this.clip.w
    rc.projectionMatrixInverse.copy(rc.projectionMatrix).invert()
  }

  dispose(): void {
    this.shapeTex.dispose()
    this.simA.dispose()
    this.simB.dispose()
    this.simMaterial.dispose()
    this.simQuad.geometry.dispose()
    this.reflectionRT.dispose()
    this.koiDepthRT.dispose()
    this.water.geometry.dispose()
    this.waterMaterial.dispose()
    this.wet.geometry.dispose()
    ;(this.wet.material as THREE.Material).dispose()
    this.koiGeometry.dispose()
    this.koiMaterial.dispose()
    this.koiDepthMaterial.dispose()
    this.koiMesh.dispose()
    this.object.clear()
  }
}
