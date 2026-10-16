// The composition of the island in one place. Every part places itself from
// these numbers, so moving a lantern or the pond here moves its grass gap,
// shadow and sound with it. Units are metres, +y up; the visitor walks from
// +z (the landing at the front edge) towards -z (the shrine).

export interface Vec2 {
  x: number
  z: number
}

// --- the island ------------------------------------------------------------

// half extents of the top surface before the edge noise
export const ISLAND_RX = 17
export const ISLAND_RZ = 24

// deterministic pseudo random numbers; every part seeds its own stream so the
// island is the same on every visit
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return s - Math.floor(s)
}

// smooth value noise in [0, 1]
export function noise2(x: number, z: number): number {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz)
  const b = hash2(ix + 1, iz)
  const c = hash2(ix, iz + 1)
  const d = hash2(ix + 1, iz + 1)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}

export function fbm2(x: number, z: number, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let f = 1
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * f, z * f) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

// Radius of the island outline along the direction `angle` (radians, 0 = +x,
// counter-clockwise seen from above), as a fraction of the ellipse. The noise
// keeps the rim from reading as a drawn ellipse.
export function rimScale(angle: number): number {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return 1 + (fbm2(c * 1.6 + 4.2, s * 1.6 - 1.3, 3) - 0.5) * 0.22
}

// > 0 inside the island top, < 0 outside, roughly in metres near the rim
export function islandSdf(x: number, z: number): number {
  const a = Math.atan2(z, x)
  const k = rimScale(a)
  const nx = x / (ISLAND_RX * k)
  const nz = z / (ISLAND_RZ * k)
  const r = Math.sqrt(nx * nx + nz * nz)
  return (1 - r) * Math.min(ISLAND_RX, ISLAND_RZ) * k
}

// --- the walk ---------------------------------------------------------------

export const PATH_HALF_WIDTH = 1.25
export const PATH_FRONT_Z = 21.5 // the landing at the front edge
export const LANDING = { zFront: 22.5, zBack: 17, halfWidth: 3.4 }
export const TORII_Z = 18.4
export const TORII_SPAN = 3.6 // between pillar centres

// the shrine terrace sits higher, held by a dry stone wall
export const TERRACE_Y = 1.25
export const TERRACE_FRONT_Z = -9 // face of the retaining wall
export const STEPS = { zFront: -8.2, zBack: -9.9, halfWidth: 1.5, count: 6 }

// gravel beds either side of the path and the shrine forecourt
export const GRAVEL_HALF_WIDTH = 2.75
export const FORECOURT = { xMin: -6.8, xMax: 8.2, zMin: -20, zMax: -9 }

export const SHRINE = { x: 0, z: -16.2, width: 7.2, depth: 5.4, rotation: 0 }
export const EMA_RACK = { x: 6.6, z: -12.6, rotation: -0.785 }
export const BASIN = { x: -4.6, z: -11.6, rotation: 0.5 }

// stone lanterns in the order they light
export const LANTERNS: readonly Vec2[] = [
  { x: -2.45, z: 13.2 },
  { x: 2.45, z: 13.2 },
  { x: -2.45, z: 5.6 },
  { x: 2.45, z: 5.6 },
  { x: -2.45, z: -1.9 },
  { x: 2.45, z: -1.9 },
  { x: -2.45, z: -11.9 },
  { x: 2.45, z: -11.9 },
]

// --- water ------------------------------------------------------------------

export const POND_LEVEL = -0.32 // water surface height
export const POND_DEPTH = 0.9 // bed below the surface at the deepest point

const POND_LOBES = [
  { x: -8.4, z: 2.4, rx: 4.3, rz: 3.3 },
  { x: -10.8, z: -0.8, rx: 2.8, rz: 2.3 },
  { x: -6.1, z: 5.2, rx: 2.1, rz: 1.7 },
]

// the outflow: a channel from the pond's west lobe to the rim, where the water
// falls off the island
export const OUTFLOW = { x0: -12.6, z0: -1.0, x1: -16.4, z1: -1.6, halfWidth: 0.75 }

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

