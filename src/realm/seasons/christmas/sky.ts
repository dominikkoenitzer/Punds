import type { SkyDress } from '../../season'
import { evening } from './state'

// The sky of the blue hour, made from the photographed one: its clouds keep
// their forms as slate against a sky that runs from a pale cold band at the
// horizon to ink blue overhead, with a low warm afterglow along the horizon
// where the sun went down. A few of the brightest stars are already out high
// up, away from the glow.
//
// The grade is written twice, once in GLSL for every shader that looks the
// sky up and once in TypeScript for the image light; the two must stay the
// same.

export const GRADE_GLSL = /* glsl */ `
uniform vec3 uSkySunDir;
// how cloudy the photograph is in direction dir: its brightness over the
// clear sky's, which is known from the height and the sun; a cloud is brighter
float duskCover(vec3 col, vec3 dir) {
  float ah = min(abs(dir.y), 1.0);
  float s = max(dot(dir, uSkySunDir), 0.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float s2 = s * s;
  float s8 = s2 * s2 * s2 * s2;
  float clear = 0.32 + 0.7 * pow(1.0 - ah, 1.6) + 1.4 * s8;
  return l / clear;
}
// how much of the afterglow lies in direction dir: wide along the horizon
// on the sun's side, gone behind
float duskGlow(vec3 dir) {
  vec2 toward = normalize(uSkySunDir.xz);
  float az = dot(dir.xz, toward) / max(length(dir.xz), 1e-4);
  float w = az * 0.5 + 0.5;
  w *= w;
  return w * w;
}
vec3 dressSky(vec3 col, vec3 dir) {
  float ah = min(abs(dir.y), 1.0);
  float r = duskCover(col, dir);
  float cover = smoothstep(1.1, 2.4, r) * 0.85;
  float up = pow(smoothstep(0.0, 0.8, ah), 0.7);
  vec3 sky = mix(vec3(0.07, 0.09, 0.125), vec3(0.011, 0.02, 0.055), up);
  float g = duskGlow(dir);
  sky += vec3(0.15, 0.075, 0.035) * g * exp(-ah * 9.0);
  // the photograph's own grain, kept faintly in the clear sky
  sky *= 0.85 + 0.15 * min(r, 2.0);
  // the clouds: slate, the ones over the glow warmed underneath
  float form = clamp((r - 1.0) / 2.5, 0.0, 1.0);
  vec3 lit = vec3(0.085, 0.05, 0.035) * g * exp(-ah * 4.0) + vec3(0.028, 0.034, 0.048);
  vec3 cloud = sky * 0.45 + lit * form * sqrt(form);
  return mix(sky, cloud, cover);
}
`

const DOME_GLSL = /* glsl */ `
vec3 duskHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
// at most one star per cell of a grid around the camera, a soft spot at
// least a pixel wide, so it never shimmers as the view sways
vec3 duskStars(vec3 dir, float px) {
  vec3 cell = floor(dir * 150.0);
  vec3 h = duskHash(cell);
  if (h.x > 0.05) return vec3(0.0);
  vec3 star = normalize(cell + 0.3 + 0.4 * duskHash(cell + 17.0));
  vec3 o = dir - star;
  float size = 0.0011;
  float s = max(size, px * 0.85);
  float energy = (size * size) / (s * s);
  // only the brightest are out this early
  float b = exp(-dot(o, o) / (s * s)) * energy * pow(h.y, 6.0) * 0.9;
  return b * mix(vec3(1.0, 0.86, 0.74), vec3(0.82, 0.88, 1.0), h.z);
}
vec3 dressSkyDisc(vec3 col, vec3 photo, vec3 dir) {
  float r = duskCover(photo, dir);
  float clear = 1.0 - smoothstep(1.0, 1.7, r);
  float fade = smoothstep(0.25, 0.7, dir.y) * (1.0 - duskGlow(dir)) * clear;
  if (fade > 0.0) col += duskStars(dir, length(fwidth(dir))) * fade;
  return col;
}
`

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// one radiance through the grade, as the GLSL does it; out receives linear RGB
export function gradeOne(col: readonly [number, number, number], dx: number, dy: number, dz: number, out: number[]): void {
  const s = evening.uSunDir.value
  const ah = Math.min(Math.abs(dy), 1)
  const sun = Math.max(dx * s.x + dy * s.y + dz * s.z, 0)
  const s2 = sun * sun
  const s8 = s2 * s2 * s2 * s2
  const clear = 0.32 + 0.7 * Math.pow(1 - ah, 1.6) + 1.4 * s8
  const r = (0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]) / clear
  const cover = smooth(1.1, 2.4, r) * 0.85
  const up = Math.pow(smooth(0, 0.8, ah), 0.7)
  const tl = Math.hypot(s.x, s.z) || 1
  const hl = Math.max(Math.hypot(dx, dz), 1e-4)
  let w = ((dx * s.x + dz * s.z) / tl / hl) * 0.5 + 0.5
  w *= w
  const g = w * w
  const low = Math.exp(-ah * 9)
  const grain = 0.85 + 0.15 * Math.min(r, 2)
  const sr = (0.07 + (0.011 - 0.07) * up + 0.15 * g * low) * grain
  const sg = (0.09 + (0.02 - 0.09) * up + 0.075 * g * low) * grain
  const sb = (0.125 + (0.055 - 0.125) * up + 0.035 * g * low) * grain
  const form = Math.min(1, Math.max(0, (r - 1) / 2.5))
  const f = form * Math.sqrt(form)
  const warm = g * Math.exp(-ah * 4)
  const cr = sr * 0.45 + (0.085 * warm + 0.028) * f
  const cg = sg * 0.45 + (0.05 * warm + 0.034) * f
  const cb = sb * 0.45 + (0.035 * warm + 0.048) * f
  out[0] = sr + (cr - sr) * cover
  out[1] = sg + (cg - sg) * cover
  out[2] = sb + (cb - sb) * cover
}

// the same grade on the CPU, for the image light: data is the turned HDR in
// three's equirect layout (column u = atan(z, x) / 2pi + 0.5, first row up)
function gradeEnvironment(data: Float32Array, width: number, height: number): void {
  const out = [0, 0, 0]
  const col: [number, number, number] = [0, 0, 0]
  for (let y = 0; y < height; y++) {
    const e = (0.5 - (y + 0.5) / height) * Math.PI
    const dy = Math.sin(e)
    const ce = Math.cos(e)
    for (let x = 0; x < width; x++) {
      const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI
      const i = (y * width + x) * 4
      col[0] = data[i]!
      col[1] = data[i + 1]!
      col[2] = data[i + 2]!
      gradeOne(col, Math.cos(phi) * ce, dy, Math.sin(phi) * ce, out)
      data[i] = out[0]!
      data[i + 1] = out[1]!
      data[i + 2] = out[2]!
    }
  }
}

export const sky: SkyDress = {
  glsl: GRADE_GLSL,
  domeGlsl: DOME_GLSL,
  uniforms: { uSkySunDir: evening.uSunDir },
  gradeEnvironment,
}
