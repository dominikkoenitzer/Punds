import { describe, expect, it } from 'vitest'

import {
  COOLDOWN_WINDOWS,
  FAST_WINDOWS_TO_STEP_UP,
  SLOW_WINDOWS_TO_STEP_DOWN,
  TIER_ORDER,
  initialQualityState,
  stepQuality,
  type QualityState,
  type Tier,
} from './qualityStepper'

/** Feed a run of identical windows, as the render loop would. */
const run = (state: QualityState, fps: number, windows: number): QualityState => {
  let current = state
  for (let i = 0; i < windows; i += 1) current = stepQuality(current, fps)
  return current
}

const SLOW = 20
const FAST = 60
const STEADY = 45

describe('tier order', () => {
  it('runs weakest to strongest', () => {
    expect(TIER_ORDER).toEqual(['low', 'high', 'ultra'])
  })
})

describe('stepping down', () => {
  it('does not drop on a single slow window', () => {
    // One noisy 1.5s window is not evidence; dropping on it pops the
    // reflection and the city for a stutter that may not repeat.
    const state = stepQuality(initialQualityState('high'), SLOW)
    expect(state.tier).toBe('high')
  })

  it('drops after two sustained slow windows', () => {
    const state = run(initialQualityState('high'), SLOW, SLOW_WINDOWS_TO_STEP_DOWN)
    expect(state.tier).toBe('low')
  })

  it('walks all the way down from ultra under sustained load', () => {
    let state = initialQualityState('ultra')
    for (let window = 0; window < 40; window += 1) state = stepQuality(state, SLOW)
    expect(state.tier).toBe('low')
  })

  it('will not go below the weakest tier', () => {
    const state = run(initialQualityState('low'), SLOW, 50)
    expect(state.tier).toBe('low')
  })

  it('forgets a slow streak that is broken by a normal window', () => {
    let state = stepQuality(initialQualityState('high'), SLOW)
    state = stepQuality(state, STEADY)
    state = stepQuality(state, SLOW)

    // The streak restarted, so this second slow window is the first of a new run.
    expect(state.tier).toBe('high')
  })
})

describe('stepping up', () => {
  it('needs a longer streak than a step down', () => {
    // Promotion is the risky direction: a machine that just recovered should
    // have to prove it for longer than one that is struggling.
    expect(FAST_WINDOWS_TO_STEP_UP).toBeGreaterThan(SLOW_WINDOWS_TO_STEP_DOWN)
  })

  it('does not promote before the streak is met', () => {
    const state = run(initialQualityState('high'), FAST, FAST_WINDOWS_TO_STEP_UP - 1)
    expect(state.tier).toBe('high')
  })

  it('promotes after four sustained fast windows', () => {
    const state = run(initialQualityState('high'), FAST, FAST_WINDOWS_TO_STEP_UP)
    expect(state.tier).toBe('ultra')
  })

  it('will not go above the strongest tier', () => {
    const state = run(initialQualityState('ultra'), FAST, 50)
    expect(state.tier).toBe('ultra')
  })

  it('forgets a fast streak that is broken', () => {
    let state = run(initialQualityState('high'), FAST, FAST_WINDOWS_TO_STEP_UP - 1)
    state = stepQuality(state, STEADY)
    state = run(state, FAST, FAST_WINDOWS_TO_STEP_UP - 1)

    expect(state.tier).toBe('high')
  })
})

describe('the cooldown', () => {
  it('holds for four windows after a change', () => {
    const dropped = run(initialQualityState('high'), SLOW, SLOW_WINDOWS_TO_STEP_DOWN)
    expect(dropped.cooldown).toBe(COOLDOWN_WINDOWS)
  })

  it('stops a step down from being undone immediately', () => {
    // This is the oscillation the damping exists to prevent: dropping to low on
    // a stutter, then bouncing straight back up because low runs fast.
    let state = run(initialQualityState('high'), SLOW, SLOW_WINDOWS_TO_STEP_DOWN)
    expect(state.tier).toBe('low')

    state = run(state, FAST, COOLDOWN_WINDOWS)
    expect(state.tier).toBe('low')
  })

  it('lets a change through once it has expired', () => {
    let state = run(initialQualityState('high'), SLOW, SLOW_WINDOWS_TO_STEP_DOWN)
    state = run(state, FAST, COOLDOWN_WINDOWS + FAST_WINDOWS_TO_STEP_UP)
    expect(state.tier).toBe('high')
  })

  it('counts down one window at a time and changes nothing else', () => {
    const dropped = run(initialQualityState('high'), SLOW, SLOW_WINDOWS_TO_STEP_DOWN)
    const next = stepQuality(dropped, SLOW)

    expect(next.cooldown).toBe(dropped.cooldown - 1)
    expect(next.tier).toBe(dropped.tier)
  })
})

describe('borderline hardware', () => {
  it('settles instead of flipping every window', () => {
    // A machine that renders low fast and high slow used to pop the reflection,
    // mirror, city and koi on every window and reallocate GPU targets with it.
    let state = initialQualityState('high')
    const tiers: Tier[] = []

    for (let window = 0; window < 60; window += 1) {
      state = stepQuality(state, state.tier === 'low' ? FAST : SLOW)
      tiers.push(state.tier)
    }

    const changes = tiers.filter((tier, i) => i > 0 && tier !== tiers[i - 1]).length

    // Without the cooldown this alternates; a handful of changes over 60
    // windows (~90 seconds) is the damping doing its job.
    expect(changes).toBeLessThan(10)
  })

  it('leaves a comfortable machine where it is', () => {
    const state = run(initialQualityState('high'), STEADY, 100)

    expect(state.tier).toBe('high')
    expect(state.slowWindows).toBe(0)
    expect(state.fastWindows).toBe(0)
  })
})

describe('purity', () => {
  it('does not mutate the state it is given', () => {
    const state = initialQualityState('high')
    const snapshot = { ...state }

    stepQuality(state, SLOW)

    expect(state).toEqual(snapshot)
  })
})
