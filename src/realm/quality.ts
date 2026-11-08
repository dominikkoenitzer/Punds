/**
 * How sharp the garden is drawn and how much of it is built, decided only by
 * what this device measures.
 *
 * A scale of 1 is the screen's own resolution (see resize in realm.ts); the
 * steps only go down from there and back up to it. A few synchronised frames
 * in the dark warm-up give the first number; after that the render loop
 * reports the cost of its frames (GPU time where the browser offers a timer,
 * else every fourth frame waited for until the GPU is done) and the
 * resolution follows it in 10% steps. Nothing here looks at the GPU's name,
 * the OS, touch or the screen size. Kept as plain functions so a synthetic
 * frame trace can drive it in a test.
 */

import type { Tier } from './types'

/** One step is 10% fewer pixels per side. */
export const STEP = 0.9
/** The lowest scale: about half the tier's pixels per side. */
export const MIN_SCALE = STEP ** 6
/** Seconds of frames per decision window. */
export const WINDOW_SECONDS = 2
/** A window is slow when its 75th percentile frame is this far over the budget. */
export const SLOW_RATIO = 1.12
/**
 * With a GPU timer, the predicted cost of the next step up must stay under
 * this share of the budget. Part of a frame does not grow with the pixels
 * (shadows, the cloud march at its own size), so a quarter is taken as fixed.
 */
export const ROOM_RATIO = 0.9
export const PIXEL_SHARE = 0.75
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
 * little under the budget so the first seconds are smooth. Taking all of
 * the cost as pixel work errs low; the live steps climb back from there.
 */
export function initialScale(costMs: number, budgetMs: number): number {
  if (!(costMs > 0)) return 1
  return snapScale(Math.sqrt((budgetMs * 0.9) / costMs))
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
// the cost one step up in resolution would have still fits the budget
function roomForStep(w: Window): boolean {
  return w.p75 * (1 - PIXEL_SHARE + PIXEL_SHARE / (STEP * STEP)) < w.budget * ROOM_RATIO
}

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
  // one step up draws 1 / 0.81 as many pixels: with the GPU's time the cost
  // there must still fit; frame gaps cannot show room, only that frames keep up
  const roomy = w.timed ? roomForStep(w) : w.p75 <= w.budget * SLOW_RATIO
  const good = roomy ? state.good + 1 : 0
  const next = snapScale(state.scale / STEP + 1e-9)
  const blocked = wait > 0 && next >= state.failedAt - 1e-9
  if (good >= GOOD_TO_STEP_UP && !blocked) {
    return { ...state, scale: next, good: 0, settle: SETTLE_WINDOWS, wait, probing: true }
  }
  // a step that held for a full window is no longer on probation
  return { ...state, good, wait, probing: false }
}

// The amount of garden (instances, texture sizes, passes) is chosen before
// the build and cannot follow the frames live, so it moves by visits. A device
// that has measured nothing yet builds the lightest level: the small maps, no
// close-up upgrade, the 4k sky, so nothing heavy is downloaded before the
// device has shown it can draw it. A visit whose frames held the full
// resolution with room to spare, after a finished build, lets the next visit
// build one level more. When the lowest resolution is still far too slow, the
// page builds the garden again one level lighter at once. A build that never
// reached its first frame (a tab the browser closed for its memory) makes the
// next visit one level lighter. Each level is kept in this device's own storage
// only and forgotten after a week, so a later visit (another browser version,
// a plugged-in laptop) measures again. Nothing here looks at the device's name,
// pointer or screen.
const LEVELS: readonly Tier[] = ['ultra', 'high', 'phone']
export const BASE_LEVEL: Tier = 'phone'
const KEY = 'realm-level'
const BUILD_KEY = 'realm-build'
const KEEP_MS = 7 * 24 * 3600 * 1000

export function lighterLevel(tier: Tier): Tier | null {
  return LEVELS[LEVELS.indexOf(tier) + 1] ?? null
}

export function heavierLevel(tier: Tier): Tier | null {
  return LEVELS[LEVELS.indexOf(tier) - 1] ?? null
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

export function rememberLevel(tier: Tier): void {
  try {
    localStorage.setItem(KEY, `${tier} ${Date.now()}`)
  } catch {
    // storage blocked: the next visit starts at the base level again
  }
}

/**
 * The level this visit builds: a level asked for in the address, the base
 * level for a visitor saving data, else what this device measured before, one
 * level lighter when its last build never finished, else the base level.
 */
export function startLevel(search: string, saveData: boolean): Tier {
  const forced = new URLSearchParams(search).get('tier')
  if (forced === 'ultra' || forced === 'high' || forced === 'phone') return forced
  if (saveData) return BASE_LEVEL
  const broken = unfinishedBuild()
  const remembered = rememberedLevel() ?? BASE_LEVEL
  if (broken) {
    clearBuild()
    const lighter = lighterLevel(broken) ?? BASE_LEVEL
    // the lighter of the two, so a later good visit cannot hide the crash
    const level = LEVELS.indexOf(lighter) > LEVELS.indexOf(remembered) ? lighter : remembered
    rememberLevel(level)
    return level
  }
  return remembered
}

// The build guard. A mark is set while a build runs and cleared when its first
// frame is ready, or when the visitor leaves (pagehide, which a tab the
// browser kills never sends). A mark still there at the next visit is a build
// that took the tab down.
function unfinishedBuild(): Tier | null {
  try {
    const level = localStorage.getItem(BUILD_KEY)
    return LEVELS.includes(level as Tier) ? (level as Tier) : null
  } catch {
    return null
  }
}

export function markBuild(tier: Tier): void {
  try {
    localStorage.setItem(BUILD_KEY, tier)
  } catch {
    // storage blocked: no guard, the step down still measures
  }
}

export function clearBuild(): void {
  try {
    localStorage.removeItem(BUILD_KEY)
  } catch {
    // nothing to clear
  }
}

/**
 * Room for more garden: the frame at the full resolution, timed by the GPU or
 * waited for, is within the budget with the same room a step up in
 * resolution needs (stepScale).
 */
export function hasRoom(scale: number, w: Window): boolean {
  return scale >= 1 && w.timed && roomForStep(w)
}

/** Windows in a row with room, at full resolution, before the next visit may build more. */
export const ROOM_TO_LEVEL_UP = GOOD_TO_STEP_UP

/** After one window: the windows with room so far, and the level the next visit may build, once there is enough room. */
export function levelAfter(tier: Tier, roomy: number, scale: number, w: Window): { roomy: number; next: Tier | null } {
  const n = hasRoom(scale, w) ? roomy + 1 : 0
  return { roomy: n, next: n === ROOM_TO_LEVEL_UP ? (heavierLevel(tier) ?? tier) : null }
}

/**
 * The calm rate (30 a second) all the time, from the first measured frame: on a
 * device that would miss the full rate even at the lowest resolution, frames
 * at half the rate and a sharper picture serve it better than a full rate it
 * cannot hold.
 */
export function calmOnly(costAtFull: number, fullBudget: number): boolean {
  return costAtFull * (1 - PIXEL_SHARE + PIXEL_SHARE * MIN_SCALE * MIN_SCALE) > fullBudget
}
