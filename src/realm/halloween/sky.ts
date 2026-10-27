import * as THREE from 'three'
import { realmUniforms } from '../atmosphere'
import type { SkyDress } from '../season'
import { FACE, FACE_GLSL } from './face'
import { hallow } from './state'

// The night sky over the island: the photographed sky regraded, stars and
// the blood moon.
//
// The grade keeps the photograph's clouds as dark forms against a deep
// violet sky, with a red-orange glow along the horizon under the moon. It is
// written twice, once in GLSL for every shader that looks the sky up and once
// in TypeScript for the image light, and the two must stay the same.

// the moon's radius in radians: far larger than the real one, so it rules the
// sky low over the cloud sea
export const MOON_RADIUS = 0.058
const R = MOON_RADIUS.toFixed(4)

// Seen from the path, the cherry hides the whole sky around the light's own
// bearing, so the disc stands further right and a touch lower: it peeks in
// at the left edge of the first view, and a short turn to the left finds it
// whole, low over the cloud sea between the blossoms and the shrine. The
// light keeps the sun's place, so the shadows keep their composition; from
// here both still come from the front left.
const DISC_TURN = -0.5
const DISC_RISE = -0.02
const UP = new THREE.Vector3(0, 1, 0)
const disc = new THREE.Vector3()
const side = new THREE.Vector3()
export function discDirection(): THREE.Vector3 {
  disc.copy(hallow.uMoonDir.value).applyAxisAngle(UP, DISC_TURN)
  side.crossVectors(disc, UP).normalize()
  return disc.applyAxisAngle(side, DISC_RISE).normalize()
}

// how much the moon's flame may breathe, set by the light each frame from the motion setting
export const moonFlame = { uMoonMotion: { value: 1 } }

const GRADE_GLSL = /* glsl */ `
// where the photographed sun stood (the light's direction), and the moon
uniform vec3 uSkyMoonDir;
uniform vec3 uSkyMoonDisc;
// how cloudy the photograph is there: its brightness over the clear sky's,
// which is known from its height and the sun; a cloud is brighter
float nightCover(vec3 col, vec3 dir) {
  float ah = min(abs(dir.y), 1.0);
  float m = max(dot(dir, uSkyMoonDir), 0.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float m2 = m * m;
  float m8 = m2 * m2 * m2 * m2;
  float clear = 0.32 + 0.7 * pow(1.0 - ah, 1.6) + 1.4 * m8;
  return l / clear;
}
vec3 dressSky(vec3 col, vec3 dir) {
  float ah = min(abs(dir.y), 1.0);
  float m = max(dot(dir, uSkyMoonDisc), 0.0);
  float r = nightCover(col, dir);
  float cover = smoothstep(1.1, 2.4, r) * 0.88;
  // deep indigo overhead, a dusky violet band at the horizon
  float up = pow(smoothstep(0.0, 0.7, ah), 0.8);
  vec3 sky = mix(vec3(0.046, 0.02, 0.05), vec3(0.008, 0.008, 0.03), up);
  // the glow under the moon spreads wide along the horizon and low
  vec2 toward = normalize(uSkyMoonDisc.xz);
  float az = dot(dir.xz, toward) / max(length(dir.xz), 1e-4);
  float wide = az * 0.5 + 0.5;
  wide *= wide;
  sky += vec3(0.2, 0.03, 0.01) * wide * wide * exp(-ah * 14.0);
  float m4 = m * m * m * m;
  float m24 = m4 * m4 * m4;
  m24 *= m24;
  sky += vec3(0.6, 0.08, 0.02) * m24 * 0.16;
  // the photograph's own grain, kept faintly in the clear sky
  sky *= 0.8 + 0.2 * min(r, 2.0);
  // the clouds stand dark against it, only those near the moon catching a
  // red rim
  float form = clamp((r - 1.0) / 2.5, 0.0, 1.0);
  float m12 = m4 * m4 * m4;
  vec3 lit = vec3(0.22, 0.05, 0.026) * m12 + vec3(0.022, 0.015, 0.034);
  vec3 cloud = sky * 0.35 + lit * form * sqrt(form);
  return mix(sky, cloud, cover);
}
`

