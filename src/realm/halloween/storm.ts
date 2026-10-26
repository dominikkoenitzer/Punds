import * as THREE from 'three'
import { dress } from '../season'
import type { Frame, RealmPart, Tier } from '../types'
import { MOON_RADIUS } from './sky'
import { announceFlash, hallow } from './state'

// Lightning far out in the cloud sea, and now and then a cloud it lights in
// the shape of a ghost. Drives the shared state in state.ts; the clouds read
// it through the GLSL below, which Skyscape folds into its own programs.

// The ghost stands far out over the sea a third of the way to the right of
// the path: from the start view its reaching arm shows beside the cedars on
// the right, a short turn toward the rack brings the whole figure into view.
// Foot of the figure on the sea's base, and SCALE metres per unit of the
// shape below, which is about 700 units tall.
const GHOST_FOOT = new THREE.Vector2(1272, -2035)
const SCALE = 1.4
// the lightning inside it, at the chest
const GHOST_CHEST_Y = -55 + 480 * SCALE

// Banks a plain flash may light from within: x, z, height above the sea.
// They match the towering banks the clouds draw, so a flash sits inside a
// real mass of cloud.
const BANKS: readonly [number, number, number][] = [
  [260, -2350, 500],
  [-700, -2850, 430],
  [-2500, -1550, 380],
  [2500, -2200, 460],
  [2600, 1800, 420],
  [900, 2900, 320],
  [-2900, 900, 300],
  [1700, -600, 280],
]

// --- what the clouds wear --------------------------------------------------------

// What Skyscape takes from the storm: rewrites of its programs' sources (only
// when the season is worn), the uniforms they add, and the night's colours
// for the cloud light (the moon on the tops, the violet of the shade).
export interface CloudDress {
  sky(src: string): string
  march(src: string): string
  wisp(src: string): string
  uniforms(): Record<string, THREE.IUniform>
  sunColor: THREE.Color
  shadowColor: THREE.Color
  // the share of the garden's light the distant islands and ranges take: the
  // garden's key is lifted so it reads at night, the far world keeps the
  // moon's own dimmer light
  farLight: number
  // how sudden the clouds' light is right now, 0..1: the trace's history
  // is let go by that much, so lightning shows at once
  sudden?(): number
}

const stormUniforms = {
  uStormFlash: hallow.uFlash,
  uStormFlashPos: { value: new THREE.Vector3(0, -60, -2500) },
  uStormGhost: hallow.uGhost,
  // a faint steady glow inside the ghost, for when there is no lightning
  uStormGlow: { value: 0 },
  // the foot of the ghost (xz) and the way it faces (toward the island)
  uStormGhostAt: { value: new THREE.Vector4(GHOST_FOOT.x, GHOST_FOOT.y, 0, 1) },
  // the ghost's own time, which stands still under reduced motion
  uStormT: { value: 0 },
}
{
  const f = new THREE.Vector2(-GHOST_FOOT.x, -GHOST_FOOT.y).normalize()
  stormUniforms.uStormGhostAt.value.z = f.x
  stormUniforms.uStormGhostAt.value.w = f.y
}

// a night grade of the photographed sky, for as long as the night sky has none
const FALLBACK_SKY = /* glsl */ `
vec3 dressSky(vec3 c, vec3 d) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float m = max(dot(d, uSunDir), 0.0);
  return l * (vec3(0.07, 0.045, 0.1) + vec3(0.75, 0.2, 0.09) * (pow(m, 5.0) * 0.5));
}
`

// Clouds and veils thin out over the moon's disc and just around it, so its
// limb stays crisp: a ray within a disc's width of the limb passes through
// little of them.
const MOON_CLEAR_GLSL = /* glsl */ `
float moonClear(vec3 d) {
  float a = acos(clamp(dot(d, uSkyMoonDisc), -1.0, 1.0)) / ${MOON_RADIUS.toFixed(4)};
  return mix(0.15, 1.0, smoothstep(1.0, 1.8, a));
}
`

// every rewrite must find its place, or the clouds would quietly stay as they are
function swap(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`storm: no "${from.slice(0, 40)}" in the cloud shader`)
  return src.replace(from, to)
}

