import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// GroundTerrain — the floor of the whole Wired: a vast glowing data-plain that
// stretches to the FogExp2 horizon. Centered at y = -10 (the shared world
// floor), it renders as a Tron/Copland grid: a dark solid surface that occludes
// anything below it, overlaid with an additive wireframe grid (hologram-blue
// minor lines + brighter phosphor major lines every few cells) so the bloom
// pass makes the lines glow and they recede into the fog.
//
// HEIGHTFIELD — vertices are displaced in Y by a sum of three low-frequency
// sines travelling in different directions ("rolling data hills"). A radial
// falloff keeps the central region (r < ~30, the foreground / where the city
// band begins) near-flat and grows the amplitude toward the far rim (up to
// ~3.6 units). update() advances a slow time offset and rewrites the Y of every
// vertex IN PLACE so the plain gently breathes — no normals are needed (the
// surface is unlit MeshBasicMaterial, the grid is LineSegments).
//
// Perf: the solid surface mesh and BOTH grid LineSegments SHARE one position
// BufferAttribute, so a single per-frame Y update animates all three. No
// per-frame allocation: the radial amplitude per vertex is precomputed once,
// only Y is rewritten each frame, and grid glow rides on cheap opacity tweaks.
// ============================================================================

const SIZE = 320 // world units per side — fills the ground in all directions
const SEG = 120 // segments per side (capped for perf); 121x121 = 14641 verts
const GROUND_Y = -10 // shared world floor
const MAJOR_EVERY = 8 // every Nth grid line is a brighter "major" line

// Heightfield shaping ---------------------------------------------------------
const AMP = 3.6 // max vertical displacement, reached only out at the rim
const R_FLAT = 30 // inside this radius the ground is flat (calm foreground)
const R_FULL = 120 // amplitude reaches full strength by this radius

// Three layered travelling waves (direction angle, wavelength, speed, weight).
// Weights sum to 1 so the combined wave stays within [-1, 1] before AMP/falloff.
const TAU = Math.PI * 2
const K1 = TAU / 70
const K2 = TAU / 96
const K3 = TAU / 52
const W1X = Math.cos(0.45) * K1
const W1Z = Math.sin(0.45) * K1
const W2X = Math.cos(2.15) * K2
const W2Z = Math.sin(2.15) * K2
const W3X = Math.cos(-1.1) * K3
const W3Z = Math.sin(-1.1) * K3
const S1 = 0.06
const S2 = 0.045
const S3 = 0.085
const WT1 = 0.5
const WT2 = 0.32
const WT3 = 0.18

// Base grid glow (additive, lifted by audio + a gentle pulse in update)
const MINOR_OPACITY = 0.18
const MAJOR_OPACITY = 0.34

function smoothstep(edge0: number, edge1: number, x: number): number {
  let t = (x - edge0) / (edge1 - edge0)
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return t * t * (3 - 2 * t)
}

export class GroundTerrain implements SceneFeature {
  readonly group: THREE.Group

  private readonly surfaceGeo: THREE.PlaneGeometry
  private readonly gridMinorGeo: THREE.BufferGeometry
  private readonly gridMajorGeo: THREE.BufferGeometry

  private readonly surfaceMat: THREE.MeshBasicMaterial
  private readonly gridMinorMat: THREE.LineBasicMaterial
  private readonly gridMajorMat: THREE.LineBasicMaterial

  // Shared position buffer (one update drives surface + both grids) and the
  // precomputed per-vertex amplitude (radial falloff baked in).
  private readonly posAttr: THREE.BufferAttribute
  private readonly posArr: Float32Array
  private readonly amp: Float32Array

  private time = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'GroundTerrain'

