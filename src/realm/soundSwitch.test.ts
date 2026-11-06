import { describe, expect, it } from 'vitest'

import { pressSound } from './soundSwitch'

const garden = () => ({
  sound: false,
  setSound(on: boolean) {
    this.sound = on
  },
})

describe('sound switch', () => {
  it('stays off while there is no garden to play it', () => {
    expect(pressSound(null)).toBe(false)
  })

  it('turns the garden sound on and off and reads what it set', () => {
    const realm = garden()
    expect(pressSound(realm)).toBe(true)
    expect(realm.sound).toBe(true)
    expect(pressSound(realm)).toBe(false)
    expect(realm.sound).toBe(false)
  })

  it('starts from the garden as it is, not from an earlier press', () => {
    expect(pressSound(null)).toBe(false)
    const realm = garden()
    expect(pressSound(realm)).toBe(true)
    expect(realm.sound).toBe(true)
  })
})