function skyRewrite(src: string): string {
  src = swap(src, 'vec3 skyLookup(vec3 d) {', 'vec3 skyLookupDay(vec3 d) {')
  return swap(
    src,
    '// the colour of the air in direction d, sampled just above the horizon',
    `${dress()?.sky?.glsl ?? FALLBACK_SKY}
vec3 skyLookup(vec3 d) { return dressSky(skyLookupDay(d), d); }
// the colour of the air in direction d, sampled just above the horizon`,
  )
}

// The ghost as a distance field in its own units: x across, y up from the
// sea's base, z toward the island. A robe falling from the shoulders into the
// sea, swept downwind, a hooded head bowed a little, and long arms reaching
// out and up toward the island with sleeves hanging from them.
const GHOST_GLSL = /* glsl */ `
uniform float uStormFlash;
uniform vec3 uStormFlashPos;
uniform float uStormGhost;
uniform float uStormGlow;
uniform vec4 uStormGhostAt;
uniform float uStormT;

const float GHOST_SCALE = ${SCALE.toFixed(3)};
// the box the ghost lives in, in its units: centre height and half sizes;
// its floor is the sea's top, where the sea takes over
const vec3 GHOST_BOX_C = vec3(55.0, 400.0, 30.0);
const vec3 GHOST_BOX_H = vec3(470.0, 380.0, 190.0);
const vec3 FLASH_COLOR = vec3(0.78, 0.8, 1.0);

// set for the stretch of a ray that runs through the ghost's box
bool gMarchGhost = false;
// how much of the clouds this ray sees, thinner over the moon
float gMoonClear = 1.0;

float sdEll(vec3 p, vec3 r) {
  float k0 = length(p / r);
  float k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / max(k1, 1e-4);
}
float sdCap(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// world to the ghost's units
vec3 ghostLocal(vec3 p) {
  vec2 o = p.xz - uStormGhostAt.xy;
  vec2 f = uStormGhostAt.zw;
  return vec3(o.x * f.y - o.y * f.x, p.y + 55.0, dot(o, f)) / GHOST_SCALE;
}

float ghostShape(vec3 p, out float hollow, out float limb) {
  float ft = uStormT;
  // the body: broad under the shoulders, narrowing as it falls and trailing
  // off downwind in a long tail that sinks into the sea, slowly swaying
  float sway = sin(ft * 0.25 + p.y * 0.01) * 14.0;
  vec3 b = p - vec3(sway, 0.0, 0.0);
  float d = sdCap(b, vec3(0.0, 470.0, 0.0), vec3(30.0, 360.0, -10.0), 100.0, 104.0);
  d = smin(d, sdEll(p - vec3(0.0, 500.0, 0.0), vec3(132.0, 54.0, 72.0)), 40.0);
  d = smin(d, sdCap(b, vec3(30.0, 360.0, -10.0), vec3(150.0, 220.0, -30.0), 112.0, 78.0), 50.0);
  d = smin(d, sdCap(b, vec3(150.0, 220.0, -30.0), vec3(320.0, 120.0, -50.0), 78.0, 48.0), 40.0);
  d = smin(d, sdCap(b, vec3(320.0, 120.0, -50.0), vec3(470.0, 40.0, -60.0), 48.0, 30.0), 30.0);
  // the hood, and the head in it bowed a little toward the island
  d = smin(d, sdEll(p - vec3(0.0, 640.0, 8.0), vec3(62.0, 80.0, 60.0)), 22.0);
  // long arms raised out and up toward the island, one a little higher,
  // with sleeves hanging from them; thick enough that the billows leave
  // a whole arm and a hand at its end
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float lift = p.x > 0.0 ? 50.0 : 0.0;
  vec3 elbow = vec3(265.0, 560.0 + lift * 0.4, 90.0);
  vec3 hand = vec3(410.0, 650.0 + lift, 190.0);
  float arm = sdCap(q, vec3(110.0, 515.0, 0.0), elbow, 58.0, 40.0);
  arm = smin(arm, sdCap(q, elbow, hand, 40.0, 20.0), 30.0);
  arm = smin(arm, sdEll(q - vec3(205.0, 470.0 + lift * 0.3, 40.0), vec3(74.0, 112.0, 40.0)), 46.0);
  d = smin(d, arm, 44.0);
  limb = arm;
  // hollow eyes and an open mouth, only as shade, not cut through
  float eye = sdEll(vec3(abs(p.x) - 24.0, p.y - 650.0, p.z - 62.0), vec3(17.0, 22.0, 40.0));
  float mouth = sdEll(p - vec3(0.0, 602.0, 60.0), vec3(12.0, 24.0, 40.0));
  hollow = min(eye, mouth);
  return d;
}

// The ghost's density at p, how deep inside it p lies (metres), and how
// strongly the lightning inside it lights this sample. Zero outside its box.
float ghostDensity(vec3 p, float lod, bool fine, out float emit, out float depth) {
  emit = 0.0;
  depth = 0.0;
  vec3 l = ghostLocal(p);
  if (any(greaterThan(abs(l - GHOST_BOX_C), GHOST_BOX_H))) return 0.0;
  float hollow;
  float limb;
  float d = ghostShape(l, hollow, limb);
  float g = uStormGhost;
  // between its hours the shape is only a towering cloud: the figure melts
  // into a rounded mass and the billows eat further into it
  d = mix(sdEll(l - vec3(40.0, 390.0, 0.0), vec3(270.0, 320.0, 140.0)), d, g);
  if (d > 110.0) return 0.0;
  // billowed like the rest of the sea, a little calmer over the face
  vec3 w = p + vec3(0.0, -uStormT * 1.5, 0.0);
  float n = textureLod(uNoise, w * (1.0 / 170.0), max(0.0, lod - 0.5)).r;
  float face = smoothstep(430.0, 540.0, l.y) * g;
  // the billows bite less once the figure is drawn, so its outline holds
  // and less again along the arms, so they read as arms and not as a row of puffs
  float arms = smoothstep(40.0, 0.0, limb) * g;
  float erode = (0.4 - n) * mix(70.0, 36.0, face) * (1.0 + (1.0 - g) * 0.9) * mix(1.0, 0.55, g) * mix(1.0, 0.6, arms);
  float fn = 0.5;
  if (fine) fn = textureLod(uNoise, w * (1.0 / 60.0), lod + 0.4).g;
  erode += (0.5 - fn) * mix(34.0, 18.0, face) * mix(1.0, 0.65, g) * mix(1.0, 0.7, arms);
  d += erode;
  depth = max(-d * GHOST_SCALE, 0.0);
  // the foot dissolves into the sea's tops; the drawn figure has a firmer edge
  float dens = clamp(-d * GHOST_SCALE / mix(14.0, 7.0, g), 0.0, 1.0) * smoothstep(-20.0, 40.0, p.y);
  // the light inside: strongest in the chest, dark in the hollows of the face,
  // and a share through the whole figure so the arms and hood read in the flash
  vec3 c = l - vec3(0.0, 500.0, 0.0);
  // billowed too: the light shows brighter through the thinner puffs
  emit = (0.12 + 0.14 * g + exp(-dot(c, c) * (1.0 / (170.0 * 170.0))) * 1.6 + exp(-dot(c, c) * (1.0 / (420.0 * 420.0))) * 0.35) * (0.3 + n * 1.4 + (fn - 0.5) * 1.2) * mix(0.15, 1.0, smoothstep(0.0, 30.0, hollow));
  // the drawn figure glows darker toward its foot and its underside, and
  // brighter in its outer few metres, so its outline stands out in the flash
  float under = mix(0.18, 1.0, smoothstep(160.0, 560.0, l.y));
  float rim = 1.0 - smoothstep(3.0, 26.0, depth);
  emit *= mix(1.0, under * (1.0 + rim * 1.4), g);
  return dens;
}

// the light's step through the ghost, with nothing else; the drawn
// figure's lower body holds the light longer, so its underside falls darker
float ghostShade(vec3 p, float lod) {
  float e;
  float dp;
  float low = 1.0 - smoothstep(120.0, 480.0, ghostLocal(p).y);
  return ghostDensity(p, lod, false, e, dp) * (1.0 + low * 1.2 * uStormGhost);
}

// The lightning's light at a sample: it lights the cloud from within around
// where it strikes and spreads out through it, and lights the ghost whole.
vec3 flashLight(vec3 p, float gEmit, float level) {
  float glowGhost = (uStormFlash + uStormGlow) * gEmit * 5.5;
  if (uStormFlash < 0.002 && glowGhost < 0.002) return vec3(0.0);
  vec3 o = p - uStormFlashPos;
  float r2 = dot(o, o * vec3(1.0, 1.8, 1.0));
  float glow = exp(-r2 * (1.0 / (260.0 * 260.0))) * 3.6 + exp(-r2 * (1.0 / (700.0 * 700.0))) * 0.55;
  return FLASH_COLOR * (level * (uStormFlash * glow + glowGhost));
}

// where the ray crosses the ghost's box
bool ghostHit(vec3 ro, vec3 rd, out float t0, out float t1) {
  t0 = 0.0;
  t1 = -1.0;
  vec2 f = uStormGhostAt.zw;
  vec3 o = ghostLocal(ro) - GHOST_BOX_C;
  vec3 d = vec3(rd.x * f.y - rd.z * f.x, rd.y, rd.x * f.x + rd.z * f.y) / GHOST_SCALE;
  vec3 inv = 1.0 / (d + vec3(1e-7));
  vec3 a = (-GHOST_BOX_H - o) * inv;
  vec3 b = (GHOST_BOX_H - o) * inv;
  vec3 lo = min(a, b);
  vec3 hi = max(a, b);
  t0 = max(max(lo.x, lo.y), max(lo.z, 0.0));
  t1 = min(min(hi.x, hi.y), hi.z);
  return t1 > t0;
}
`

