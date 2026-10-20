import * as THREE from 'three'

// What the garden's own plants wear for the night. The cherry's blossom is
// lit through from behind by day; with the moon low behind it, that glow
// would turn the crown paper white against the night, so here the petals let
// less light through and take a deeper rose.

export interface BlossomTone {
  trans: number
  transTint: THREE.Color
  // multiplies the painted petals
  color: THREE.Color
}

export interface BlossomDress {
  crown: BlossomTone
  petals: BlossomTone
}

export const blossom: BlossomDress = {
  crown: { trans: 0.3, transTint: new THREE.Color(1.0, 0.62, 0.66), color: new THREE.Color(0.62, 0.48, 0.52) },
  petals: { trans: 0.4, transTint: new THREE.Color(1.0, 0.62, 0.66), color: new THREE.Color(0.62, 0.48, 0.52) },
}
