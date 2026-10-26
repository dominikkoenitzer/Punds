import * as THREE from 'three'
import { realmUniforms } from '../atmosphere'
import { LANTERNS, POND_BOUNDS, POND_LEVEL, groundHeight, pondSdf } from '../layout'
import type { Frame, Tier } from '../types'
import type { CascadeDress } from '../cascade'
import { light } from './light'
import { hallow } from './state'

// The pond at night: the water turned to blood, the koi to bone.

export interface PondDress {
  // the ripple simulation's fragment shader, rewritten
  sim(fragment: string): string
  // the water's material, before it first compiles
  water(material: THREE.ShaderMaterial): void
  // the wet ring on the banks
  wet(fragment: string): string
  // the koi's program, after the living koi's own changes, and their mesh
  koi(shader: THREE.WebGLProgramParametersWithUniforms): void
  koiMesh(mesh: THREE.InstancedMesh): void
  koiKey: string
  // each frame: the moon's light on the pond and the rain on it
  update(frame: Frame, tier: Tier, drop: (x: number, z: number, radius: number, strength: number) => void): void
}

function patch(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error('pond dress: shader moved near ' + from.slice(0, 48))
  return src.replace(from, to)
}

// replaces everything from the start of `from` to the end of `to`
function patchSpan(src: string, from: string, to: string, by: string): string {
  const a = src.indexOf(from)
  const b = a < 0 ? -1 : src.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error('pond dress: shader moved near ' + from.slice(0, 48))
  return src.slice(0, a) + by + src.slice(b + to.length)
}

// the water shader's light was set for a sun of 13 at a radiance of 3
const KEY_TO_RADIANCE = 3 / 13

// Blood is thick: rings spread slower and settle sooner than on water.
function sim(fragment: string): string {
  return patch(fragment, 'float h = (2.0 * c.r - c.g + 0.16 * lap) * 0.988;', 'float h = (2.0 * c.r - c.g + 0.12 * lap) * 0.981;')
}

const moonRadiance = new THREE.Vector3()
let watered = false

function water(material: THREE.ShaderMaterial): void {
  let f = material.fragmentShader
  // the surface moves at the pace of a heavy liquid
  f = patch(f, 'uniform float uTime;', 'uniform float uTimeSrc;\n#define uTime (uTimeSrc * 0.5)')
  // the wind barely stirs it; the rings and the koi still do
  f = patch(f, 'vec2 grad = simGrad * 2.5 + still;', 'vec2 grad = simGrad * 2.3 + still * 0.45;')
  // a glossy liquid a little denser than water
  f = patch(f, 'float F = 0.015 + 0.985 * pow(1.0 - cosV, 6.0);', 'float F = 0.022 + 0.978 * pow(1.0 - cosV, 5.0);')
  // Barely translucent: the bed never shows, even in the shallows. The koi
  // are drawn over the surface afterwards and fade by their own depth.
  f = patch(f, 'float T = exp(-path * 4.6) * mix(1.0, 0.5, smoothstep(0.02, 0.14, bed));', 'float T = exp(-3.2 / cosT);')
  // light scattered back out of the liquid is a deep red; thin films at the
  // bank glow a little brighter
  f = patch(f, 'vec3 albedo = mix(uDeep, uShallow, exp(-bed * 3.5));', 'vec3 albedo = mix(uDeep, uShallow, exp(-bed * 7.0));')
  // the moon's glint, small and red, with a soft sheen around it; never a
  // white spark, even where a ripple faces it squarely
  f = patch(f, 'float spec = pow(nh, 1400.0) * 80.0 + pow(nh, 260.0) * 0.5;', 'float spec = pow(nh, 900.0) * 6.0 + pow(nh, 200.0) * 0.15;')
  f = patch(f, 'vec3 sun = uSunColor * spec * F * 4.0;', 'vec3 sun = min(uSunColor * vec3(1.0, 0.3, 0.2) * spec * F * 4.0, vec3(1.5, 0.45, 0.3));')
  // it thins and darkens against the bank, where it has stained the stone
  f = patch(
    f,
    'gl_FragColor = vec4(col * edge, alpha * edge);',
    'col *= mix(0.6, 1.0, smoothstep(0.05, -0.3, sdf));\n  gl_FragColor = vec4(col * edge, alpha * edge);',
  )
  material.fragmentShader = f
  const u = material.uniforms
  u.uTimeSrc = realmUniforms.uTime
  u.uSunColor = { value: moonRadiance }
  u.uSkyColor = { value: new THREE.Vector3(0.1, 0.05, 0.08) }
  u.uShallow = { value: new THREE.Vector3(0.16, 0.007, 0.006) }
  u.uDeep = { value: new THREE.Vector3(0.055, 0.0022, 0.0018) }
  watered = true
}

