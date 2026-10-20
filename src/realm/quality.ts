/**
 * How sharp the garden is drawn, decided only by what this device measures.
 *
 * The scene starts at the screen's own pixel density. A few synchronised
 * frames in the dark warm-up give the first number; after that the render
 * loop reports the cost of every frame (GPU time where the browser offers a
 * timer, else the time between frames) and the resolution follows it in 10%
 * steps. Nothing here looks at the GPU's name, the OS, touch or the screen
 * size. Kept as plain functions so a synthetic frame trace can drive it in a
 * test.
 */

import type { Tier } from './types'

/** One step is 10% fewer pixels per side. */
export const STEP = 0.9
/** The lowest scale: about half the screen's pixels per side. */
export const MIN_SCALE = STEP ** 6
/** Seconds of frames per decision window. */
export const WINDOW_SECONDS = 2
/** A window is slow when its 75th percentile frame is this far over the budget. */
export const SLOW_RATIO = 1.12
/**
 * With a GPU timer, a window has room for a step up below this share of the
 * budget: the next step draws 1 / 0.81 as many pixels and must stay under 85%.
 */
export const ROOM_RATIO = 0.85 * STEP * STEP
/** Good windows in a row before a step up is tried (about six seconds). */
export const GOOD_TO_STEP_UP = 3
/** Windows to wait after any change, while new targets settle. */
export const SETTLE_WINDOWS = 1
/** After a step up that failed, wait this many windows before trying again; doubles each time. */
export const FIRST_BACKOFF = 8
export const MAX_BACKOFF = 64

export interface ScaleState {
  scale: number
  /** good windows in a row at this scale */
  good: number
  /** windows left before the next decision */
  settle: number
  /** the scale a step up last failed at, and how long to stay below it */
  failedAt: number
  backoff: number
  wait: number
  /** the last step was an upward try, still on probation */
  probing: boolean
}

export const initialScaleState = (scale = 1): ScaleState => ({
  scale: snapScale(scale),
  good: 0,
  settle: SETTLE_WINDOWS,
  failedAt: Infinity,
  backoff: FIRST_BACKOFF,
  wait: 0,
  probing: false,
})

/** The nearest step at or below `s`, within [MIN_SCALE, 1]. */
export function snapScale(s: number): number {
  if (!(s < 1)) return 1
  const n = Math.min(6, Math.ceil(Math.log(s) / Math.log(STEP) - 1e-9))
  return STEP ** n
}

/**
 * The first scale from a measured frame cost at full resolution. The pixel
 * work scales with the area, so the side scales with the square root; aim a
 * little under the budget so the first seconds are smooth.
 */
export function initialScale(costMs: number, budgetMs: number): number {
  if (!(costMs > 0)) return 1
  return snapScale(Math.sqrt((budgetMs * 0.85) / costMs))
}

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0
  const a = [...values].sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.floor(a.length * p))]!
}

export interface Window {
  /** 75th percentile cost of the window's frames, in milliseconds */
  p75: number
  /** the time one frame may take at the current frame cap */
  budget: number
  /** the cost is the GPU's own (timer query), not the time between frames */
  timed: boolean
}

/**
 * Advance one window. Down quickly when slow, up slowly and only with
 * evidence: with a GPU timer the cost of the next step is predicted; without
 * one a step up is tried, and if it fails the same step waits twice as long
 * before the next try, so a borderline device settles instead of flickering.
 */
export function stepScale(state: ScaleState, w: Window): ScaleState {
  if (state.settle > 0) return { ...state, settle: state.settle - 1 }
  const wait = Math.max(0, state.wait - 1)
  if (w.p75 > w.budget * SLOW_RATIO) {
    if (state.scale <= MIN_SCALE) return { ...state, good: 0, wait, probing: false }
    // with the GPU's own time the right scale can be computed; frame gaps
    // only say "too slow": one step, or two when far over
    const target = w.timed
      ? Math.min(state.scale * STEP, snapScale(state.scale * Math.sqrt((w.budget * 0.85) / w.p75)))
      : state.scale * (w.p75 > w.budget * 2 ? STEP * STEP : STEP)
    const scale = Math.max(MIN_SCALE, snapScale(target + 1e-9))
    const failed = state.probing
    return {
      scale,
      good: 0,
      settle: SETTLE_WINDOWS,
      failedAt: failed ? state.scale : state.failedAt,
      backoff: failed ? Math.min(MAX_BACKOFF, state.backoff * 2) : state.backoff,
      wait: failed ? state.backoff : wait,
      probing: false,
    }
  }
  if (state.scale >= 1) return { ...state, good: 0, wait, probing: false }
  // one step up costs about 1 / 0.81 more pixels: with the GPU's time that
  // must still fit; frame gaps cannot show room, only that the frames keep up
  const roomy = w.timed ? w.p75 < w.budget * ROOM_RATIO : w.p75 <= w.budget * SLOW_RATIO
  const good = roomy ? state.good + 1 : 0
  const next = snapScale(state.scale / STEP + 1e-9)
  const blocked = wait > 0 && next >= state.failedAt - 1e-9
  if (good >= GOOD_TO_STEP_UP && !blocked) {
    return { ...state, scale: next, good: 0, settle: SETTLE_WINDOWS, wait, probing: !w.timed }
  }
  // a step that held for a full window is no longer on probation
  return { ...state, good, wait, probing: false }
}

// The amount of garden (instances, texture sizes, passes) is chosen before
// the build and cannot follow the frames live. When the lowest resolution is
// still far too slow, the page builds the garden again one level lighter and
// this device remembers that level, in its own storage only; it is forgotten
// after a week, so a later visit (another browser version, a plugged-in
// laptop) measures the full garden again.
const LEVELS: readonly Tier[] = ['ultra', 'high', 'phone']
const KEY = 'realm-level'
const KEEP_MS = 7 * 24 * 3600 * 1000

export function lighterLevel(tier: Tier): Tier | null {
  return LEVELS[LEVELS.indexOf(tier) + 1] ?? null
}

export function rememberedLevel(): Tier | null {
  try {
    const [level, at] = (localStorage.getItem(KEY) ?? '').split(' ')
    if (!LEVELS.includes(level as Tier) || !(Date.now() - Number(at) < KEEP_MS)) return null
    return level as Tier
  } catch {
    return null
  }
}

export function rememberLevel(tier: Tier | null): void {
  try {
    if (tier && tier !== 'ultra') localStorage.setItem(KEY, `${tier} ${Date.now()}`)
    else localStorage.removeItem(KEY)
  } catch {
    // storage blocked: the next visit measures again
  }
}