// signed distance to the pond shore in metres (< 0 under water)
export function pondSdf(x: number, z: number): number {
  let d = Infinity
  for (const l of POND_LOBES) {
    const nx = (x - l.x) / l.rx
    const nz = (z - l.z) / l.rz
    const e = (Math.sqrt(nx * nx + nz * nz) - 1) * Math.min(l.rx, l.rz)
    d = smin(d, e, 1.6)
  }
  // a wobble so the shore is not a sum of ellipses
  d += (fbm2(x * 0.35 + 9.1, z * 0.35 - 3.7, 3) - 0.5) * 0.7
  // the channel
  const cx = OUTFLOW.x1 - OUTFLOW.x0
  const cz = OUTFLOW.z1 - OUTFLOW.z0
  const t = Math.max(0, Math.min(1, ((x - OUTFLOW.x0) * cx + (z - OUTFLOW.z0) * cz) / (cx * cx + cz * cz)))
  const px = OUTFLOW.x0 + cx * t - x
  const pz = OUTFLOW.z0 + cz * t - z
  const channel = Math.sqrt(px * px + pz * pz) - OUTFLOW.halfWidth
  return smin(d, channel, 0.8)
}

export const POND_BOUNDS = { xMin: -17, xMax: -2.5, zMin: -4.5, zMax: 8 }

// --- trees and plants -------------------------------------------------------

export const CHERRY = { x: -5.6, z: 8.9, lean: { x: -0.35, z: -0.2 }, height: 7.4, spread: 5.2 }
export const MAPLES: readonly { x: number; z: number; height: number; spread: number }[] = [
  { x: 6.2, z: -6.4, height: 5.2, spread: 3.6 },
  { x: 10.4, z: 6.8, height: 4.6, spread: 3.2 },
  { x: -6.8, z: -14.8, height: 4.9, spread: 3.3 },
]

// clipped azalea mounds: centre, radius, height
export const AZALEAS: readonly { x: number; z: number; r: number; h: number }[] = [
  { x: 4.6, z: -8.1, r: 1.25, h: 0.8 },
  { x: 6.1, z: -8.4, r: 0.95, h: 0.65 },
  { x: -4.4, z: -8.2, r: 1.1, h: 0.75 },
  { x: -5.9, z: -8.5, r: 0.8, h: 0.55 },
  { x: 5.6, z: 10.4, r: 1.3, h: 0.85 },
  { x: 7.4, z: 11.6, r: 0.9, h: 0.6 },
  { x: -3.4, z: 16.2, r: 0.9, h: 0.6 },
  { x: 8.6, z: -1.2, r: 1.1, h: 0.7 },
  { x: -2.9, z: 9.6, r: 0.7, h: 0.5 },
]

// --- the ground ---------------------------------------------------------------

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

// height of the top surface, without the pond basin
function baseHeight(x: number, z: number): number {
  // a soft rise towards the rim and gentle swells, so the lawn is not a table
  const swell = (fbm2(x * 0.09 + 2.0, z * 0.09 + 5.0, 3) - 0.5) * 0.9
  const terrace = TERRACE_Y * smooth(TERRACE_FRONT_Z + 0.4, TERRACE_FRONT_Z - 0.4, z)
  // the terrace is flat; the lawn swells
  const lawnWeight = 1 - smooth(TERRACE_FRONT_Z + 1.5, TERRACE_FRONT_Z - 0.5, z)
  return terrace + swell * lawnWeight
}

// the path and landing are laid level; the ground eases into them
function pathFlatten(x: number, z: number): number {
  const onPath = 1 - smooth(PATH_HALF_WIDTH + 0.4, GRAVEL_HALF_WIDTH + 1.2, Math.abs(x))
  const inRun = smooth(PATH_FRONT_Z + 1.5, PATH_FRONT_Z, z) * smooth(TERRACE_FRONT_Z - 0.5, TERRACE_FRONT_Z + 1, z)
  const landing =
    (1 - smooth(LANDING.halfWidth, LANDING.halfWidth + 1.5, Math.abs(x))) *
    smooth(LANDING.zFront + 1, LANDING.zFront, z) *
    smooth(LANDING.zBack - 1.5, LANDING.zBack, z)
  return Math.max(onPath * inRun, landing)
}

