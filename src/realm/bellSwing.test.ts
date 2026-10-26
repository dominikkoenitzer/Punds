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

  it('swings the rope toward the visitor and rocks the bell after it', () => {
    const swing = new BellSwing()
    swing.ring()
    swing.step(1 / 30)
    expect(swing.rope).toBeLessThan(0)
    const seen = run(swing, 3)
    expect(seen.rope).toBeGreaterThan(0.15)
    expect(seen.rope).toBeLessThan(0.5)
    expect(seen.bell).toBeGreaterThan(0.02)
    expect(seen.bell).toBeLessThan(seen.rope)
  })

  it('dies away and comes to rest', () => {
    const swing = new BellSwing()
    swing.ring()
    run(swing, 30)
    expect(swing.moving).toBe(false)
    expect(swing.rope).toBe(0)
    expect(swing.bell).toBe(0)
  })

  it('sways only a little with reduced motion', () => {
    const full = new BellSwing()
    full.ring(1)
    const calm = new BellSwing()
    calm.ring(0)
    expect(run(calm, 3).rope).toBeLessThan(run(full, 3).rope * 0.5)
  })

  it('never swings over the hanger, however fast the pulls come', () => {
    const swing = new BellSwing()
    for (let i = 0; i < 20; i += 1) {
      swing.ring()
      swing.step(1 / 30)
    }
    const seen = run(swing, 5)
    expect(seen.rope).toBeLessThanOrEqual(0.5)
    expect(seen.bell).toBeLessThanOrEqual(0.5)
  })

  it('stays steady through a long frame', () => {
    const swing = new BellSwing()
    swing.ring()
    swing.step(0.5)
    expect(Number.isFinite(swing.rope)).toBe(true)
    expect(Math.abs(swing.rope)).toBeLessThanOrEqual(0.5)
  })
})
