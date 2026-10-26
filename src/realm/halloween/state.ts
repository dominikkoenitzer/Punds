import * as THREE from 'three'
import { SUN_DIRECTION } from '../atmosphere'

// What the night's pieces share: the moon, the lightning out in the cloud sea
// and the rain. The storm moves these once per frame; the sky, the clouds, the
// light, the rain and the sound read them.

export const hallow = {
  // the blood moon stands where the sun stood, low in the west, so the
  // garden's shadows and light shafts keep their composition
  uMoonDir: { value: SUN_DIRECTION },
  // brightness of the lightning now, 0..1 (already capped and eased)
  uFlash: { value: 0 },
  // where the flash is, as a world direction from the island
  uFlashDir: { value: new THREE.Vector3(0.6, 0.1, -0.8).normalize() },
  // how strongly the ghost shows in the cloud it lights, 0..1
  uGhost: { value: 0 },
  // rain strength, 0..1
  uRain: { value: 1 },
}

type FlashListener = (strength: number, direction: THREE.Vector3, ghost: boolean) => void
const flashListeners: FlashListener[] = []

// the sound hears of each flash as it begins (thunder follows a few seconds later)
export function onFlash(listener: FlashListener): () => void {
  flashListeners.push(listener)
  return () => {
    const i = flashListeners.indexOf(listener)
    if (i >= 0) flashListeners.splice(i, 1)
  }
}

export function announceFlash(strength: number, direction: THREE.Vector3, ghost: boolean): void {
  for (const l of flashListeners) l(strength, direction, ghost)
}