function marchRewrite(src: string): string {
  src = skyRewrite(src)
  src = swap(src, '// height of the cloud tops at xz, and how much of a tower this column is', `${GHOST_GLSL}
${MOON_CLEAR_GLSL}
// height of the cloud tops at xz, and how much of a tower this column is`)
  // in the ghost's stretch of the ray the samples are the ghost's alone; the
  // light's steps through it reach six times further, so the figure's far
  // side falls into its own shade. The ghost's own sample is taken ahead of
  // the light loop: a call site inside it cost 3 s of compile.
  src = swap(
    src,
    '  float dens = 0.0;\n',
    `  float dens = 0.0;
  float gEmit = 0.0;
  float gDens = 0.0;
  float gTop = 0.0;
  if (gMarchGhost) {
    // the figure's billows keep one fineness however fine the trace is
    gDens = ghostDensity(p, max(lod, 1.0), true, gEmit, gTop);
    gEmit *= smoothstep(0.0, 0.3, gDens);
  }
`,
  )
  src = swap(
    src,
    '    sd = density(sp, here ? detail : 0.0, lod, dl, tl2);',
    `    if (gMarchGhost) {
      if (here) {
        sd = gDens;
        dl = gTop;
        tl2 = 1.0;
      } else {
        sd = ghostShade(p + uSunDir * (lt * 6.0), max(lod, 1.0)) * 6.0;
      }
    } else {
      sd = density(sp, here ? detail : 0.0, lod, dl, tl2) * (here ? gMoonClear : 1.0);
    }`,
  )
  // moonlit rims run red-orange, the shade toward violet
  src = swap(src, 'mix(vec3(1.0, 0.8, 0.5), vec3(1.0, 0.95, 0.85), sunward)', 'mix(vec3(1.0, 0.5, 0.32), vec3(1.0, 0.66, 0.5), sunward)')
  src = swap(src, 'amb * mix(vec3(0.86, 0.96, 1.12), vec3(1.0), sunward)', 'amb * mix(vec3(0.86, 0.78, 1.18), vec3(1.0, 0.9, 1.05), sunward)')
  // the lightning lights the cloud before the air between it and the eye
  // dims it, so the glow keeps the billows' form
  src = swap(
    src,
    '  lit = mix(lit, air, fog * sqrt(fog));',
    `  lit += flashLight(p, gEmit, dot(sunC, vec3(0.3333)));
  lit = mix(lit, air, fog * sqrt(fog));`,
  )
  src = swap(src, '  float cosT = dot(rd, uSunDir);', `  gMoonClear = moonClear(rd);
  float cosT = dot(rd, uSunDir);`)
  // the ghost's box is marched first, at the towers' steps; it stands
  // beyond the sea's near edge and in front of the banks behind it, and the
  // stretch is cut where the ray enters the sea, which takes over there
  src = swap(
    src,
    `  for (int k = 0; k < 3; k++) {
    if (k >= count || trans < 0.03) break;
    vec3 seg = k == 0 ? seg0 : (k == 1 ? seg1 : seg2);`,
    `  vec3 gseg = vec3(0.0, -1.0, ft);
  bool gOn = ghostHit(ro, rd, gseg.x, gseg.y);
  gseg.y = min(gseg.y, sceneT);
  if (rd.y < -1e-4) gseg.y = min(gseg.y, s0);
  gOn = gOn && gseg.y > gseg.x;
  for (int k = 0; k < 4; k++) {
    if (k > count || trans < 0.03) break;
    gMarchGhost = k == 0;
    if (gMarchGhost && !gOn) continue;
    vec3 seg = k == 0 ? gseg : (k == 1 ? seg0 : (k == 2 ? seg1 : seg2));`,
  )
  return src
}

