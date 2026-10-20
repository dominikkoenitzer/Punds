import * as THREE from 'three'
import type { LightDress } from '../season'
import type { Frame } from '../types'
import { hallow } from './state'

// The blood-moon night: the moon is the key light, red-orange and strong
// enough that stone, wood and leaves keep their form; the sky's own light is
// a warm violet fill, so shade stays readable rather than black.

const KEY = new THREE.Color(1.0, 0.36, 0.2)
const FLASH = new THREE.Color(0.75, 0.8, 1.0)

export const light: LightDress = {
  keyColor: KEY.clone(),
  keyIntensity: 7.5,
  environmentIntensity: 0.5,
  exposure: 0.95,
  fogColor: new THREE.Color(0.2, 0.12, 0.2),
  sunFogColor: new THREE.Color(1.0, 0.32, 0.18).multiplyScalar(1.4),
  shaftColor: new THREE.Color(1.0, 0.34, 0.2),
  shafts: 0.55,
  bloom: 0.2,
  saturation: 1.05,
  fogDensity: 0.0026,
  update(frame: Frame) {
    // a far flash lifts the garden's light only a little, and cools it
    const f = hallow.uFlash.value * frame.motion
    this.keyColor.copy(KEY).lerp(FLASH, f * 0.25)
    this.keyIntensity = 7.5 + f * 1.5
  },
}
