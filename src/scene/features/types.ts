import * as THREE from 'three'

// Shared contract between the Copland OS scene host and its visual feature
// modules (cables, data rain, network graph, spires, terminal text…).
// Each feature builds into its own THREE.Group; the host adds the group to the
// scene, calls update() every frame, and dispose() on teardown.

export interface ScenePalette {
  voidColor: THREE.Color
  phosphor: THREE.Color
  hologram: THREE.Color
  tachibana: THREE.Color
  warning: THREE.Color
  phosphorStr: string
  hologramStr: string
  tachibanaStr: string
  warningStr: string
}

export interface FeatureContext {
  dt: number                       // seconds since last frame (clamped)
  t: number                        // total elapsed seconds
  motion: number                   // 1, or 0.25 under prefers-reduced-motion
  audio: number                    // 0..1 bass level (0 until audio starts)
  dread: number                    // 0..1 idle "dread" — ramps up while the viewer is still
  camera: THREE.PerspectiveCamera  // the live camera
}

export interface SceneFeature {
  readonly group: THREE.Object3D
  update(ctx: FeatureContext): void
  dispose(): void
}