// moonlight on the cloud tops: red-orange; the shade a deep violet
export const clouds: CloudDress = {
  sky: skyRewrite,
  march: marchRewrite,
  wisp: (src) =>
    swap(
      swap(skyRewrite(src), 'void main() {', `${MOON_CLEAR_GLSL}
void main() {`),
      '  gl_FragColor = vec4(col * a, a);',
      `  a *= moonClear(view);
  gl_FragColor = vec4(col * a, a);`,
    ),
  uniforms: () => ({ ...stormUniforms, ...(dress()?.sky?.uniforms ?? {}) }),
  sunColor: new THREE.Color(1.0, 0.42, 0.24).multiplyScalar(3.4),
  shadowColor: new THREE.Color(0.4, 0.28, 0.68).multiplyScalar(0.9),
  farLight: 0.26,
  sudden: () => hallow.uFlash.value,
}

// --- the storm --------------------------------------------------------------------

interface Flash {
  start: number
  strength: number
  // strokes inside the envelope: seconds after the start and their weight
  strokes: [number, number][]
}

interface GhostRise {
  start: number
  struck: boolean
}

// seconds for the cloud to draw into the shape, before the lightning strikes
// inside it; how long it holds after; how long it takes to dissolve
const GHOST_FORM = 4
const GHOST_HOLD = 3
const GHOST_FADE = 7
// the first ghost's lightning, seconds after the garden shows
const FIRST_GHOST = 10

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a)
}

