import * as THREE from 'three'
import type { Frame, RealmPart, Tier } from './types'
import { ISLAND_RX, ISLAND_RZ, AZALEAS, CHERRY, LANTERNS, MAPLES, fbm2, groundHeight, islandSdf, lawnWeight, pondSdf, rng } from './layout'
import { WIND_GLSL, realmUniforms } from './atmosphere'

// The lawn: instanced geometry blades in square tiles, so the renderer can cull
// whole tiles against the frustum. Every blade is a curved, tapered strip whose
// shape, wind and pointer bend are computed in the vertex shader from a few
// per-blade numbers; the CPU only places roots once.

interface TierSettings {
  blades: number
  segments: number
  tile: number
  fadeStart: number
  fadeEnd: number
  // fewer blades are drawn wider and kept closer to the path, so the cover
  // seen from the walk stays the same
  widen: number
  focus: number
  // how far from the walk the full density reaches, and where it bottoms out
  near: [number, number]
  // extra width and height for the mown blades, where few blades must cover
  cover: number
  // extra density around the opening view on the landing, the first frame
  // every visitor sees
  landing: number
  // blades drawn per instance (a small tuft), so the short lawn stays dense
  // without more per-instance work; `blades` counts instances
  strips: number
}

const TIERS: Record<Tier, TierSettings> = {
  ultra: { blades: 250_000, strips: 2, segments: 6, tile: 4, fadeStart: 66, fadeEnd: 92, widen: 1, focus: 0.35, near: [4, 13], cover: 1, landing: 1.3 },
  high: { blades: 120_000, strips: 2, segments: 5, tile: 4, fadeStart: 58, fadeEnd: 84, widen: 1.15, focus: 0.45, near: [4, 12], cover: 1.1, landing: 1.6 },
  phone: { blades: 32_000, strips: 3, segments: 5, tile: 6, fadeStart: 42, fadeEnd: 66, widen: 1.2, focus: 0.16, near: [5, 10.5], cover: 1.4, landing: 3.2 },
}

// The host terrain should multiply its albedo by this, weighted by lawnWeight,
// so the floor between blades reads as a dark thatch of old grass rather than
// bare soil, which matters most from above and on phones with fewer blades.
export const LAWN_FLOOR_TINT = new THREE.Color(0.3, 0.52, 0.16)

// where the visitor's eyes first open (the wake-up camera on the landing)
const OPENING = { x: 1.6, z: 21 }

// one tile's blades as plain numbers, so the lawn can be laid out in a
// worker: per instance root (xyz relative to the tile centre, yaw), shape
// (height, width, bend, seed) and tone (wear, straw, dark clump, seed head)
export interface GrassTile {
  roots: Float32Array
  shapes: Float32Array
  tones: Float32Array
  count: number
  // the blades' bounds with room for sway, relative to the centre
  box: [number, number, number, number, number, number]
  centre: [number, number, number]
}

