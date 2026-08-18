/**
 * The FPS-driven auto-throttle, as a pure state machine.
 *
 * It lives apart from the scene because it is the one piece of the render loop
 * that is decision, not drawing: given a frame rate and what it has seen
 * recently, it says which tier to run at. Kept here it can be stepped through
 * a synthetic FPS trace in a test, instead of only on hardware slow enough to
 * trigger it.
 */

export type Tier = 'ultra' | 'high' | 'low'

/** Weakest first, so a step is an index move. */
export const TIER_ORDER: readonly Tier[] = ['low', 'high', 'ultra']

/** Below this, the current tier is too expensive for the hardware. */
export const SLOW_FPS = 30
/** Above this, there is headroom for the next tier up. */
export const FAST_FPS = 58

/** Step DOWN after this many sustained slow windows: protect weak hardware quickly. */
export const SLOW_WINDOWS_TO_STEP_DOWN = 2
/** Step UP only after this many, so a brief calm does not promote a struggling machine. */
export const FAST_WINDOWS_TO_STEP_UP = 4
/** Windows to hold after any change (~6s at one window per 1.5s). */
export const COOLDOWN_WINDOWS = 4

export interface QualityState {
  tier: Tier
  slowWindows: number
  fastWindows: number
  cooldown: number
}

export const initialQualityState = (tier: Tier = 'high'): QualityState => ({
  tier,
  slowWindows: 0,
  fastWindows: 0,
  cooldown: 0,
})

/**
 * Advance one ~1.5s window. Damped so it cannot oscillate: a change starts a
 * cooldown, so a step up can never immediately undo a step down. Without that
 * the low<->high flip pops the reflection, mirror, city and koi and reallocates
 * GPU targets every window on borderline hardware.
 */
export const stepQuality = (state: QualityState, fps: number): QualityState => {
  if (state.cooldown > 0) {
    return { ...state, cooldown: state.cooldown - 1 }
  }

  const index = TIER_ORDER.indexOf(state.tier)

  if (fps < SLOW_FPS && index > 0) {
    const slowWindows = state.slowWindows + 1
    if (slowWindows >= SLOW_WINDOWS_TO_STEP_DOWN) {
      return {
        tier: TIER_ORDER[index - 1],
        slowWindows: 0,
        fastWindows: 0,
        cooldown: COOLDOWN_WINDOWS,
      }
    }
    return { ...state, slowWindows, fastWindows: 0 }
  }

  if (fps > FAST_FPS && index < TIER_ORDER.length - 1) {
    const fastWindows = state.fastWindows + 1
    if (fastWindows >= FAST_WINDOWS_TO_STEP_UP) {
      return {
        tier: TIER_ORDER[index + 1],
        slowWindows: 0,
        fastWindows: 0,
        cooldown: COOLDOWN_WINDOWS,
      }
    }
    return { ...state, slowWindows: 0, fastWindows }
  }

  // Anything in between, or already at the end of the range: the streak breaks.
  return { ...state, slowWindows: 0, fastWindows: 0 }
}
