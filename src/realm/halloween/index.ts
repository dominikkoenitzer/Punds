import type { Dress } from '../season'
import { light } from './light'
import { sky } from './sky'
import { clouds, stormParts } from './storm'
import { pond } from './pond'
import { propParts } from './props'
import { rainParts } from './rain'
import { sound } from './sound'
import { hallow } from './state'

// Halloween: a blood-moon night over the island. Loaded only while the
// season is worn (see season.ts).

export const dress: Dress = {
  name: 'halloween',
  light,
  ...(sky ? { sky } : {}),
  Skyscape: clouds,
  Pond: pond,
  Ambience: sound,
  parts: [...stormParts, ...propParts, ...rainParts],
}

// headless checks read and drive the night's shared state
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __hallow: typeof hallow }).__hallow = hallow
