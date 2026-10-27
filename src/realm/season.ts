import type * as THREE from 'three'
import type { Frame, RealmPart, Tier } from './types'

// What the garden wears. The season is decided once, at load, from the
// visitor's local date; `?season=halloween` or `?season=none` overrides it.
// Nothing else in the code reads the date: each part asks for its dress here,
// and a season's code and shaders load only while it is worn, so a visitor
// outside it downloads and compiles nothing of it.

export type SeasonName = 'halloween'

// Halloween: from the 27th of October up to and including the 11th of November
const HALLOWEEN_FROM: [number, number] = [9, 27] // month index, day
const HALLOWEEN_TO: [number, number] = [10, 11]

function within(date: Date, from: [number, number], to: [number, number]): boolean {
  const m = date.getMonth()
  const d = date.getDate()
  const after = m > from[0] || (m === from[0] && d >= from[1])
  const before = m < to[0] || (m === to[0] && d <= to[1])
  return after && before
}

export function pickSeason(date: Date, search: string): SeasonName | null {
  const asked = new URLSearchParams(search).get('season')
  if (asked === 'none') return null
  if (asked === 'halloween') return 'halloween'
  if (within(date, HALLOWEEN_FROM, HALLOWEEN_TO)) return 'halloween'
  return null
}

export const SEASON: SeasonName | null = typeof location === 'undefined' ? null : pickSeason(new Date(), location.search)

// The light of the hour the season sets: the key light (the sun, or a moon
// standing where the sun stood), the sky's share of the light, the frame's
// exposure, and the colour of the air.
export interface LightDress {
  keyColor: THREE.Color
  keyIntensity: number
  environmentIntensity: number
  exposure: number
  fogColor: THREE.Color
  sunFogColor: THREE.Color
  // the light shafts and bloom take the key light's colour
  shaftColor: THREE.Color
  shafts: number
  bloom: number
  saturation: number
  // the height fog: its density per metre at fogHeight, and how fast it thins
  // upwards (a low, quick falloff keeps it as mist on the ground)
  fogDensity: number
  fogHeight?: number
  fogFalloff?: number
  // where the frame's glow and light shafts come from, if not the key light's
  // own direction (a moon drawn off the light's bearing)
  glowDirection?: THREE.Vector3
  // called each frame before the frame's light is set; may change the values
  // above (a lightning flash lifts the key light for a moment)
  update?(frame: Frame): void
}

// The photographed sky, regraded: GLSL that runs after the panorama is
// decoded to linear radiance, in the sky dome and wherever else a shader looks
// the sky up (the clouds). `glsl` declares its own uniforms (spread `uniforms`
// into the material as they are; some are read afresh each frame, so never
// clone them) and defines `vec3 dressSky(vec3 col, vec3 dir)`, col the
// linear panorama radiance seen in world direction dir. `domeGlsl` comes after
// it in the dome only and defines `vec3 dressSkyDisc(vec3 col, vec3 photo,
// vec3 dir)`, which adds what only the dome draws (the stars, the moon) to the
// graded col, photo being the panorama before the grade.
export interface SkyDress {
  glsl: string
  domeGlsl: string
  uniforms: Record<string, THREE.IUniform>
  // the image light, regraded the same way on the CPU (linear RGB in place)
  gradeEnvironment?(data: Float32Array, width: number, height: number): void
}

export interface Dress {
  name: SeasonName
  light?: LightDress
  sky?: SkyDress
  // parts the season adds, built after the garden's own, in order
  parts?: ((tier: Tier) => Promise<RealmPart> | RealmPart)[]
  // part dresses, keyed by the part's kind; each part types its own
  [kind: string]: unknown
}

let worn: Dress | null = null
let loading: Promise<Dress | null> | null = null

// loads the season's code, once; resolves to null outside a season
export function loadDress(): Promise<Dress | null> {
  if (!SEASON) return Promise.resolve(null)
  loading ??= import('./halloween').then((m) => (worn = m.dress))
  return loading
}

// the dress, once loadDress has resolved; null outside a season
export function dress(): Dress | null {
  return worn
}

// one part's dress, typed by the part
export function dressFor<T>(kind: string): T | null {
  return (worn?.[kind] as T | undefined) ?? null
}
