import type { Dress } from '../../season'
import { clouds } from './clouds'
import { blossom, grass } from './garden'
import { light } from './light'
import { lightParts } from './lights'
import { sky } from './sky'
import { snowParts } from './snow'

// Christmas: the blue hour after a snowfall, with the snow still coming
// down and warm bulbs strung up for the holidays. Loaded only while the
// season is worn (see season.ts).

export const dress: Dress = {
  name: 'christmas',
  light,
  sky,
  Skyscape: clouds,
  Blossom: blossom,
  Grass: grass,
  parts: [...snowParts, ...lightParts],
}
