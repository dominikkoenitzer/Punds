import * as THREE from 'three'
import type { LightDress } from '../season'
import type { Frame } from '../types'
import { discDirection, moonFlame } from './sky'
import { hallow } from './state'

// The blood-moon night: the moon is the key light, red-orange and strong
// enough that stone, wood and leaves keep their form; the sky's own light is
// a warm violet fill, so shade stays readable rather than black.

const KEY = new THREE.Color(1.0, 0.36, 0.2)
const FLASH = new THREE.Color(0.75, 0.8, 1.0)
const FOG = new THREE.Color(0.075, 0.045, 0.08)
const FLASH_FOG = new THREE.Color(0.3, 0.3, 0.42)

export const light: LightDress = {
  keyColor: KEY.clone(),
  keyIntensity: 6.5,
  environmentIntensity: 2.4,
  exposure: 1.05,
  fogColor: FOG.clone(),
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
    // the flame in the moon breathes only while things may move
    moonFlame.uMoonMotion.value = frame.motion
    // a flash lights the whole garden for its moment: the key and the sky's
    // fill jump together and cool toward the lightning's white, and the
    // frame opens a little, so the kick is felt everywhere and not only out
    // over the sea
    const f = hallow.uFlash.value * frame.motion
    this.keyColor.copy(KEY).lerp(FLASH, f * 0.6)
    this.keyIntensity = 6.5 + f * 7.5
    this.environmentIntensity = 2.4 + f * 1.2
    this.exposure = 1.05 + f * 0.15
    this.fogColor.copy(FOG).lerp(FLASH_FOG, f * 0.3)
  },
}
