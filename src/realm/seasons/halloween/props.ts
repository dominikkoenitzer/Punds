import type { RealmPart, Tier } from '../../types'
import { Graves } from './props-graves'
import { Leaves } from './props-leaves'
import { Pumpkins } from './props-pumpkins'

// What stands in the garden for the night: carved pumpkins with candles,
// the gravestones and the hand, a few fallen leaves.
export const propParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = [
  (tier) => new Pumpkins(tier),
  (tier) => Graves.create(tier),
  (tier) => new Leaves(tier),
]
