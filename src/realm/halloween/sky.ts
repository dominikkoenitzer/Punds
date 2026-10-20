import type { SkyDress } from '../season'
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
const MOON_RADIUS = 0.058

const GRADE_GLSL = /* glsl */ `
uniform vec3 uSkyMoonDir;
// how much of the photograph is cloud there, 0..0.85: the clear sky's
// brightness is known from its height and the sun, and a cloud is brighter
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
  float m = max(dot(dir, uSkyMoonDir), 0.0);
  float r = nightCover(col, dir);
  float cover = smoothstep(1.1, 2.4, r) * 0.85;
  // deep violet overhead, a dusky mauve band at the horizon
  float up = pow(smoothstep(0.0, 0.7, ah), 0.8);
  vec3 sky = mix(vec3(0.05, 0.021, 0.045), vec3(0.011, 0.009, 0.034), up);
  // the glow under the moon spreads wide along the horizon and low
  vec2 toward = normalize(uSkyMoonDir.xz);
  float az = dot(dir.xz, toward) / max(length(dir.xz), 1e-4);
  float wide = az * 0.5 + 0.5;
  wide *= wide;
  sky += vec3(0.46, 0.085, 0.028) * wide * wide * exp(-ah * 7.0);
  float m4 = m * m * m * m;
  float m24 = m4 * m4 * m4;
  m24 *= m24;
  sky += vec3(0.8, 0.2, 0.06) * m24 * 0.7;
  // the photograph's own grain, kept faintly in the clear sky
  sky *= 0.75 + 0.25 * min(r, 2.0);
  // the clouds stand dark against it, their moon side catching a red rim
  float form = clamp((r - 1.0) / 2.5, 0.0, 1.0);
  float m6 = m4 * m * m;
  vec3 lit = vec3(0.42, 0.12, 0.07) * m6 + vec3(0.028, 0.018, 0.04);
  vec3 cloud = sky * 0.4 + lit * form * sqrt(form);
  return mix(sky, cloud, cover);
}
`

const DOME_GLSL = /* glsl */ `
uniform vec3 uSkyMoonDisc;
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
  float b = exp(-dot(o, o) / (s * s)) * energy * bright * pow(h.y, 5.0);
  return b * mix(vec3(1.0, 0.82, 0.66), vec3(0.78, 0.84, 1.0), h.z);
}
vec3 dressSkyDisc(vec3 col, vec3 photo, vec3 dir) {
  float px = length(fwidth(dir));
  // stars only in the photograph's clear sky, fading down into the glow and
  // near the moon
  float r = nightCover(photo, dir);
  float clear = 1.0 - smoothstep(1.0, 1.6, r);
  float m = dot(dir, uSkyMoonDisc);
  float fade = smoothstep(0.06, 0.45, dir.y) * (1.0 - smoothstep(0.7, 0.95, m)) * clear;
  if (fade > 0.0) {
    vec3 stars = nightStarLayer(dir, px, 150.0, 0.32, 0.0011, 0.9);
    stars += nightStarLayer(dir, px, 420.0, 0.22, 0.0006, 0.35);
    col += stars * fade;
  }
  // the moon, drawn from its distance to the centre so its limb is sharp at
  // any resolution
  vec3 o = dir - uSkyMoonDisc;
  float x = length(o) / ${MOON_RADIUS.toFixed(4)};
  // a faint corona hugging the limb and a soft wide halo
  float halo = 0.05 / (1.0 + x * x * 0.08) + 0.03 * exp(-x * 0.55);
  float corona = exp(-max(x - 1.0, 0.0) * 4.0) * 0.32;
  col += vec3(1.0, 0.3, 0.12) * halo + vec3(1.0, 0.36, 0.16) * corona;
  if (x < 1.1) {
    vec3 right = normalize(cross(uSkyMoonDisc, vec3(0.0, 1.0, 0.0)));
    vec3 upv = cross(right, uSkyMoonDisc);
    vec2 p = vec2(dot(o, right), dot(o, upv)) / ${MOON_RADIUS.toFixed(4)};
    // the dark seas and the brighter highlands, a broad pattern with fine grain
    float seas = nightNoise(p * 2.2 + 3.1) * 0.62 + nightNoise(p * 5.0 - 1.7) * 0.28 + nightNoise(p * 11.0) * 0.1;
    float surface = mix(1.0, 0.62, smoothstep(0.42, 0.68, seas));
    float mu = sqrt(max(1.0 - x * x, 0.0));
    float limb = 0.68 + 0.32 * sqrt(mu);
    // deeper red toward its lower limb, where its light crosses more air
    vec3 tone = mix(vec3(1.0, 0.24, 0.07), vec3(1.0, 0.36, 0.14), smoothstep(-1.0, 1.0, p.y));
    vec3 disc = tone * 5.2 * surface * limb;
    float edge = px / ${MOON_RADIUS.toFixed(4)};
    float inside = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, x);
    col = mix(col, disc, inside);
  }
  return col;
}
`

// the same grade on the CPU, for the image light: data is the turned HDR in
// three's equirect layout (column u = atan(z, x) / 2pi + 0.5, first row up)
function gradeEnvironment(data: Float32Array, width: number, height: number): void {
  const mx = hallow.uMoonDir.value.x
  const my = hallow.uMoonDir.value.y
  const mz = hallow.uMoonDir.value.z
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
    const baseR = 0.05 + (0.011 - 0.05) * up
    const baseG = 0.021 + (0.009 - 0.021) * up
    const baseB = 0.045 + (0.034 - 0.045) * up
    const clearBase = 0.32 + 0.7 * Math.pow(1 - ah, 1.6)
    const low = Math.exp(-ah * 7)
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI
      const dx = Math.cos(phi) * ce
      const dz = Math.sin(phi) * ce
      const i = (y * width + x) * 4
      const m = Math.max(dx * mx + dy * my + dz * mz, 0)
      const m2 = m * m
      const m4 = m2 * m2
      const m8 = m4 * m4
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      const r = l / (clearBase + 1.4 * m8)
      const cover = smooth(1.1, 2.4, r) * 0.85
      const az = ce > 1e-4 ? (dx * tx + dz * tz) / ce : 0
      let wide = az * 0.5 + 0.5
      wide *= wide
      const g = wide * wide * low
      const inner = m8 * m8 * m8 * 0.7
      const grain = 0.75 + 0.25 * Math.min(r, 2)
      const sr = (baseR + 0.46 * g + 0.8 * inner) * grain
      const sg = (baseG + 0.085 * g + 0.2 * inner) * grain
      const sb = (baseB + 0.028 * g + 0.06 * inner) * grain
      const form = Math.min(1, Math.max(0, (r - 1) / 2.5))
      const f = form * Math.sqrt(form)
      const m6 = m4 * m2
      const cr = sr * 0.4 + (0.42 * m6 + 0.028) * f
      const cg = sg * 0.4 + (0.12 * m6 + 0.018) * f
      const cb = sb * 0.4 + (0.07 * m6 + 0.04) * f
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
    uSkyMoonDisc: hallow.uMoonDir,
  },
  gradeEnvironment,
}
