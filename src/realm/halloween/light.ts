import * as THREE from 'three'
import type { LightDress } from '../season'
import type { Frame } from '../types'
import { discDirection } from './sky'
import { hallow } from './state'

// The blood-moon night: the moon is the key light, red-orange and strong
// enough that stone, wood and leaves keep their form; the sky's own light is
// a warm violet fill, so shade stays readable rather than black.

const KEY = new THREE.Color(1.0, 0.36, 0.2)
const FLASH = new THREE.Color(0.75, 0.8, 1.0)

export const light: LightDress = {
  keyColor: KEY.clone(),
  keyIntensity: 6.5,
  environmentIntensity: 2.4,
  exposure: 1.05,
  fogColor: new THREE.Color(0.075, 0.045, 0.08),
  sunFogColor: new THREE.Color(0.42, 0.12, 0.06),
  shaftColor: new THREE.Color(1.0, 0.34, 0.2),
  shafts: 0.25,
  bloom: 0.2,
  saturation: 1.05,
  // a low mist that lies on the lawn and the path
  fogDensity: 0.012,
  fogHeight: 0,
  fogFalloff: 0.35,
  // the glow in the air and the shafts come from the moon the sky draws
  glowDirection: new THREE.Vector3(),
  update(frame: Frame) {
    this.glowDirection?.copy(discDirection())
    // a far flash lifts the garden's light only a little, and cools it
    const f = hallow.uFlash.value * frame.motion
    this.keyColor.copy(KEY).lerp(FLASH, f * 0.25)
    this.keyIntensity = 6.5 + f * 1.5
  },
}