// the banks it touches are stained a dark rust
function wet(fragment: string): string {
  return patch(fragment, 'gl_FragColor = vec4(vec3(mix(1.0, 0.68, vWet)), 1.0);', 'gl_FragColor = vec4(mix(vec3(1.0), vec3(0.56, 0.36, 0.33), vWet), 1.0);')
}

// The skeleton, drawn on the koi's own surface in body coordinates: kp is
// the rest position (nose at x 0.5, tail root at -0.5, y up), b runs from
// the nose (0) to the tail root (1) and on to the tail tip. Seen from above
// through the liquid, the bones read as if inside a faint veil of flesh.
const KOI_SURFACE = /* glsl */ `float seed = vLook.y * 37.0;
vec3 kp = vKoiPos;
float fin = vKoiInfo.y;
float root = vKoiInfo.z;
float b = vKoiInfo.x;
// around the body's axis: 0 along the back, pi under the belly
float ang = abs(atan(kp.z, kp.y - 0.012));
float bone = 0.0;
float shade = 1.0;
float hole = 0.0;
if (fin < 0.5) {
  // the skull, its back edge the curve of the gill cover
  float skullEdge = 0.2 + 0.03 * cos(ang * 0.9);
  float skull = 1.0 - smoothstep(skullEdge - 0.005, skullEdge + 0.005, b);
  // eye sockets high on the sides, a seam where the jaw closes
  float eyeR = length(vec2((b - 0.085) / 0.032, (ang - 1.15) / 0.4));
  float socket = 1.0 - smoothstep(0.75, 1.0, eyeR);
  float socketRim = smoothstep(0.8, 1.0, eyeR) * (1.0 - smoothstep(1.0, 1.35, eyeR));
  float jawD = abs(ang - 2.05);
  float jaw = (1.0 - smoothstep(0.0, kLine(ang, 0.05), jawD)) * (1.0 - smoothstep(0.1, 0.15, b));
  // the cheek plates and the brow, a little uneven like old bone
  float plates = kNoise3(kp * vec3(30.0, 34.0, 34.0) + seed);
  float gill = 1.0 - smoothstep(0.0, kLine(b, 0.006), abs(b - skullEdge + 0.035));
  shade = 0.8 + 0.22 * plates - 0.4 * jaw + 0.18 * socketRim - 0.25 * gill * step(0.6, ang);
  hole = socket * skull;
  // the spine along the back, one vertebra after another
  float vb = b / 0.03;
  float joint = abs(fract(vb) - 0.5) * 2.0;
  float spineW = mix(0.32, 0.16, smoothstep(0.2, 1.0, b));
  float spineAa = kLine(ang, 0.0);
  float spine = (1.0 - smoothstep(spineW - spineAa, spineW + spineAa, ang)) * smoothstep(0.17, 0.2, b) * (1.0 - smoothstep(0.97, 1.01, b));
  spine *= 0.6 + 0.4 * smoothstep(0.1, 0.45, joint);
  // ribs curve down the flanks and sweep back, open under the belly
  float sweep = pow(ang / 3.14159, 1.3);
  float rb = (b - 0.23 + 0.07 * sweep) / 0.036;
  float ribD = abs(fract(rb + 0.5) - 0.5) * 0.036;
  float ribW = mix(0.0034, 0.002, sweep);
  float cage = step(-0.5, rb) * (1.0 - smoothstep(10.5, 11.0, rb));
  float ribLen = mix(2.6, 1.9, smoothstep(0.0, 11.0, rb));
  float ribAa = kLine(rb * 0.036, 0.0);
  float ribs = (1.0 - smoothstep(ribW - ribAa, ribW + ribAa, ribD)) * cage * smoothstep(0.15, 0.3, ang) * (1.0 - smoothstep(ribLen - 0.12, ribLen, ang));
  // each rib is a round rod: bright along its crest, falling off to its sides
  float ribRound = sqrt(max(1.0 - (ribD * ribD) / (ribW * ribW), 0.0));
  shade *= mix(1.0, 0.55 + 0.6 * ribRound, ribs);
  // the back of the cage stands nearest the moon; the flanks fall into shade
  shade *= 0.72 + 0.42 * cos(ang * 0.55);
  // behind the cage the vertebrae carry fine spines above and below
  float tb = (b - 0.63 + 0.03 * ang) / 0.03;
  float tD = abs(fract(tb + 0.5) - 0.5) * 0.03;
  float tAa = kLine(tb * 0.03, 0.0);
  float tails = (1.0 - smoothstep(0.002 - tAa, 0.002 + tAa, tD)) * step(0.0, tb) * (1.0 - smoothstep(0.95, 1.0, b));
  tails *= max(1.0 - smoothstep(0.75, 1.0, ang), smoothstep(2.25, 2.5, ang));
  bone = max(max(skull, spine), max(ribs, tails));
} else {
  // the fins are bare rays, the webbing between them all but gone
  float rc;
  if (fin < 1.5) rc = (kp.y - 0.012) / (0.02 + root * 0.19) * 9.0;
  else if (fin < 2.5) rc = kp.x * 95.0;
  else rc = (kp.x - kp.z) * 80.0;
  float rd = abs(fract(rc + 0.5) - 0.5);
  float rw = mix(0.15, 0.07, root);
  float rAa = kLine(rc, 0.0);
  bone = (1.0 - smoothstep(rw - rAa, rw + rAa, rd)) * (1.0 - smoothstep(0.82, 1.0, root));
  shade = 0.92 - 0.12 * root;
}
vec3 boneCol = vec3(0.84, 0.8, 0.7) * shade;
vec3 veil = vec3(0.2, 0.1, 0.09);
vec3 body = mix(veil, boneCol, bone);
body = mix(body, vec3(0.02, 0.01, 0.008), hole);
diffuseColor.rgb = body;
// the surface drawn beneath keeps a faint share, so its reflection lies over the bone
diffuseColor.a = mix(fin < 0.5 ? 0.05 : 0.02, 0.8, max(bone, hole));
float koiMetal = 0.0;
float koiScale = bone;`