    // --- solid surface geometry (rotated flat onto the XZ plane) -------------
    this.surfaceGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)
    this.surfaceGeo.rotateX(-Math.PI / 2)
    this.posAttr = this.surfaceGeo.getAttribute('position') as THREE.BufferAttribute
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    this.posArr = this.posAttr.array as Float32Array

    // Precompute the radial amplitude (flat center -> full at the rim) once.
    const vcount = this.posAttr.count
    this.amp = new Float32Array(vcount)
    for (let i = 0; i < vcount; i++) {
      const x = this.posArr[i * 3]
      const z = this.posArr[i * 3 + 2]
      const r = Math.hypot(x, z)
      this.amp[i] = AMP * smoothstep(R_FLAT, R_FULL, r)
    }

    // --- grid line indices over the same vertex grid -------------------------
    // Vertices are row-major: index(ix, iy) = iy*(SEG+1) + ix. Each grid line
    // is assigned wholesale to the minor or major set so the major lines read
    // as continuous brighter rails.
    const stride = SEG + 1
    const minorIdx: number[] = []
    const majorIdx: number[] = []
    // horizontal segments (constant iy, varying ix)
    for (let iy = 0; iy <= SEG; iy++) {
      const major = iy % MAJOR_EVERY === 0
      const row = iy * stride
      for (let ix = 0; ix < SEG; ix++) {
        const a = row + ix
        const b = a + 1
        if (major) majorIdx.push(a, b)
        else minorIdx.push(a, b)
      }
    }
    // vertical segments (constant ix, varying iy)
    for (let ix = 0; ix <= SEG; ix++) {
      const major = ix % MAJOR_EVERY === 0
      for (let iy = 0; iy < SEG; iy++) {
        const a = iy * stride + ix
        const b = a + stride
        if (major) majorIdx.push(a, b)
        else minorIdx.push(a, b)
      }
    }

    this.gridMinorGeo = new THREE.BufferGeometry()
    this.gridMinorGeo.setAttribute('position', this.posAttr) // shared buffer
    this.gridMinorGeo.setIndex(new THREE.Uint32BufferAttribute(minorIdx, 1))

    this.gridMajorGeo = new THREE.BufferGeometry()
    this.gridMajorGeo.setAttribute('position', this.posAttr) // shared buffer
    this.gridMajorGeo.setIndex(new THREE.Uint32BufferAttribute(majorIdx, 1))

    // --- materials -----------------------------------------------------------
    // Dark teal floor: just above the void so the grid reads against it and it
    // occludes anything below the plane. polygonOffset pushes it slightly back
    // in depth so the (additive) grid lines reliably win the depth test.
    this.surfaceMat = new THREE.MeshBasicMaterial({
      color: palette.voidColor.clone().lerp(palette.hologram, 0.07),
      side: THREE.DoubleSide,
      fog: true,
      depthWrite: true,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    })

    this.gridMinorMat = new THREE.LineBasicMaterial({
      color: palette.hologram.clone(),
      transparent: true,
      opacity: MINOR_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: false,
    })
    this.gridMajorMat = new THREE.LineBasicMaterial({
      color: palette.phosphor.clone(),
      transparent: true,
      opacity: MAJOR_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: false,
    })

    // --- objects (all share the one position buffer) -------------------------
    const surface = new THREE.Mesh(this.surfaceGeo, this.surfaceMat)
    surface.frustumCulled = false // always visible; verts move so skip culling

    // Lift the grids a hair above the surface so the lines sit just on top of
    // the hills (they follow the shared heightfield; the offset is a transform).
    const gridMinor = new THREE.LineSegments(this.gridMinorGeo, this.gridMinorMat)
    gridMinor.frustumCulled = false
    gridMinor.position.y = 0.04
    gridMinor.renderOrder = 1

    const gridMajor = new THREE.LineSegments(this.gridMajorGeo, this.gridMajorMat)
    gridMajor.frustumCulled = false
    gridMajor.position.y = 0.06
    gridMajor.renderOrder = 2

    this.group.add(surface, gridMinor, gridMajor)
    this.group.position.y = GROUND_Y

    // Seed the heightfield so the very first frame is already rolling, not flat.
    this.displace()
  }

  // Rewrite every vertex's Y from the layered waves at the current time. Only Y
  // changes; X/Z are read straight from the shared buffer and the amplitude is
  // precomputed, so there is no allocation here.
  private displace(): void {
    const t = this.time
    const pos = this.posArr
    const amp = this.amp
    const n = amp.length
    for (let i = 0; i < n; i++) {
      const j = i * 3
      const x = pos[j]
      const z = pos[j + 2]
      const h =
        WT1 * Math.sin(W1X * x + W1Z * z + S1 * t) +
        WT2 * Math.sin(W2X * x + W2Z * z + S2 * t) +
        WT3 * Math.sin(W3X * x + W3Z * z + S3 * t)
      pos[j + 1] = amp[i] * h
    }
    this.posAttr.needsUpdate = true
  }

  update(ctx: FeatureContext): void {
    // Slow, smooth undulation; reduced-motion shrinks the time advance.
    this.time += ctx.dt * ctx.motion
    this.displace()

    // Subtle audio lift + a gentle breathing pulse on the grid glow.
    const pulse = 0.9 + 0.1 * Math.sin(this.time * 0.3)
    const lift = (1 + ctx.audio * 0.7) * pulse
    this.gridMinorMat.opacity = Math.min(1, MINOR_OPACITY * lift)
    this.gridMajorMat.opacity = Math.min(1, MAJOR_OPACITY * lift)
  }

  dispose(): void {
    // The grid geometries borrow the surface's position attribute; three.js
    // frees the shared GL buffer on the first dispose and no-ops thereafter.
    this.surfaceGeo.dispose()
    this.gridMinorGeo.dispose()
    this.gridMajorGeo.dispose()
    this.surfaceMat.dispose()
    this.gridMinorMat.dispose()
    this.gridMajorMat.dispose()
    this.group.clear()
  }
}