interface Tile {
  mesh: THREE.Mesh
  geometry: THREE.InstancedBufferGeometry
  center: THREE.Vector3
  radius: number
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// One blade: rows of two vertices from root (y = 0) to just below the tip,
// then a single tip vertex. x is the side in [-0.5, 0.5], y the height
// fraction. Rows crowd towards the tip, where the curve bends most.
// z is the blade's index within its instance.
function bladeGeometry(segments: number, strips: number): { position: THREE.BufferAttribute; normal: THREE.BufferAttribute; index: THREE.BufferAttribute } {
  const pos: number[] = []
  const idx: number[] = []
  const perBlade = segments * 2 + 1
  for (let k = 0; k < strips; k++) {
    for (let r = 0; r < segments; r++) {
      const t = 1 - Math.pow(1 - r / segments, 1.25)
      pos.push(-0.5, t, k, 0.5, t, k)
    }
    pos.push(0, 1, k)
    const o = k * perBlade
    for (let r = 0; r < segments - 1; r++) {
      const a = o + r * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const last = o + (segments - 1) * 2
    idx.push(last, last + 1, last + 2)
  }
  const count = pos.length / 3
  return {
    position: new THREE.BufferAttribute(new Float32Array(pos), 3),
    // replaced in the shader; the attribute only has to exist
    normal: new THREE.BufferAttribute(new Float32Array(count * 3), 3),
    index: new THREE.BufferAttribute(new Uint16Array(idx), 1),
  }
}

// 0..1: where the grass is left long and loose. A cared-for lawn is mown
// short; only the margin along the rim, the pond banks and the bases of
// lanterns and azaleas are let grow.
function longness(x: number, z: number): number {
  const e = islandSdf(x, z)
  const rim = smooth(0.9, 1.8, e) * (1 - smooth(2.4, 3.8, e))
  const pd = pondSdf(x, z)
  const bank = smooth(0.15, 0.45, pd) * (1 - smooth(1.1, 1.7, pd))
  let near = 0
  for (const l of LANTERNS) {
    const d = Math.hypot(x - l.x, z - l.z)
    near = Math.max(near, 1 - smooth(0.7, 1.1, d))
  }
  for (const a of AZALEAS) {
    const d = Math.hypot(x - a.x, z - a.z) - a.r
    near = Math.max(near, 1 - smooth(0.0, 0.45, d))
  }
  return clamp01(Math.max(rim, bank * 0.9, near * 0.5))
}

// 0..1: grass worn thin and short under the trees, where the canopy shades it
// and feet gather; strongest inside the drip line
function wornness(x: number, z: number): number {
  const cx = CHERRY.x + CHERRY.lean.x * CHERRY.height * 0.4
  const cz = CHERRY.z + CHERRY.lean.z * CHERRY.height * 0.4
  const r = CHERRY.spread * 0.75
  let w = 1 - smooth(r * 0.45, r, Math.hypot(x - cx, z - cz))
  for (const m of MAPLES) {
    const mr = m.spread * 0.75
    w = Math.max(w, 1 - smooth(mr * 0.45, mr, Math.hypot(x - m.x, z - m.z)))
  }
  return w * 0.85
}

const VERTEX_PARS = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uGust;
uniform vec4 uPointer;
uniform vec2 uFade;
uniform float uViewHeight;
attribute vec4 aRoot;
attribute vec4 aShape;
// wear, dry straw, dark clump, seed head
attribute vec4 aTone;
varying vec3 vGrassColor;
varying float vGrassT;
varying float vGrassAO;
varying float vUpBlend;
varying vec2 vGrassBlade;
varying float vCalm;
${WIND_GLSL}
float grassHash(float n) {
  return fract(sin(n * 91.3458) * 47453.5453);
}
`

const VERTEX_MAIN = /* glsl */ `
vec3 grassTile = modelMatrix[3].xyz;
vec3 root = grassTile + aRoot.xyz;
float yaw = aRoot.w;
float h = aShape.x;
float w = aShape.y;
float bend = aShape.z;
float seed = aShape.w;
// further blades of a tuft splay around the first
float strip = position.z;
if (strip > 0.5) {
  seed = fract(seed + strip * 0.3719);
  float a = yaw + strip * 2.39996;
  // short mown blades spread wider, so the blades of one instance cover
  // ground instead of reading as one tuft; tall ones stay a tight tuft
  float spreadR = (0.015 + 0.03 * grassHash(seed * 2.9)) * (1.0 + 2.5 * (1.0 - smoothstep(0.08, 0.25, h)));
  root.xz += vec2(cos(a), sin(a)) * spreadR;
  // sink a little with the offset so a blade on a gentle slope never floats
  root.y -= spreadR * 0.15;
  yaw = a + (grassHash(seed * 4.3) - 0.5) * 0.8;
  h *= 0.7 + 0.3 * grassHash(seed * 8.1);
}
float t = position.y;
float side = position.x;

// Far away the lawn thins out and the survivors widen to keep the coverage;
// past fade start every blade shrinks to nothing before its tile is dropped.
float dist = length(root - cameraPosition);
float rank = grassHash(seed * 17.13 + 3.1);
float keep = mix(1.0, 0.35, smoothstep(uFade.x * 0.55, uFade.y, dist));
float life = (1.0 - smoothstep(keep - 0.12, keep, rank)) * (1.0 - smoothstep(uFade.x, uFade.y, dist));
h *= life;
w *= mix(0.8, 2.4, smoothstep(1.5, uFade.x, dist)) * smoothstep(0.0, 0.4, life);

vec3 fwd = vec3(cos(yaw), 0.0, sin(yaw));
vec3 rgt = vec3(-fwd.z, 0.0, fwd.x);

float windAmount = length(uWind);
float gust = realmGust(root.xz) * (0.55 + 0.45 * uGust);
// the shared gust field is wider than the lawn; a smaller travelling ripple
// inside it gives the waves you see rolling over the grass
vec2 windDir = uWind / max(windAmount, 1e-4);
float ripple = smoothstep(0.35, 0.8, realmNoise(root.xz * 0.21 - windDir * uTime * 0.85));
float wave = ripple * (0.35 + 0.65 * gust);
float stiff = 0.55 + 0.45 * grassHash(seed * 5.31);
vec3 lean = fwd * bend * h;
vec3 sway = windSway(root, 1.0) * h * 0.85 * stiff * (0.75 + 0.6 * wave);
float ph = seed * 6.2831;
#ifdef GRASS_SIMPLE
vec3 flutter = rgt * sin(uTime * 4.7 + ph * 3.0)
#else
vec3 flutter = (rgt * sin(uTime * 4.7 + ph * 3.0) + fwd * sin(uTime * 3.4 + ph * 5.0))
#endif
  * h * 0.05 * windAmount * (0.4 + gust);

vec2 pd = root.xz - uPointer.xz;
float pl = length(pd);
float press = uPointer.w * (1.0 - smoothstep(0.1, 0.8, pl)) * (1.0 - smoothstep(0.6, 1.2, abs(root.y - uPointer.y)));
vec3 push = vec3(pd.x, 0.0, pd.y) / max(pl, 1e-3) * press * h * 0.95;

vec3 tipH = lean + sway + flutter + push;
tipH.y = 0.0;
float hl = length(tipH);
float maxL = 0.94 * h;
if (hl > maxL) { tipH *= maxL / hl; hl = maxL; }
// keep the blade length roughly constant as it bows over
float tipY = sqrt(max(h * h - hl * hl, 0.0)) * (1.0 - 0.12 * hl / max(h, 1e-4));
vec3 p1 = root + vec3(0.0, tipY * 0.72, 0.0) + tipH * 0.18;
vec3 p2 = root + vec3(tipH.x, tipY, tipH.z);
float it = 1.0 - t;
vec3 spine = it * it * root + 2.0 * it * t * p1 + t * t * p2;
vec3 tangent = normalize(2.0 * it * (p1 - root) + 2.0 * t * (p2 - p1) + vec3(0.0, 1e-5, 0.0));

vec3 sideRaw = rgt - tangent * dot(rgt, tangent);
// a blade blown flat along its own side axis would leave no side vector
vec3 sideDir = dot(sideRaw, sideRaw) > 1e-8 ? normalize(sideRaw) : normalize(cross(tangent, fwd) + vec3(1e-4, 0.0, 0.0));
vec3 bin = cross(sideDir, tangent);
float twist = (grassHash(seed * 11.7) - 0.5) * 1.6 * t;
vec3 sideTw = sideDir * cos(twist) + bin * sin(twist);
float width = w * (1.0 - pow(t, 2.5)) * (0.8 + 0.2 * smoothstep(0.0, 0.18, t));
// a seed head swells the last part of the stem
width *= 1.0 + aTone.w * 1.4 * smoothstep(0.72, 0.86, t) * (1.0 - smoothstep(0.96, 1.0, t));
vec3 grassWorld = spine + sideTw * side * width;

// a rounded cross section: normals fan out towards the edges
vec3 bladeN = normalize(cross(sideTw, tangent) + sideTw * side * 1.1);
objectNormal = bladeN;
// near blades keep their own normals so back light reads as contrast; far
// away the lawn shades as one soft surface
// Blades narrower than a pixel or two cannot show their own sheen, glow or
// colour without turning into noise; they converge to the average lawn.
float pixels = w * projectionMatrix[1][1] * 0.5 * uViewHeight / max(dist, 0.1);
vCalm = max(1.0 - smoothstep(0.7, 2.5, pixels), smoothstep(18.0, 45.0, dist));
vUpBlend = mix(mix(0.12, 0.8, smoothstep(2.0, 26.0, dist)) * mix(0.5, 1.0, t), 0.9, vCalm);

float hueN = grassHash(seed * 3.71);
float valN = grassHash(seed * 7.13);
#ifdef GRASS_SIMPLE
float patchN = realmNoise(root.xz * 0.16 + 3.0);
#else
float patchN = realmNoise(root.xz * 0.16 + 3.0) * 0.6 + realmNoise(root.xz * 0.55 + 11.0) * 0.4;
#endif
vec3 cRoot = vec3(0.010, 0.026, 0.020);
vec3 cMid = mix(vec3(0.036, 0.105, 0.016), vec3(0.062, 0.130, 0.014), hueN);
// a few cooler, bluer blades among the yellow-greens
cMid = mix(cMid, vec3(0.028, 0.090, 0.034), step(0.78, grassHash(seed * 19.1)) * 0.8);
cMid = mix(cMid, vec3(0.085, 0.140, 0.020), smoothstep(0.45, 0.8, patchN) * 0.6);
vec3 cTip = mix(vec3(0.110, 0.230, 0.030), vec3(0.165, 0.255, 0.035), hueN);
cTip = mix(cTip, vec3(0.200, 0.250, 0.050), smoothstep(0.5, 0.85, patchN) * 0.5);
if (grassHash(seed * 13.3) < 0.035) {
  cMid = vec3(0.110, 0.115, 0.040);
  cTip = vec3(0.250, 0.215, 0.100);
}
vec3 col = mix(cRoot, cMid, smoothstep(0.0, 0.5, t));
col = mix(col, cTip, smoothstep(0.4, 1.0, t) * 0.85);
col *= 0.7 + 0.6 * valN * valN;
// gusts lay the blades over and turn their lit faces up: waves of lighter grass
col *= 1.0 + (gust * 0.25 + wave * 0.5) * windAmount * t;
vec3 calmCol = mix(cRoot, vec3(0.070, 0.150, 0.026), smoothstep(0.0, 0.5, t));
calmCol = mix(calmCol, vec3(0.120, 0.215, 0.036), smoothstep(0.4, 1.0, t) * 0.85);
// Patches a few metres across drift in hue and value the way a real lawn
// does; they live in both the near and the calm far colour, so the lawn seen
// from above is not one flat green.
float fieldA = realmNoise(root.xz * 0.28 + 21.0);
float fieldB = realmNoise(root.xz * 0.11 - 5.0);
vec3 field = mix(vec3(0.80, 0.95, 1.18), vec3(1.25, 1.08, 0.66), smoothstep(0.25, 0.75, fieldA));
field *= 0.7 + 0.6 * smoothstep(0.15, 0.85, fieldB);
field *= 1.0 - aTone.z * 0.45;
field = mix(field, field * vec3(1.45, 1.2, 0.68), aTone.x * 0.75);
col *= field;
calmCol *= field;
vec3 straw = vec3(0.30, 0.25, 0.12) * mix(0.55, 1.0, t);
float dryAmt = aTone.y * 0.65 * smoothstep(0.15, 0.9, t);
col = mix(col, straw, dryAmt);
calmCol = mix(calmCol, straw, dryAmt);
float headAmt = aTone.w * smoothstep(0.74, 0.84, t);
col = mix(col, vec3(0.20, 0.16, 0.09), headAmt);
calmCol = mix(calmCol, vec3(0.20, 0.16, 0.09), headAmt);
col = mix(col, calmCol * (1.0 + gust * windAmount * 0.12 * t), vCalm * 0.85);
vGrassColor = col;
vGrassT = t;
vGrassBlade = vec2(side * 2.0, seed);
vGrassAO = mix(0.18, 1.0, smoothstep(0.0, 0.75, t));
`

const FRAGMENT_PARS = /* glsl */ `
uniform vec3 uSunTint;
varying vec3 vGrassColor;
varying float vGrassT;
varying float vGrassAO;
varying float vUpBlend;
varying vec2 vGrassBlade;
varying float vCalm;
`

// Back light: sun seen through the blades (forward scattering) plus a little
// diffuse transmission, both after the shadow so blades in shade do not glow.
const TRANSLUCENCY = /* glsl */ `
void RE_Direct_Grass(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  float facing = saturate(dot(-geometryViewDir, directLight.direction));
  // a sheet seen face on passes more light than one seen edge on
  float sheet = 0.35 + 0.65 * abs(dot(geometryNormal, geometryViewDir));
  float scatter = (pow(facing, 16.0) * 1.8 + pow(facing, 4.0) * 0.12) * sheet;
  float through = saturate(-dot(geometryNormal, directLight.direction)) * 0.15;
  // tips and the thin margins pass the most light
  float thin = mix(0.15, 1.0, vGrassT * vGrassT) * (1.0 + smoothstep(0.6, 1.0, abs(vGrassBlade.x)) * 0.6);
  // light that passes through a leaf comes out deeper and more saturated than
  // the light it reflects
  vec3 trans = pow(material.diffuseColor, vec3(1.5)) * uSunTint;
  reflectedLight.directDiffuse += (scatter + through) * thin * (1.0 - vCalm * 0.85) * directLight.color * trans;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Grass
`

// A lighter fold along the midrib, slightly darker margins and faint veins, so
// a blade up close is not a flat ribbon.
const COLOR_FRAGMENT = /* glsl */ `
float grassAcross = abs(vGrassBlade.x);
float grassRib = 1.0 - smoothstep(0.0, 0.16, grassAcross);
float grassVeins = sin(vGrassBlade.x * 21.0 + vGrassBlade.y * 40.0) * 0.035;
diffuseColor.rgb *= vGrassColor * (1.0 + (grassRib * 0.14 + grassVeins - smoothstep(0.7, 1.0, grassAcross) * 0.12) * (1.0 - vCalm));
`

const NORMAL_FRAGMENT = /* glsl */ `
float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
vec3 normal = dot(vNormal, vNormal) > 1e-12 ? normalize(vNormal) * faceDirection : vec3(0.0, 0.0, 1.0);
vec3 grassUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
// the back of a blade seen from above must not face the ground
normal -= grassUp * min(dot(normal, grassUp), 0.0) * 1.2;
normal = normalize(mix(normal, grassUp, vUpBlend) + grassUp * 1e-3);
vec3 nonPerturbedNormal = normal;
`

export class Grass implements RealmPart {
  readonly object = new THREE.Group()
  private readonly material: THREE.MeshStandardMaterial
  private readonly tiles: Tile[] = []
  private readonly settings: TierSettings
  private readonly pointer = { value: new THREE.Vector4(0, -100, 0, 0) }
  private readonly fade: { value: THREE.Vector2 }
  private readonly viewHeight = { value: 1080 }
  private readonly bufferSize = new THREE.Vector2()
  private readonly pointerTarget = new THREE.Vector3()
  private pointerActive = 0
  private pointerSeen = false
  private readonly shared: ReturnType<typeof bladeGeometry>

  constructor(opts: { tier: Tier; tiles?: GrassTile[] }) {
    this.settings = TIERS[opts.tier]
    this.object.name = 'grass'
    this.fade = { value: new THREE.Vector2(this.settings.fadeStart, this.settings.fadeEnd) }
    this.shared = bladeGeometry(this.settings.segments, this.settings.strips)
    this.material = this.createMaterial(opts.tier === 'phone')
    this.build(opts.tiles ?? grassTiles(opts.tier))
  }

  // The ground point under the cursor, or null when there is none; blades
  // within about 0.8 m lean away from it.
  setPointer(point: THREE.Vector3 | null): void {
    if (point) {
      if (!this.pointerSeen) this.pointer.value.set(point.x, point.y, point.z, this.pointer.value.w)
      this.pointerTarget.copy(point)
      this.pointerSeen = true
    } else {
      this.pointerSeen = false
    }
  }

  update(frame: Frame): void {
    const k = 1 - Math.exp(-frame.dt * 5)
    this.pointerActive += ((this.pointerSeen ? 1 : 0) - this.pointerActive) * k
    const p = this.pointer.value
    const kp = 1 - Math.exp(-frame.dt * 14)
    if (this.pointerSeen) {
      p.x += (this.pointerTarget.x - p.x) * kp
      p.y += (this.pointerTarget.y - p.y) * kp
      p.z += (this.pointerTarget.z - p.z) * kp
    }
    p.w = this.pointerActive * frame.motion

    const cam = frame.camera.position
    const end = this.settings.fadeEnd
    for (const tile of this.tiles) {
      tile.mesh.visible = tile.center.distanceTo(cam) - tile.radius < end
    }
  }

  // blade size in pixels needs the drawing buffer height, which only the
  // renderer knows
  private readonly readViewHeight = (renderer: THREE.WebGLRenderer) => {
    this.viewHeight.value = renderer.getDrawingBufferSize(this.bufferSize).y
  }

  dispose(): void {
    for (const tile of this.tiles) {
      tile.geometry.dispose()
      this.object.remove(tile.mesh)
    }
    this.tiles.length = 0
    this.material.dispose()
  }

  private createMaterial(simple: boolean): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0,
      side: THREE.DoubleSide,
    })
    const pointer = this.pointer
    const fade = this.fade
    const sunTint = { value: new THREE.Color(5.0, 4.6, 1.6) }
    const viewHeight = this.viewHeight
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = realmUniforms.uTime
      shader.uniforms.uWind = realmUniforms.uWind
      shader.uniforms.uGust = realmUniforms.uGust
      shader.uniforms.uPointer = pointer
      shader.uniforms.uFade = fade
      shader.uniforms.uSunTint = sunTint
      shader.uniforms.uViewHeight = viewHeight
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n${VERTEX_MAIN}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = grassWorld - grassTile;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAGMENT_PARS}`)
        .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>\n${TRANSLUCENCY}`)
        .replace('#include <color_fragment>', COLOR_FRAGMENT)
        .replace('#include <normal_fragment_begin>', NORMAL_FRAGMENT)
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
          reflectedLight.indirectDiffuse *= vGrassAO;
          reflectedLight.indirectSpecular *= vGrassAO * vGrassAO * 0.45;
          reflectedLight.directDiffuse *= mix(0.45, 1.0, vGrassAO);
          reflectedLight.directSpecular *= vGrassAO * (1.0 - vCalm * 0.9);
          reflectedLight.indirectSpecular *= 1.0 - vCalm * 0.7;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `// no single blade may outshine the lawn: a cap on brightness keeps
          // bloom from catching tips, and a broken value never reaches the post chain
          if (any(isnan(outgoingLight)) || any(isinf(outgoingLight))) outgoingLight = vec3(0.0);
          outgoingLight = max(outgoingLight, vec3(0.0));
          float grassLum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          outgoingLight *= min(1.0, mix(1.2, 0.55, vCalm) / max(grassLum, 1e-5));
          #include <opaque_fragment>`,
        )
    }
    // phones skip the second patch octave and the second flutter axis
    if (simple) material.defines = { GRASS_SIMPLE: '' }
    material.customProgramCacheKey = () => (simple ? 'realm-grass-simple' : 'realm-grass')
    return material
  }

  private build(tiles: GrassTile[]): void {
    for (const t of tiles) {
      const geometry = new THREE.InstancedBufferGeometry()
      geometry.setIndex(this.shared.index)
      geometry.setAttribute('position', this.shared.position)
      geometry.setAttribute('normal', this.shared.normal)
      geometry.setAttribute('aRoot', new THREE.InstancedBufferAttribute(t.roots.subarray(0, t.count * 4), 4))
      geometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(t.shapes.subarray(0, t.count * 4), 4))
      geometry.setAttribute('aTone', new THREE.InstancedBufferAttribute(t.tones.subarray(0, t.count * 4), 4))
      geometry.instanceCount = t.count
      const bounds = new THREE.Box3(new THREE.Vector3(t.box[0], t.box[1], t.box[2]), new THREE.Vector3(t.box[3], t.box[4], t.box[5]))
      geometry.boundingBox = bounds
      geometry.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere())
      const mesh = new THREE.Mesh(geometry, this.material)
      mesh.onBeforeRender = this.readViewHeight
      mesh.position.set(t.centre[0], t.centre[1], t.centre[2])
      mesh.castShadow = false
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      this.object.add(mesh)
      const center = geometry.boundingSphere.center.clone().add(mesh.position)
      this.tiles.push({ mesh, geometry, center, radius: geometry.boundingSphere.radius })
    }
  }
}

