import * as THREE from 'three'
import type { GrassDress } from '../../grass'
import type { BlossomDress } from '../../trees'

// What the garden's own plants wear after the snowfall. Rime has caught the
// cherry, so its crown is pale and lets little light through. On the lawn
// the frost holds the upper half of each blade, thickest at the tip and in
// patches a couple of metres across, so the grass reads frozen rather than
// painted white.

export const blossom: BlossomDress = {
  crown: { trans: 0.22, transTint: new THREE.Color(0.86, 0.9, 1.0), color: new THREE.Color(0.86, 0.84, 0.9) },
  petals: { trans: 0.3, transTint: new THREE.Color(0.86, 0.9, 1.0), color: new THREE.Color(0.86, 0.84, 0.9) },
}

export const grass: GrassDress = {
  uniforms: {},
  vertexPars: '',
  vertex: /* glsl */ `
float frost = smoothstep(0.3, 1.0, vGrassT) * (0.45 + 0.55 * smoothstep(0.3, 0.7, realmNoise(grassWorld.xz * 0.45 + 3.0)));
vGrassColor = mix(vGrassColor, vec3(0.36, 0.4, 0.46), frost * 0.75);`,
  fragmentPars: '',
  fragment: '',
}
