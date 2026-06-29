import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// CableTangle — the signature Wired look: ~14-22 drooping cables, each a
// CatmullRomCurve3 sagged downward by "gravity" and skinned with a thin
// additive TubeGeometry so the bloom pass makes it glow. Several cables are
// clustered into near-parallel bundles so the space reads as "cables
// everywhere". The whole tangle drifts and sways slowly and breathes with the
// audio bass level.

interface CableSpec {
  points: THREE.Vector3[]
  material: THREE.MeshBasicMaterial
  radius: number
}

// Small deterministic PRNG so the layout is stable across reloads.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class CableTangle implements SceneFeature {
  readonly group: THREE.Object3D

  // Inner transform group: animated each frame, leaving this.group untouched
  // for the host to position/orient as it sees fit.
  private readonly content: THREE.Group
  private readonly geometries: THREE.TubeGeometry[] = []
  private readonly materials: THREE.MeshBasicMaterial[] = []
  private readonly baseOpacity: number[] = []
  private spin = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'CableTangle'
    this.content = new THREE.Group()
    this.group.add(this.content)

    const rng = mulberry32(0x1a17c0de)
    const rand = (lo: number, hi: number): number => lo + rng() * (hi - lo)

    // --- shared material pool (capped, reused across all cables) ---------
    const makeMat = (color: THREE.Color, opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({
        color: color.clone(),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      this.materials.push(m)
      this.baseOpacity.push(opacity)
      return m
    }

    // Mostly hologram blue, a single phosphor-cyan accent strand per bundle.
    const holoMats = [
      makeMat(palette.hologram, 0.14),
      makeMat(palette.hologram, 0.2),
      makeMat(palette.hologram, 0.28),
    ]
    const phosMat = makeMat(palette.phosphor, 0.24)

    // --- generate cables in bundles -------------------------------------
    const specs: CableSpec[] = []
    const target = 19 // within the requested 14-22 range

    while (specs.length < target) {
      // Bundle anchors: cables hang from "above" (positive y) and droop down.
      const ax = rand(-26, 26)
      const ay = rand(5, 16)
      const az = rand(-26, 6)
      const bx = rand(-26, 26)
      const by = rand(5, 16)
      const bz = rand(-26, 6)

      const horiz = Math.hypot(bx - ax, bz - az)
      const baseSag = 3 + horiz * 0.22

      // Bundle size: bias toward 2-4 so it reads as a cluster, with the odd
      // standalone cable for variety.
      let bundle = 1 + Math.floor(rng() * 5) // 1..5
      if (bundle > 4) bundle = 4
      bundle = Math.min(bundle, target - specs.length)

      const bundleMat = holoMats[Math.floor(rng() * holoMats.length)]

      for (let c = 0; c < bundle; c++) {
        // Per-cable parallel offset spreads the strands within the bundle.
        const ox = rand(-0.7, 0.7)
        const oy = rand(-0.5, 0.5)
        const oz = rand(-0.7, 0.7)

        const segs = 3 + Math.floor(rng() * 3) // 3..5 control points
        const sag = baseSag * rand(0.8, 1.3)
        const pts: THREE.Vector3[] = []
        for (let i = 0; i < segs; i++) {
          const f = i / (segs - 1)
          const droop = Math.sin(Math.PI * f) * sag
          // Interior points wobble laterally a touch so the bundle is not a
          // perfectly rigid sheet.
          const jx = i === 0 || i === segs - 1 ? 0 : rand(-1.6, 1.6)
          const jz = i === 0 || i === segs - 1 ? 0 : rand(-1.6, 1.6)
          pts.push(
            new THREE.Vector3(
              ax + (bx - ax) * f + ox + jx,
              ay + (by - ay) * f + oy - droop,
              az + (bz - az) * f + oz + jz,
            ),
          )
        }

        // ~18% chance a strand in the bundle is the bright phosphor accent.
        const material = rng() < 0.18 ? phosMat : bundleMat
        specs.push({ points: pts, material, radius: rand(0.02, 0.05) })
      }
    }

    // --- build tube meshes ----------------------------------------------
    for (const spec of specs) {
      const curve = new THREE.CatmullRomCurve3(spec.points, false, 'centripetal', 0.5)
      const geo = new THREE.TubeGeometry(curve, 40, spec.radius, 5, false)
      this.geometries.push(geo)
      const mesh = new THREE.Mesh(geo, spec.material)
      mesh.frustumCulled = false
      this.content.add(mesh)
    }
  }

  update(ctx: FeatureContext): void {
    const { dt, t, motion, audio } = ctx

    // Slow continuous drift plus a gentle global sway.
    this.spin += dt * 0.012 * motion
    this.content.rotation.y = this.spin + Math.sin(t * 0.05) * 0.04 * motion
    this.content.rotation.z = Math.sin(t * 0.037) * 0.015 * motion
    this.content.position.y = Math.sin(t * 0.13) * 0.5 * motion
    this.content.position.x = Math.cos(t * 0.091) * 0.35 * motion

    // Subtle "breathing" on the bass.
    this.content.scale.setScalar(1 + audio * 0.015 * motion)

    const pulse = 1 + audio * 0.6
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].opacity = Math.min(1, this.baseOpacity[i] * pulse)
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
    this.geometries.length = 0
    this.materials.length = 0
    this.content.clear()
    this.group.clear()
  }
}