// brightness of a flash t seconds after it began: builds over half a second,
// flickers with its strokes, dies away over about two
function flashLevel(f: Flash, t: number): number {
  if (t < 0 || t > 2.6) return 0
  const build = THREE.MathUtils.smoothstep(t, 0, 0.5)
  const fade = t < 0.5 ? 1 : Math.max(0, 1 - (t - 0.5) / 2) ** 2
  let flick = 0
  for (const [at, w] of f.strokes) {
    const x = (t - at) / 0.08
    flick += w * Math.exp(-x * x)
  }
  return f.strength * build * fade * (0.45 + 0.55 * Math.min(1, flick))
}

class Storm implements RealmPart {
  readonly object = new THREE.Group()
  readonly kind = 'Storm'
  private began = -1
  private now = 0
  private flash: Flash | null = null
  private rise: GhostRise | null = null
  private nextFlash = 0
  private nextGhost = 0
  private hold = false
  private readonly pos = stormUniforms.uStormFlashPos.value
  private readonly dir = new THREE.Vector3()

  constructor() {
    if (new URLSearchParams(location.search).has('debug')) {
      const h = hallow as typeof hallow & { ghostNow?: () => void; flashNow?: () => void; ghostHold?: (on: boolean) => void }
      // for shots: the shape already drawn and the lightning striking in it now
      h.ghostNow = () => {
        this.rise = { start: this.now - GHOST_FORM, struck: true }
        this.strike(true, this.now)
        this.nextFlash = Math.max(this.nextFlash, this.now + 12)
      }
      h.flashNow = () => this.strike(false, this.now)
      // the ghost's lightning held at its peak, for a still of the moment
      h.ghostHold = (on) => {
        this.hold = on
        if (on) h.ghostNow!()
      }
    }
  }