// Height of the ground at (x, z): lawn, terrace, the pond bed. Paths and the
// forecourt are flat at 0 or TERRACE_Y.
export function groundHeight(x: number, z: number): number {
  let h = baseHeight(x, z)
  const flat = z < TERRACE_FRONT_Z ? TERRACE_Y : 0
  h += (flat - h) * pathFlatten(x, z)
  if (z < TERRACE_FRONT_Z - 0.4) h = TERRACE_Y + (h - TERRACE_Y) * (1 - forecourtWeight(x, z))
  // the pond basin: a bowl below the water line, with a soft bank
  const pd = pondSdf(x, z)
  if (pd < 1.2) {
    const bank = smooth(1.2, -0.2, pd)
    const bowl = POND_LEVEL - 0.08 - POND_DEPTH * smooth(0, -2.8, pd)
    h = h + (Math.min(h, bowl) - h) * bank
  }
  return h
}

export function forecourtWeight(x: number, z: number): number {
  const fx = smooth(FORECOURT.xMin - 0.6, FORECOURT.xMin + 0.3, x) * smooth(FORECOURT.xMax + 0.6, FORECOURT.xMax - 0.3, x)
  const fz = smooth(FORECOURT.zMin - 0.6, FORECOURT.zMin + 0.3, z) * smooth(FORECOURT.zMax + 0.2, FORECOURT.zMax - 0.4, z)
  return fx * fz
}

// 0..1: how much of the ground at (x, z) is paved path or landing
export function pathWeight(x: number, z: number): number {
  const run = (1 - smooth(PATH_HALF_WIDTH - 0.02, PATH_HALF_WIDTH + 0.02, Math.abs(x))) *
    smooth(PATH_FRONT_Z + 0.02, PATH_FRONT_Z - 0.02, z) * smooth(SHRINE.z + SHRINE.depth / 2, SHRINE.z + SHRINE.depth / 2 + 0.1, z)
  const landing =
    (1 - smooth(LANDING.halfWidth - 0.02, LANDING.halfWidth + 0.02, Math.abs(x))) *
    smooth(LANDING.zFront + 0.02, LANDING.zFront - 0.02, z) *
    smooth(LANDING.zBack - 0.02, LANDING.zBack + 0.02, z)
  return Math.max(run, landing)
}

// 0..1: raked gravel (beside the path on the lower lawn, the forecourt above)
export function gravelWeight(x: number, z: number): number {
  const beds =
    (1 - smooth(GRAVEL_HALF_WIDTH - 0.15, GRAVEL_HALF_WIDTH + 0.15, Math.abs(x))) *
    smooth(LANDING.zBack + 0.2, LANDING.zBack - 0.2, z) *
    smooth(TERRACE_FRONT_Z + 0.6, TERRACE_FRONT_Z + 1.0, z)
  return Math.max(beds, forecourtWeight(x, z)) * (1 - pathWeight(x, z))
}

// 0..1: where grass grows. Everything that is not path, gravel, water, a
// building or too close to the rim.
export function lawnWeight(x: number, z: number): number {
  const rim = smooth(0.4, 2.2, islandSdf(x, z))
  const water = smooth(0.15, 0.9, pondSdf(x, z))
  const hard = 1 - Math.max(pathWeight(x, z), gravelWeight(x, z))
  let w = rim * water * hard
  // nothing grows on the steps or the retaining wall face
  if (Math.abs(z - TERRACE_FRONT_Z) < 0.5) w *= smooth(0.0, 0.5, Math.abs(z - TERRACE_FRONT_Z))
  // a bare ring under each lantern base
  for (const l of LANTERNS) {
    const dx = x - l.x
    const dz = z - l.z
    w *= smooth(0.45, 0.8, Math.sqrt(dx * dx + dz * dz))
  }
  return clamp01(w)
}