const DOME_GLSL = /* glsl */ `
vec3 nightHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float nightNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = nightHash(vec3(i, 7.0)).x;
  float b = nightHash(vec3(i + vec2(1.0, 0.0), 7.0)).x;
  float c = nightHash(vec3(i + vec2(0.0, 1.0), 7.0)).x;
  float d = nightHash(vec3(i + vec2(1.0, 1.0), 7.0)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// one layer of stars: at most one per cell of a grid around the camera, each
// drawn as a soft spot at least a pixel wide, so it never shimmers as the
// view sways; a smaller pixel only makes it finer, not brighter
vec3 nightStarLayer(vec3 dir, float px, float cells, float share, float size, float bright) {
  vec3 cell = floor(dir * cells);
  vec3 h = nightHash(cell);
  if (h.x > share) return vec3(0.0);
  vec3 star = normalize(cell + 0.3 + 0.4 * nightHash(cell + 17.0));
  vec3 o = dir - star;
  float s = max(size, px * 0.85);
  float energy = (size * size) / (s * s);
  float b = exp(-dot(o, o) / (s * s)) * energy * bright * pow(h.y, 4.0);
  return b * mix(vec3(1.0, 0.8, 0.64), vec3(0.8, 0.85, 1.0), h.z);
}
uniform float uMoonTime;
uniform float uMoonMotion;
// the moon's light, linear: the tone curve pales anything bright, so the shell stays low and red and the cuts carry the brightness
#define MOON_SHELL 0.45
#define MOON_INNER 0.2
#define MOON_BLEED 0.4
#define MOON_GLOW 0.05
#define MOON_CORONA 0.3
#define MOON_EMBER vec3(1.3, 0.34, 0.005)
#define MOON_HOT vec3(4.0, 1.9, 0.08)
#define MOON_WALL vec3(2.4, 0.8, 0.01)
${FACE_GLSL}
// the flame's slow breath, still under reduced motion
float moonBreath() {
  float n = nightNoise(vec2(uMoonTime * 0.45, 3.7)) * 0.65 + nightNoise(vec2(uMoonTime * 1.1, 9.1)) * 0.35;
  return 1.0 + (n - 0.5) * 0.1 * uMoonMotion;
}
vec3 dressSkyDisc(vec3 col, vec3 photo, vec3 dir) {
  float px = length(fwidth(dir));
  // one screen pixel in the disc's own units, for the carved edges
  vec3 ddx = dFdx(dir);
  vec3 ddy = dFdy(dir);
  float pw = sqrt(0.5 * (dot(ddx, ddx) + dot(ddy, ddy))) / ${R};
  // stars only in the photograph's clear sky, fading down into the glow and
  // near the moon
  float r = nightCover(photo, dir);
  float clear = 1.0 - smoothstep(1.0, 1.7, r);
  float m = dot(dir, uSkyMoonDisc);
  float fade = smoothstep(0.05, 0.5, dir.y) * (1.0 - smoothstep(0.6, 0.93, m)) * clear;
  if (fade > 0.0) {
    vec3 stars = nightStarLayer(dir, px, 150.0, 0.11, 0.0011, 1.15);
    stars += nightStarLayer(dir, px, 420.0, 0.07, 0.0006, 0.4);
    col += stars * fade;
  }
  // the moon, drawn from its distance to the centre so its limb is sharp at
  // any resolution
  vec3 o = dir - uSkyMoonDisc;
  float x = length(o) / ${R};
  // the soft wide halo in the haze as before, then a deep red glow and a corona hugging the limb
  float halo = 0.025 / (1.0 + x * x * 0.1);
  float glow = MOON_GLOW * exp(-x * 0.7);
  float corona = exp(-max(x - 1.0, 0.0) * 4.0) * MOON_CORONA;
  col += vec3(1.0, 0.16, 0.05) * halo + vec3(1.0, 0.05, 0.015) * glow + vec3(1.0, 0.07, 0.02) * corona;
  if (x < 1.1) {
    vec3 right = normalize(cross(uSkyMoonDisc, vec3(0.0, 1.0, 0.0)));
    vec3 upv = cross(right, uSkyMoonDisc);
    vec2 p = vec2(dot(o, right), dot(o, upv)) / ${R};
    float breath = moonBreath();
    // a faint grain of seas and highlands, so the shell is not a flat red
    float seas = nightNoise(p * 2.2 + 3.1) * 0.62 + nightNoise(p * 5.0 - 1.7) * 0.28 + nightNoise(p * 11.0) * 0.1;
    float surface = mix(1.0, 0.84, smoothstep(0.4, 0.66, seas));
    float mu = sqrt(max(1.0 - x * x, 0.0));
    // the shell: blood red, falling away to a dark limb
    float limb = pow(mu, 0.7);
    vec3 tone = mix(vec3(0.85, 0.006, 0.004), vec3(1.0, 0.016, 0.005), smoothstep(-1.0, 1.0, p.y));
    // the flame shines through the shell, most near itself and around each cut where the shell is thin
    vec2 f = p - vec2(${FACE.flame[0].toFixed(3)}, ${FACE.flame[1].toFixed(3)});
    float near = exp(-dot(f, f) * 0.9);
    float d = moonFace(p);
    float thin = exp(-max(d, 0.0) * 16.0);
    vec3 shell = tone * MOON_SHELL * surface * limb;
    shell += vec3(1.0, 0.03, 0.005) * (near * MOON_INNER + thin * MOON_BLEED * (0.4 + 0.6 * near)) * limb * breath;
    // through a cut: the lit inner wall under its top edge, and past it the far side, hottest by the flame
    float wall = clamp(0.5 + moonFace(p + vec2(0.0, 0.06)) / pw, 0.0, 1.0);
    vec3 far = mix(MOON_EMBER, MOON_HOT, near * near);
    vec3 cut = mix(far, MOON_WALL * (0.6 + 0.4 * near), wall) * breath;
    float carved = clamp(0.5 - d / pw, 0.0, 1.0);
    vec3 face = mix(shell, cut, carved);
    float edge = px / ${R};
    float inside = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, x);
    col = mix(col, face, inside);
  }
  return col;
}
`