  update(frame: Frame): void {
    const t = frame.t
    this.now = t
    if (this.began < 0) {
      this.began = t
      this.nextGhost = t + FIRST_GHOST - GHOST_FORM
      this.nextFlash = t + rand(3, 5)
    }
    stormUniforms.uStormT.value += frame.dt * frame.motion
    if (frame.motion === 0) {
      // reduced motion: no lightning, the ghost faint and still in its cloud
      hallow.uFlash.value = 0
      hallow.uGhost.value = 0.75
      stormUniforms.uStormGlow.value = 0.12
      return
    }
    stormUniforms.uStormGlow.value = 0

    if (!this.rise && t >= this.nextGhost) {
      this.rise = { start: t, struck: false }
      this.nextGhost = t + rand(40, 70)
      // no plain flash crowds the ghost's
      if (this.nextFlash < t + GHOST_FORM + 5) this.nextFlash = t + GHOST_FORM + rand(6, 10)
    }
    let ghost = 0
    if (this.rise) {
      const k = t - this.rise.start
      if (k >= GHOST_FORM && !this.rise.struck) {
        this.rise.struck = true
        this.strike(true, t)
      }
      const end = GHOST_FORM + GHOST_HOLD
      if (k < GHOST_FORM) ghost = THREE.MathUtils.smootherstep(k, 0, GHOST_FORM)
      else if (k < end) ghost = 1
      else ghost = 1 - THREE.MathUtils.smootherstep(k, end, end + GHOST_FADE)
      if (k > end + GHOST_FADE) this.rise = null
    }
    hallow.uGhost.value = ghost

    if (t >= this.nextFlash) {
      if (!this.rise) this.strike(false, t)
      this.nextFlash = t + rand(8, 20)
    }
    const f = this.flash
    hallow.uFlash.value = f ? Math.min(1, flashLevel(f, t - f.start)) : 0
    if (f && t - f.start > 2.6) this.flash = null
    if (this.hold) {
      hallow.uGhost.value = 1
      hallow.uFlash.value = 1
    }
  }

  private strike(ghost: boolean, t: number): void {
    if (ghost) {
      this.pos.set(GHOST_FOOT.x, GHOST_CHEST_Y, GHOST_FOOT.y)
    } else if (Math.random() < 0.6) {
      // inside a bank, at a third to two thirds of its height
      const b = BANKS[Math.floor(Math.random() * BANKS.length)]!
      this.pos.set(b[0] + rand(-150, 150), -55 + b[2] * rand(0.3, 0.6), b[1] + rand(-150, 150))
    } else {
      // deep in the sea far out, mostly in the half the garden faces
      const a = Math.random() < 0.7 ? rand(-1.6, 1.6) : rand(1.6, Math.PI * 2 - 1.6)
      const r = rand(1900, 3400)
      this.pos.set(Math.sin(a) * r, -70, -Math.cos(a) * r)
    }
    const strokes: [number, number][] = []
    const n = ghost ? 5 : 2 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) strokes.push([rand(0.3, ghost ? 1.8 : 1.4), rand(0.5, 1)])
    const strength = ghost ? 1 : rand(0.35, 0.8)
    this.flash = { start: t, strength, strokes }
    this.dir.copy(this.pos).normalize()
    hallow.uFlashDir.value.copy(this.dir)
    announceFlash(strength, this.dir, ghost)
  }

  dispose(): void {
    hallow.uFlash.value = 0
    hallow.uGhost.value = 0
  }
}

export const stormParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = [() => new Storm()]