// polished old bone, a little rougher than the living scales; the veil is wet
const KOI_ROUGHNESS = /* glsl */ `float roughnessFactor = mix(0.28, 0.5, koiScale);`

// the lanterns on the pond's side of the path warm the bone
const NEAR_LANTERNS = LANTERNS.filter((l) => l.x < 0 && l.z > POND_BOUNDS.zMin - 4 && l.z < POND_BOUNDS.zMax + 4)
const lanternColor = new THREE.Vector3(1.0, 0.5, 0.18).multiplyScalar(2.2)

const KOI_COMMON = /* glsl */ `
uniform vec3 uLanterns[${NEAR_LANTERNS.length}];
uniform vec3 uLanternColor;
varying float vKoiDepth;
// a line width that never thins below a pixel, so far bones fade instead of crawling
float kLine(float v, float w) { return w + fwidth(v) * 1.1; }`

const KOI_LANTERNS = NEAR_LANTERNS.map(
  (_, i) => /* glsl */ `{
  vec3 lv = (viewMatrix * vec4(uLanterns[${i}], 1.0)).xyz + vViewPosition;
  float ld = length(lv);
  float wrap = clamp((dot(normal, lv / ld) + 0.4) / 1.4, 0.0, 1.0);
  reflectedLight.directDiffuse += uLanternColor * diffuseColor.rgb * wrap / (1.0 + ld * ld);
}`,
).join('\n')

