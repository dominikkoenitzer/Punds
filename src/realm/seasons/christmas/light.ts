import * as THREE from 'three'
import type { LightDress } from '../../season'

// The blue hour after a snowfall: the sun is down, the key is the cool light
// of the sky over the place it set, low and soft, and the sky's own light is
// the larger share, so shade stays blue rather than black. The air holds a
// little of the snow's haze. The lanterns burn, as in every season's evening.

export const light: LightDress = {
  keyColor: new THREE.Color(0.66, 0.74, 1.0),
  keyIntensity: 3.2,
  environmentIntensity: 1.9,
  exposure: 1.0,
  fogColor: new THREE.Color(0.06, 0.075, 0.11),
  sunFogColor: new THREE.Color(0.24, 0.14, 0.1),
  shaftColor: new THREE.Color(0.8, 0.62, 0.55),
  shafts: 0.06,
  bloom: 0.28,
  saturation: 0.8,
  // haze that hangs low over the lawn and thins quickly above head height
  fogDensity: 0.016,
  fogHeight: 0,
  fogFalloff: 0.3,
}