export function grassTiles(tier: Tier): GrassTile[] {
  const s = TIERS[tier]
  const size = s.tile
  const x0 = -ISLAND_RX * 1.2
  const z0 = -ISLAND_RZ * 1.2
  const nx = Math.ceil((ISLAND_RX * 2.4) / size)
  const nz = Math.ceil((ISLAND_RZ * 2.4) / size)

  // The visitor stays on the path, so the lawn near it gets more of the
  // budget than the far margins.
  // density by distance from the walk (the path from the landing up to the
  // shrine), which is where the camera always is; phones spend nearly all
  // of their blades in the first metres beside it and thin the rest out
  const bias = (x: number, z: number) => {
    const wz = Math.max(-16, Math.min(23, z))
    const d = Math.hypot(x, z - wz)
    // the pond and the cherry are looked at from the walk across 5 to 9 m,
    // so their surroundings count as near too
    const pond = 1 - smooth(3.0, 4.5, pondSdf(x, z))
    const cherry = 1 - smooth(4.0, 6.0, Math.hypot(x - CHERRY.x, z - CHERRY.z))
    const far = smooth(s.near[0], s.near[1], d) * (1 - Math.max(pond, cherry))
    // the far sides and back corners are only ever seen from a distance
    const remote = Math.max(smooth(9, 12, x), smooth(-11, -14, z) * smooth(7, 10, Math.abs(x)))
    const open = 1 - smooth(4.5, 7.5, Math.hypot(x - OPENING.x, z - OPENING.z))
    return (1 - (1 - s.focus) * far) * (1 - remote * (1 - s.focus) * 0.65) * (1 + (s.landing - 1) * open)
  }

  // lawnWeight on a 10 cm grid, and beside it the distance to the nearest
  // ground without grass, so every border (path, gravel, the terrace wall,
  // the water) can fade the lawn out over the same width
  const cell = 0.1
  const gx = Math.ceil((nx * size) / cell) + 2
  const gz = Math.ceil((nz * size) / cell) + 2
  const lawn = new Float32Array(gx * gz)
  const edge = new Float32Array(gx * gz)
  for (let iz = 0; iz < gz; iz++) {
    for (let ix = 0; ix < gx; ix++) {
      const i = iz * gx + ix
      const w = lawnWeight(x0 + ix * cell, z0 + iz * cell)
      lawn[i] = w
      edge[i] = w < 0.35 ? 0 : 1e3
    }
  }
  const diag = cell * Math.SQRT2
  for (let iz = 1; iz < gz; iz++) {
    for (let ix = 1; ix < gx - 1; ix++) {
      const i = iz * gx + ix
      edge[i] = Math.min(edge[i], edge[i - 1] + cell, edge[i - gx] + cell, edge[i - gx - 1] + diag, edge[i - gx + 1] + diag)
    }
  }
  for (let iz = gz - 2; iz >= 0; iz--) {
    for (let ix = gx - 2; ix > 0; ix--) {
      const i = iz * gx + ix
      edge[i] = Math.min(edge[i], edge[i + 1] + cell, edge[i + gx] + cell, edge[i + gx + 1] + diag, edge[i + gx - 1] + diag)
    }
  }
  const sample = (grid: Float32Array, x: number, z: number) => {
    const fx = Math.max(0, Math.min(gx - 1.001, (x - x0) / cell))
    const fz = Math.max(0, Math.min(gz - 1.001, (z - z0) / cell))
    const ix = Math.floor(fx)
    const iz = Math.floor(fz)
    const tx = fx - ix
    const tz = fz - iz
    const i = iz * gx + ix
    const a = grid[i] + (grid[i + 1] - grid[i]) * tx
    const b = grid[i + gx] + (grid[i + gx + 1] - grid[i + gx]) * tx
    return a + (b - a) * tz
  }
  // 0 at a border, 1 from 0.45 m into the lawn
  const inset = (x: number, z: number) => smooth(0.0, 0.45, sample(edge, x, z))

  const weights = new Float32Array(nx * nz)
  let total = 0
  const step = 0.5
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      let w = 0
      for (let sz = step / 2; sz < size; sz += step) {
        for (let sx = step / 2; sx < size; sx += step) {
          const x = x0 + ix * size + sx
          const z = z0 + iz * size + sz
          w += sample(lawn, x, z) * bias(x, z) * (1 + longness(x, z))
        }
      }
      weights[iz * nx + ix] = w
      total += w
    }
  }
  if (total <= 0) return []

  const rand = rng(0x6a55)
  const tiles: GrassTile[] = []
  const bounds = new THREE.Box3()
  const sphere = new THREE.Sphere()

  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const tw = weights[iz * nx + ix]
      if (tw <= 0) continue
      const target = Math.round((s.blades * tw) / total)
      if (target < 8) continue
      const tx = x0 + ix * size
      const tz = z0 + iz * size
      const cx = tx + size / 2
      const cz = tz + size / 2
      const cy = groundHeight(cx, cz)
      const roots = new Float32Array(target * 4)
      const shapes = new Float32Array(target * 4)
      const tones = new Float32Array(target * 4)
      let n = 0
      let tries = 0
      bounds.makeEmpty()
      while (n < target && tries < target * 40) {
        tries++
        const px = tx + rand() * size
        const pz = tz + rand() * size
        const lw = sample(lawn, px, pz)
        const long = longness(px, pz)
        // the long margins are let grow full, even where the lawn thins
        if (lw <= 0.02 || rand() > Math.min(1, lw * (1 + 1.5 * long)) * bias(px, pz)) continue
        // the rare loose clump left standing in the mown lawn
        const clump = rand() < 0.006
        const loose = Math.max(long, clump ? 0.65 + rand() * 0.35 : 0)
        // mown height drifts a little across the lawn, as real mowing does
        // worn, shorter grass along the path edges and under the trees
        const shade = wornness(px, pz)
        const kerb = (1 - smooth(0.0, 1.1, sample(edge, px, pz))) * (1 - long)
        const wear = Math.max(shade, kerb)
        // darker, denser clumps; the rest of the tile gives way to them
        const dark = smooth(0.55, 0.7, fbm2(px * 0.7 - 3.3, pz * 0.7 + 8.8, 2)) * (1 - wear)
        // the shade under the trees thins the grass a little; worn path edges stay full but short
        if (rand() > (0.75 + 0.25 * dark) * (1 - 0.1 * shade)) continue
        const patchH = 0.8 + 0.45 * fbm2(px * 0.3 + 12.1, pz * 0.3 - 6.4, 2)
        const mown = (0.06 + 0.045 * fbm2(px * 0.6 + 7.3, pz * 0.6 - 2.1, 2) + rand() * 0.025) * patchH * (1 - 0.45 * kerb) * (1 - 0.15 * shade) * (1 + 0.15 * dark) * (1 + (s.cover - 1) * 0.4)
        const tuftHeight = mown + (0.25 + rand() * 0.22 - mown) * loose
        // most blades grow in small tufts that splay outwards; where an
        // instance already draws a tuft, roots spread evenly instead
        const tufted = s.strips > 1 ? 0.15 : 0.7
        let tuft = rand() < tufted ? 2 + Math.floor(rand() * (s.strips > 1 ? 2 : 5)) : 1
        if (clump) tuft = Math.ceil((5 + rand() * 6) / s.strips)
        else if (loose > 0.4) tuft = Math.max(tuft, Math.ceil((4 + rand() * 4) / s.strips))
        const spread = (0.025 + rand() * 0.05) * (1 + loose)
        // a hint of straw in the long fringe, and the odd seed head
        const dry = loose > 0.4 && rand() < 0.35 ? (0.4 + 0.6 * rand()) * loose : 0
        for (let b = 0; b < tuft && n < target; b++) {
          const a = rand() * Math.PI * 2
          const r = tuft === 1 ? 0 : spread * Math.sqrt(rand())
          const bx = Math.min(tx + size, Math.max(tx, px + Math.cos(a) * r))
          const bz = Math.min(tz + size, Math.max(tz, pz + Math.sin(a) * r))
          const bw = tuft === 1 ? lw : sample(lawn, bx, bz)
          // towards every border the lawn thins and shortens instead of
          // stopping at full height
          const fade = inset(bx, bz)
          if (bw <= 0.02 || rand() > Math.min(1, bw * (1 + 1.5 * long)) * (0.2 + 0.8 * fade)) continue
          const by = groundHeight(bx, bz) - 0.012
          const height = Math.min(0.5, tuftHeight * (0.75 + rand() * 0.5) * (0.35 + 0.65 * fade))
          const yaw = tuft === 1 ? rand() * Math.PI * 2 : a + (rand() - 0.5) * 1.2
          const width = (0.0055 + rand() * 0.0045) * (1 + height * 1.6) * (1 + loose * 0.3) * s.widen * (s.cover + (1 - s.cover) * loose)
          const head = loose > 0.55 && rand() < 0.07 ? 1 : 0
          const bendAmt = (0.1 + rand() * 0.3 + loose * 0.35) * (head ? 0.45 : 1)
          const i = n * 4
          roots[i] = bx - cx
          roots[i + 1] = by - cy
          roots[i + 2] = bz - cz
          roots[i + 3] = yaw
          shapes[i] = head ? Math.min(0.55, height * 1.15) : height
          shapes[i + 1] = width
          shapes[i + 2] = bendAmt
          shapes[i + 3] = rand()
          tones[i] = wear
          tones[i + 1] = dry
          tones[i + 2] = dark
          tones[i + 3] = head
          bounds.expandByPoint(sphere.center.set(roots[i], roots[i + 1], roots[i + 2]))
          n++
        }
      }
      if (n === 0) continue
      // room for the tallest blade and its sway in every direction
      bounds.expandByVector(sphere.center.set(0.6, 0.6, 0.6))
      tiles.push({ roots, shapes, tones, count: n, box: [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z], centre: [cx, cy, cz] })
    }
  }
  return tiles
}