function koi(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uLanterns = { value: NEAR_LANTERNS.map((l) => new THREE.Vector3(l.x, groundHeight(l.x, l.z) + 1.29, l.z)) }
  shader.uniforms.uLanternColor = { value: lanternColor }
  let v = shader.vertexShader
  v = patch(v, 'varying vec2 vLook;', 'varying vec2 vLook;\nvarying float vKoiDepth;')
  // The koi are drawn after the surface, so each point moves along its own
  // line of sight to just above the water: it keeps its place on screen and
  // its order in depth, and passes the surface's depth while the banks in
  // front still hide it. The mirrored view from below is left alone.
  v = patch(
    v,
    '#include <project_vertex>',
    `vec4 koiWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
vKoiDepth = ${POND_LEVEL.toFixed(3)} - koiWorld.y;
#include <project_vertex>
if (cameraPosition.y > ${POND_LEVEL.toFixed(3)}) {
  vec3 toCam = cameraPosition - koiWorld.xyz;
  float lift = vKoiDepth + 0.02 + 0.05 * clamp(1.0 - vKoiDepth / 0.6, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(koiWorld.xyz + toCam * clamp(lift / max(toCam.y, 1e-3), 0.0, 1.0), 1.0);
}`,
  )
  shader.vertexShader = v
  let f = shader.fragmentShader
  f = patch(f, 'varying vec2 vLook;', 'varying vec2 vLook;' + KOI_COMMON)
  f = patchSpan(f, 'float variety = vLook.x;', 'float koiScale = scaleRnd;', KOI_SURFACE)
  f = patchSpan(f, 'float roughnessFactor = roughness *', 'if (fin > 0.5) roughnessFactor = 0.45;', KOI_ROUGHNESS)
  // the lantern light wraps the bone softly
  f = patch(f, '#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + KOI_LANTERNS)
  // Seen through the blood, which lets red through longest: a koi just under
  // the skin keeps its pale bone, a hand deeper it turns red, and deeper
  // still it sinks into the liquid's own dark red rather than to black.
  f = patch(
    f,
    '#include <opaque_fragment>',
    `float koiUnder = max(vKoiDepth, 0.0);
outgoingLight *= exp(-koiUnder * vec3(0.4, 9.0, 10.5));
outgoingLight = mix(outgoingLight, vec3(0.07, 0.003, 0.0025), 1.0 - exp(-koiUnder * 3.5));
diffuseColor.a *= exp(-koiUnder * 5.0);
#include <opaque_fragment>`,
  )
  shader.fragmentShader = f
}

// drawn after the water and blended, so the bone shows through it smoothly
function koiMesh(mesh: THREE.InstancedMesh): void {
  const m = mesh.material as THREE.MeshPhysicalMaterial
  m.alphaHash = false
  m.transparent = true
  mesh.renderOrder = 2
}

// Rain on the pond: a drop now and then at random, fewer on a phone. The
// gaps are drawn at random so the drops never fall in a beat.
let rainClock = 0
let nextDrop = -1

function update(frame: Frame, tier: Tier, drop: (x: number, z: number, radius: number, strength: number) => void): void {
  if (watered) {
    // the moon's light on the liquid follows the key light through each flash
    const k = light.keyIntensity * KEY_TO_RADIANCE
    moonRadiance.set(light.keyColor.r * k, light.keyColor.g * k, light.keyColor.b * k)
  }
  const rate = (tier === 'phone' ? 1.5 : 4) * hallow.uRain.value
  rainClock += frame.dt
  if (frame.motion === 0 || rate <= 0) {
    nextDrop = -1
    return
  }
  if (nextDrop < 0) nextDrop = rainClock - Math.log(1 - Math.random()) / rate
  for (let n = 0; n < 3 && rainClock >= nextDrop; n++) {
    nextDrop += -Math.log(1 - Math.random()) / rate
    for (let tries = 0; tries < 6; tries++) {
      const x = POND_BOUNDS.xMin + Math.random() * (POND_BOUNDS.xMax - POND_BOUNDS.xMin)
      const z = POND_BOUNDS.zMin + Math.random() * (POND_BOUNDS.zMax - POND_BOUNDS.zMin)
      if (pondSdf(x, z) > -0.2) continue
      const big = Math.random()
      // the phone's coarser simulation needs a wider drop to ring cleanly
      drop(x, z, (tier === 'phone' ? 0.14 : 0.08) + big * 0.04, 0.006 + big * 0.008)
      break
    }
  }
  // after a long pause (a hidden tab) the missed drops do not pour at once
  if (rainClock > nextDrop) nextDrop = rainClock
}

// The cascade runs with it: dark red, under the moon, its froth a little
// paler than the pool and never white.
export const cascade: CascadeDress = {
  uniforms(u) {
    u.uSunColor.value = moonRadiance
    u.uSkyColor.value = new THREE.Vector3(0.1, 0.05, 0.08)
    u.uBody.value = new THREE.Vector3(0.16, 0.007, 0.006)
    u.uFoam.value = new THREE.Vector3(0.22, 0.02, 0.017)
    u.uPace.value = 0.6
  },
}

// what the pond wears (read by Pond)
export const pond: PondDress = {
  sim,
  water,
  wet,
  koi,
  koiMesh,
  koiKey: 'realm-koi-bone',
  update,
}
