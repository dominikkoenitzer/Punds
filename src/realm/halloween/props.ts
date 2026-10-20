import type { RealmPart, Tier } from '../types'

// What stands in the garden for the night: carved pumpkins with candles,
// the gravestones and the hand, a few fallen leaves.

export const propParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = []
