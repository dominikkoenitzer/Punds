// One press of the sound switch, returning what it reads after; with no garden yet it stays off, as audio starts only inside a press.
export function pressSound(realm: { sound: boolean; setSound(on: boolean): void } | null): boolean {
  if (!realm) return false
  const next = !realm.sound
  realm.setSound(next)
  return next
}
