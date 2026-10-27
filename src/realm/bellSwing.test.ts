import { describe, expect, it } from 'vitest'

import { BellSwing } from './bellSwing'

/** Step at the phone's 30 frames a second and keep the widest swing seen. */
const run = (swing: BellSwing, seconds: number) => {
  let rope = 0
  let bell = 0
  for (let i = 0; i < seconds * 30; i += 1) {
    swing.step(1 / 30)
    rope = Math.max(rope, Math.abs(swing.rope))
    bell = Math.max(bell, Math.abs(swing.bell))
  }
  return { rope, bell }
}

describe('bell swing', () => {
  it('holds still until rung', () => {
    const swing = new BellSwing()
    expect(run(swing, 2)).toEqual({ rope: 0, bell: 0 })
    expect(swing.moving).toBe(false)
  })

  it('swings the rope and rocks the bell after it', () => {
    const swing = new BellSwing()
    swing.ring(1)
    swing.step(1 / 30)
    expect(swing.rope).toBeGreaterThan(0)
    const seen = run(swing, 3)
    expect(seen.rope).toBeGreaterThan(0.15)
    expect(seen.rope).toBeLessThan(0.5)
    expect(seen.bell).toBeGreaterThan(0.02)
    expect(seen.bell).toBeLessThan(seen.rope)
  })

  it('follows the side of the pull', () => {
    const right = new BellSwing()
    right.ring(0.8)
    right.step(1 / 30)
    expect(right.rope).toBeGreaterThan(0)
    expect(right.bell).toBeGreaterThanOrEqual(0)
    const left = new BellSwing()
    left.ring(-0.8)
    left.step(1 / 30)
    expect(left.rope).toBeLessThan(0)
    expect(left.bell).toBeLessThanOrEqual(0)
    // and it comes back the other way
    const seen = { min: 0, max: 0 }
    for (let i = 0; i < 90; i += 1) {
      left.step(1 / 30)
      seen.min = Math.min(seen.min, left.rope)
      seen.max = Math.max(seen.max, left.rope)
    }
    expect(seen.min).toBeLessThan(-0.1)
    expect(seen.max).toBeGreaterThan(0.1)
  })

  it('swings further for a harder pull', () => {
    const light = new BellSwing()
    light.ring(0.2)
    const hard = new BellSwing()
    hard.ring(1)
    expect(run(hard, 3).rope).toBeGreaterThan(run(light, 3).rope * 3)
  })

  it('adds a second pull to the swing it finds', () => {
    const swing = new BellSwing()
    swing.ring(0.5)
    run(swing, 0.3)
    const speed = (swing as unknown as { ropeV: number }).ropeV
    swing.ring(0.5)
    expect((swing as unknown as { ropeV: number }).ropeV).toBeCloseTo(speed + 0.25, 6)
    // and a pull against it slows it
    swing.ring(-1)
    expect((swing as unknown as { ropeV: number }).ropeV).toBeCloseTo(speed - 0.25, 6)
  })

  it('strikes as the bell turns, louder for a harder swing', () => {
    const blow = (push: number, motion = 1) => {
      const swing = new BellSwing()
      swing.ring(push, motion)
      expect(swing.takeStrike()).toBe(0)
      let level = 0
      for (let i = 0; i < 90; i += 1) {
        swing.step(1 / 30)
        level = Math.max(level, swing.takeStrike())
      }
      return level
    }
    expect(blow(1)).toBeGreaterThan(blow(0.3))
    expect(blow(0.3)).toBeGreaterThan(0)
    expect(blow(1)).toBeLessThanOrEqual(1)
    expect(blow(1, 0)).toBeGreaterThan(0)
  })

  it('dies away and comes to rest', () => {
    const swing = new BellSwing()
    swing.ring(1)
    run(swing, 30)
    expect(swing.moving).toBe(false)
    expect(swing.rope).toBe(0)
    expect(swing.bell).toBe(0)
  })

  it('sways only a little with reduced motion', () => {
    const full = new BellSwing()
    full.ring(1, 1)
    const calm = new BellSwing()
    calm.ring(1, 0)
    expect(run(calm, 3).rope).toBeLessThan(run(full, 3).rope * 0.5)
  })

  it('never swings over the hanger, however fast the pulls come', () => {
    const swing = new BellSwing()
    for (let i = 0; i < 20; i += 1) {
      swing.ring(1)
      swing.step(1 / 30)
    }
    const seen = run(swing, 5)
    expect(seen.rope).toBeLessThanOrEqual(0.5)
    expect(seen.bell).toBeLessThanOrEqual(0.5)
  })

  it('stays steady through a long frame', () => {
    const swing = new BellSwing()
    swing.ring(-1)
    swing.step(0.5)
    expect(Number.isFinite(swing.rope)).toBe(true)
    expect(Math.abs(swing.rope)).toBeLessThanOrEqual(0.5)
  })
})
