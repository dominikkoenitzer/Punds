import { describe, expect, it } from 'vitest'

import {
  FIRST_BACKOFF,
  GOOD_TO_STEP_UP,
  MIN_SCALE,
  STEP,
  initialScale,
  initialScaleState,
  percentile,
  snapScale,
  stepScale,
  type ScaleState,
  type Window,
} from './quality'

const BUDGET = 1000 / 60
const run = (state: ScaleState, w: Window, windows: number): ScaleState => {
  let s = state
  for (let i = 0; i < windows; i++) s = stepScale(s, w)
  return s
}
const gaps = (p75: number): Window => ({ p75, budget: BUDGET, timed: false })
const gpu = (p75: number): Window => ({ p75, budget: BUDGET, timed: true })

describe('scales', () => {
  it('snaps to 10% steps between half and full resolution', () => {
    expect(snapScale(1.4)).toBe(1)
    expect(snapScale(1)).toBe(1)
    expect(snapScale(0.95)).toBeCloseTo(STEP)
    expect(snapScale(STEP)).toBeCloseTo(STEP)
    expect(snapScale(STEP * STEP)).toBeCloseTo(STEP * STEP)
    expect(snapScale(0.01)).toBeCloseTo(MIN_SCALE)
    expect(MIN_SCALE).toBeGreaterThan(0.5)
  })

  it('starts at full resolution when the measured frame fits', () => {
    expect(initialScale(6, BUDGET)).toBe(1)
    expect(initialScale(14, BUDGET)).toBe(1)
    expect(initialScale(0, BUDGET)).toBe(1)
  })

  it('starts lower in proportion to the measured cost', () => {
    // four times the budget: half the side
    expect(initialScale(BUDGET * 4, BUDGET)).toBeCloseTo(snapScale(Math.sqrt(0.9 / 4)))
    expect(initialScale(BUDGET * 100, BUDGET)).toBeCloseTo(MIN_SCALE)
  })

  it('takes percentiles of unsorted frames', () => {
    expect(percentile([5, 1, 4, 2, 3], 0.75)).toBe(4)
    expect(percentile([], 0.75)).toBe(0)
  })
})

describe('a fast device', () => {
  it('stays at full resolution for good', () => {
    const s = run(initialScaleState(1), gaps(BUDGET), 100)
    expect(s.scale).toBe(1)
  })

  it('ignores the first window after a change', () => {
    const s = stepScale(initialScaleState(1), gaps(BUDGET * 3))
    expect(s.scale).toBe(1)
  })
})

describe('stepping down', () => {
  it('steps one 10% step per slow window when only frame gaps are known', () => {
    let s = run(initialScaleState(1), gaps(BUDGET * 1.5), 2)
    expect(s.scale).toBeCloseTo(STEP)
    s = run(s, gaps(BUDGET * 1.5), 2)
    expect(s.scale).toBeCloseTo(STEP * STEP)
  })

  it('jumps straight to the right scale when the GPU time is known', () => {
    const s = run(initialScaleState(1), gpu(BUDGET * 2), 2)
    expect(s.scale).toBeCloseTo(snapScale(Math.sqrt(0.85 / 2)))
  })

  it('steps twice when the frames take more than twice the budget', () => {
    const s = run(initialScaleState(1), gaps(BUDGET * 2.5), 2)
    expect(s.scale).toBeCloseTo(STEP * STEP)
  })

  it('never goes below the lowest scale', () => {
    const s = run(initialScaleState(1), gaps(BUDGET * 10), 40)
    expect(s.scale).toBeCloseTo(MIN_SCALE)
  })

  it('treats a frame just over the budget as noise, not as slow', () => {
    const s = run(initialScaleState(1), gaps(BUDGET * 1.05), 20)
    expect(s.scale).toBe(1)
  })
})

describe('stepping up', () => {
  it('climbs back with GPU room, one step per few windows', () => {
    let s = initialScaleState(STEP ** 3)
    s = run(s, gpu(BUDGET * 0.3), 1 + GOOD_TO_STEP_UP)
    expect(s.scale).toBeCloseTo(STEP ** 2)
    s = run(s, gpu(BUDGET * 0.3), 30)
    expect(s.scale).toBe(1)
  })

  it('does not climb when the GPU has no room for the next step', () => {
    const s = run(initialScaleState(STEP), gpu(BUDGET * 0.8), 30)
    expect(s.scale).toBeCloseTo(STEP)
  })

  it('climbs when only part of the cost grows with the pixels', () => {
    // 0.72 of the budget: about 0.85 of it one step up with a quarter fixed
    const s = run(initialScaleState(STEP), gpu(BUDGET * 0.72), 1 + GOOD_TO_STEP_UP)
    expect(s.scale).toBe(1)
  })

  it('backs off after a step up the GPU time proves wrong', () => {
    let s = run(initialScaleState(STEP), gpu(BUDGET * 0.72), 1 + GOOD_TO_STEP_UP)
    s = run(s, gpu(BUDGET * 1.3), 2)
    expect(s.scale).toBeLessThan(1)
    expect(s.failedAt).toBe(1)
    expect(s.wait).toBe(FIRST_BACKOFF)
  })

  it('without a timer, tries a step up and backs off when it fails', () => {
    let s = initialScaleState(STEP)
    s = run(s, gaps(BUDGET), 1 + GOOD_TO_STEP_UP)
    expect(s.scale).toBe(1)
    expect(s.probing).toBe(true)
    // too slow at full: back down, and full is off limits for a while
    s = run(s, gaps(BUDGET * 1.4), 2)
    expect(s.scale).toBeCloseTo(STEP)
    expect(s.wait).toBe(FIRST_BACKOFF)
    s = run(s, gaps(BUDGET), 1 + GOOD_TO_STEP_UP)
    expect(s.scale).toBeCloseTo(STEP)
  })

  it('waits twice as long after each failed try, so it never flickers', () => {
    let s = initialScaleState(STEP)
    const tries: number[] = []
    for (let w = 0; w < 400; w++) {
      const before = s.scale
      // full resolution is too slow on this device, 0.9 is fine
      s = stepScale(s, gaps(s.scale >= 1 ? BUDGET * 1.4 : BUDGET))
      if (s.scale > before) tries.push(w)
    }
    const gapsBetween = tries.slice(1).map((t, i) => t - tries[i]!)
    for (let i = 1; i < gapsBetween.length; i++) expect(gapsBetween[i]!).toBeGreaterThanOrEqual(gapsBetween[i - 1]!)
    expect(tries.length).toBeLessThan(10)
  })

  it('keeps a step that held for a full window', () => {
    let s = initialScaleState(STEP)
    s = run(s, gaps(BUDGET), 1 + GOOD_TO_STEP_UP)
    s = run(s, gaps(BUDGET), 2)
    expect(s.scale).toBe(1)
    expect(s.probing).toBe(false)
  })
})