// the same grade on the CPU, for the image light: data is the turned HDR in
// three's equirect layout (column u = atan(z, x) / 2pi + 0.5, first row up)
function gradeEnvironment(data: Float32Array, width: number, height: number): void {
  const sx = hallow.uMoonDir.value.x
  const sy = hallow.uMoonDir.value.y
  const sz = hallow.uMoonDir.value.z
  const moon = discDirection()
  const mx = moon.x
  const my = moon.y
  const mz = moon.z
  const ml = Math.hypot(mx, mz) || 1
  const tx = mx / ml
  const tz = mz / ml
  const smooth = (a: number, b: number, v: number) => {
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  for (let y = 0; y < height; y++) {
    const e = (0.5 - (y + 0.5) / height) * Math.PI
    const dy = Math.sin(e)
    const ce = Math.cos(e)
    const ah = Math.min(Math.abs(dy), 1)
    const up = Math.pow(smooth(0, 0.7, ah), 0.8)
    const baseR = 0.046 + (0.008 - 0.046) * up
    const baseG = 0.02 + (0.008 - 0.02) * up
    const baseB = 0.05 + (0.03 - 0.05) * up
    const clearBase = 0.32 + 0.7 * Math.pow(1 - ah, 1.6)
    const low = Math.exp(-ah * 14)
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI
      const dx = Math.cos(phi) * ce
      const dz = Math.sin(phi) * ce
      const i = (y * width + x) * 4
      const sun = Math.max(dx * sx + dy * sy + dz * sz, 0)
      const sun2 = sun * sun
      const sun4 = sun2 * sun2
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      const r = l / (clearBase + 1.4 * sun4 * sun4)
      const m = Math.max(dx * mx + dy * my + dz * mz, 0)
      const m2 = m * m
      const m4 = m2 * m2
      const m8 = m4 * m4
      const cover = smooth(1.1, 2.4, r) * 0.88
      const az = ce > 1e-4 ? (dx * tx + dz * tz) / ce : 0
      let wide = az * 0.5 + 0.5
      wide *= wide
      const g = wide * wide * low
      const m12 = m8 * m4
      const inner = m12 * m12 * 0.16
      const grain = 0.8 + 0.2 * Math.min(r, 2)
      const sr = (baseR + 0.2 * g + 0.6 * inner) * grain
      const sg = (baseG + 0.03 * g + 0.08 * inner) * grain
      const sb = (baseB + 0.01 * g + 0.02 * inner) * grain
      const form = Math.min(1, Math.max(0, (r - 1) / 2.5))
      const f = form * Math.sqrt(form)
      const cr = sr * 0.35 + (0.22 * m12 + 0.022) * f
      const cg = sg * 0.35 + (0.05 * m12 + 0.015) * f
      const cb = sb * 0.35 + (0.026 * m12 + 0.034) * f
      data[i] = sr + (cr - sr) * cover
      data[i + 1] = sg + (cg - sg) * cover
      data[i + 2] = sb + (cb - sb) * cover
    }
  }
}

export const sky: SkyDress = {
  glsl: GRADE_GLSL,
  domeGlsl: DOME_GLSL,
  uniforms: {
    uSkyMoonDir: hallow.uMoonDir,
    uMoonTime: realmUniforms.uTime,
    uMoonMotion: moonFlame.uMoonMotion,
    // read each frame, so it follows the light's direction once the sky sets it
    uSkyMoonDisc: {
      get value() {
        return discDirection()
      },
    },
  },
  gradeEnvironment,
}
