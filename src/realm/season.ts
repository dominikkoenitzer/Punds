import type * as THREE from 'three'
import seasons from 'virtual:seasons'
import type { Frame, RealmPart, Tier } from './types'

// What the garden wears. The season is decided once, at load, from the
// visitor's local date; `?season=<name>` or `?season=none` overrides it.
// Nothing else in the code reads the date: each part asks for its dress here,
// and a season's code and shaders load only while it is worn, so a visitor
// outside it downloads and compiles nothing of it.
//
// Each season is a folder in seasons/ with its dress (index.ts) and its dates
// (calendar.json); this file names none of them. See docs/seasons.md.

export type SeasonName = string

// when a season is worn: months 1 to 12, from and to both included, and the
// range may run over the new year; where two overlap, the higher priority
// wins, then the name first in order. `poster` is true when the season has
// its own start pictures in public/realm/seasons/<name>/.
export interface Calendar {
  from: [number, number]
  to: [number, number]
  priority: number
  poster: boolean
}

// every season, by name, as tools/seasons.mjs read them at build
export const SEASONS: Readonly<Record<SeasonName, Calendar>> = seasons

const dresses = import.meta.glob<Dress | undefined>('./seasons/*/index.ts', { import: 'dress' })

function within(date: Date, { from, to }: Calendar): boolean {
  const day = (date.getMonth() + 1) * 100 + date.getDate()
  const start = from[0] * 100 + from[1]
  const end = to[0] * 100 + to[1]
  return start <= end ? day >= start && day <= end : day >= start || day <= end
}

// keep in step with the poster script in index.html (season.test.ts runs both)
export function pickSeason(date: Date, search: string, registry: Readonly<Record<SeasonName, Calendar>> = SEASONS): SeasonName | null {
  const asked = new URLSearchParams(search).get('season')
  if (asked === 'none') return null
  if (asked !== null && Object.hasOwn(registry, asked)) return asked
  let best: SeasonName | null = null
  for (const name of Object.keys(registry).sort()) {
    if (within(date, registry[name]) && (best === null || registry[name].priority > registry[best].priority)) best = name
  }
  return best
}

// The poster script in index.html already chose before the first paint and
// left its choice on the root element; take it, so the start picture and the
// dress agree even when the page loads across midnight.
export function wornSeason(chosen: string | undefined, date: Date, search: string, registry: Readonly<Record<SeasonName, Calendar>> = SEASONS): SeasonName | null {
  if (chosen === 'none') return null
  if (chosen !== undefined && Object.hasOwn(registry, chosen)) return chosen
  return pickSeason(date, search, registry)
}

export const SEASON: SeasonName | null = typeof document === 'undefined' ? null : wornSeason(document.documentElement.dataset.season, new Date(), location.search)

// the folder of the start pictures for the season worn
export function posterFolder(season: SeasonName | null = SEASON, registry: Readonly<Record<SeasonName, Calendar>> = SEASONS): string {
  return season !== null && registry[season]?.poster ? `/realm/seasons/${season}` : '/realm'
}

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

// a season's dress from its loader; when there is none, or it fails to load,
// the garden goes undressed rather than not at all
export async function fetchDress(season: SeasonName, load: (() => Promise<Dress | undefined>) | undefined): Promise<Dress | null> {
  try {
    const found = await load?.()
    if (found) return found
    console.warn(`season ${season}: no dress`)
  } catch (err) {
    console.warn(`season ${season}: the dress did not load`, err)
  }
  return null
}

// loads the season's code, once; resolves to null outside a season
export function loadDress(): Promise<Dress | null> {
  if (SEASON === null) return Promise.resolve(null)
  loading ??= fetchDress(SEASON, dresses[`./seasons/${SEASON}/index.ts`]).then((found) => (worn = found))
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
