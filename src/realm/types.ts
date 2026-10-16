import type * as THREE from 'three'

// The contract between the realm host and the parts it is built from. Each
// part owns its objects and GPU resources; the host adds `object` to the scene,
// calls update() once per frame and dispose() on teardown.

// ultra: a strong desktop GPU. high: an ordinary laptop or desktop. phone: a
// recent phone, same look with fewer instances, smaller targets and no extra
// passes.
export type Tier = 'ultra' | 'high' | 'phone'

export interface Frame {
  t: number // seconds since the realm started
  dt: number // seconds since the last frame, clamped
  camera: THREE.PerspectiveCamera
  // the pointer as a world ray, or null while there is no pointer (touch
  // between gestures); koi and petals react to it
  pointer: THREE.Ray | null
  // 0 on arrival, 1 at the shrine; the walk along the path
  progress: number
  // 1, or 0 under prefers-reduced-motion
  motion: number
}

// parts the visitor can point at and click
export interface Interactive {
  readonly pointing: boolean
  hover(ray: THREE.Ray | null): void
  tap(ray: THREE.Ray, touch: boolean): boolean
}

export interface RealmPart {
  readonly object: THREE.Object3D
  update(frame: Frame): void
  dispose(): void
}
