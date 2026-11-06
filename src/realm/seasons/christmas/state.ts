import { SUN_DIRECTION } from '../../atmosphere'

// What the evening's pieces share. The sun has just gone down where it stood
// by day, so the last light comes from the same side and the garden's shadows
// keep their composition; the sky, the clouds, the light and the snow read it.
export const evening = {
  uSunDir: { value: SUN_DIRECTION },
  // how thickly it snows, 0..1: thins the flakes rather than dimming them
  uSnow: { value: 1 },
}
