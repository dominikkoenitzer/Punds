import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// ReflectiveFloor — the glossy plaza pavement at the heart of the corpo-plaza.
// REPLACES the old rolling GroundTerrain. A large flat THREE.Reflector lies at
// the shared world floor (y = -10) and MIRRORS everything above it — the ringing
// towers, the holographic koi, the floating UI panels, the central logo — like
// wet downtown asphalt under neon. A dark teal tint keeps the mirror dim so only
// the bright emissive content reflects and blooms.
//
// Lifted a hair above the mirror (y = -9.95, to dodge z-fighting) sits a glowing
// Tron/Copland NEON GRID: hologram-blue minor rails with brighter phosphor MAJOR
// rails every few cells, additive so the bloom pass makes them glow, receding
// into the FogExp2 horizon. A faint radial glow disc seats the plaza centre and a
// thin additive SCAN RING expands from the origin outward and resets, sweeping
// the pavement for ambiance.
//
// PERF: the Reflector renders the WHOLE scene a second time into its own render
// target every frame, so the texture is kept modest (1024²) with light MSAA, and
// the grid is dirt-cheap — a couple hundred static line vertices, two materials.
// update() only tweaks a few opacity/scale/colour scalars: no per-frame alloc.
// The Reflector refreshes its reflection itself (its own onBeforeRender) — we
// never drive it manually.
// ============================================================================

const FLOOR_Y = -10 // shared world floor: the mirror sits exactly here
const PLANE_SIZE = 300 // mirror + grid span (fades into fog long before the rim)

// Neon grid layout -----------------------------------------------------------
const GRID_HALF = PLANE_SIZE / 2 // 150
const CELL = 5 // world units per cell (300 / 5 = 60 cells per side)
const MAJOR_EVERY = 8 // every Nth rail is a brighter "major" rail
const GRID_Y = -9.95 // lifted above the mirror to avoid z-fighting
const GLOW_Y = -9.97 // radial centre glow, just under the grid
const RING_Y = -9.96 // expanding scan ring

const MINOR_OPACITY = 0.16
const MAJOR_OPACITY = 0.34
const GLOW_OPACITY = 0.16
const RING_OPACITY = 0.5
const RING_MAX = 130 // scan ring grows out to here (inside the fogged rim)
const RING_PERIOD = 8 // seconds for one sweep from centre to rim

export class ReflectiveFloor implements SceneFeature {
  readonly group: THREE.Group

  // --- the mirror ---
  private readonly reflector: Reflector
  private readonly reflectorGeo: THREE.PlaneGeometry
  private readonly refColor: THREE.Color // live reflector tint uniform (mutated)
  private readonly baseTint: THREE.Color // its resting dark-teal value
  private readonly shimmerTarget: THREE.Color // hologram blue we shimmer toward

  // --- neon grid ---
  private readonly gridMinorGeo: THREE.BufferGeometry
  private readonly gridMajorGeo: THREE.BufferGeometry
  private readonly gridMinorMat: THREE.LineBasicMaterial
  private readonly gridMajorMat: THREE.LineBasicMaterial

  // --- centre glow disc ---
  private readonly glowGeo: THREE.PlaneGeometry
  private readonly glowMat: THREE.MeshBasicMaterial
  private readonly glowTex: THREE.CanvasTexture

  // --- expanding scan ring ---
  private readonly ringGeo: THREE.RingGeometry
  private readonly ringMat: THREE.MeshBasicMaterial
  private readonly ringMesh: THREE.Mesh

  private time = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'ReflectiveFloor'

    // ----- the reflective mirror -------------------------------------------
    // Deep, dim teal tint: only a faint wet sheen of the bright emissive
    // city/koi/panels reflects. Kept deliberately dark so reflected verticals
    // (tower edges, light beams, the overhead eye) don't cross the bloom
    // threshold and bloom into a hard radial fan at the reflected nadir.
    this.baseTint = palette.voidColor.clone().lerp(palette.hologram, 0.1).multiplyScalar(0.55)
    this.shimmerTarget = palette.hologram.clone().multiplyScalar(0.5)

    this.reflectorGeo = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE)
    this.reflectorGeo.rotateX(-Math.PI / 2) // lay flat, normal pointing up (+Y)
    this.reflector = new Reflector(this.reflectorGeo, {
      color: this.baseTint,
      textureWidth: 1024, // modest — this RT is re-rendered every frame
      textureHeight: 1024,
      clipBias: 0.003,
      multisample: 4, // 4x MSAA smooths reflected thin lines/edges at grazing angles
    })
    this.reflector.position.y = FLOOR_Y
    this.reflector.frustumCulled = false // keep the reflection refreshing steadily

    // Give the reflection real minification AA. At grazing angles a huge stretch
    // of floor maps to a sliver of this 1024² RT, so bright reflected verticals
    // (towers, data-rain, the giant eye's radial iris) alias into streaks that
    // fan from the reflected nadir. Mipmaps + anisotropy trade that shimmer for a
    // touch of clean blur (re-generated each frame after the reflection renders).
    const refRT = this.reflector.getRenderTarget()
    refRT.texture.minFilter = THREE.LinearMipmapLinearFilter
    refRT.texture.generateMipmaps = true
    refRT.texture.anisotropy = 8

    // Grab the live tint Color the Reflector built from our option so update()
    // can shimmer it in place (it clones the option into its uniform).
    const refMat = this.reflector.material as unknown as THREE.ShaderMaterial
    this.refColor = refMat.uniforms.color.value as THREE.Color

    this.group.add(this.reflector)

    // ----- neon grid (cheap static line segments) --------------------------
    // Each rail is a single long segment crossing the plaza; fog fades both ends
    // so the grid dissolves into the horizon. Rails are split into a minor and a
    // major set, the majors centred so one passes through the plaza origin.
    const minorPos: number[] = []
    const majorPos: number[] = []
    const nLines = Math.round((GRID_HALF * 2) / CELL) // 60
    const centerIdx = nLines / 2 // 30 -> the rail at the origin
    for (let i = 0; i <= nLines; i++) {
      const c = -GRID_HALF + i * CELL
      const major = (i - centerIdx) % MAJOR_EVERY === 0
      const arr = major ? majorPos : minorPos
      // rail parallel to X (constant z = c)
      arr.push(-GRID_HALF, 0, c, GRID_HALF, 0, c)
      // rail parallel to Z (constant x = c)
      arr.push(c, 0, -GRID_HALF, c, 0, GRID_HALF)
    }

    this.gridMinorGeo = new THREE.BufferGeometry()
    this.gridMinorGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(minorPos, 3),
    )
    this.gridMajorGeo = new THREE.BufferGeometry()
    this.gridMajorGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(majorPos, 3),
    )

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

    const gridMinor = new THREE.LineSegments(this.gridMinorGeo, this.gridMinorMat)
    gridMinor.position.y = GRID_Y
    gridMinor.frustumCulled = false
    gridMinor.renderOrder = 3
    const gridMajor = new THREE.LineSegments(this.gridMajorGeo, this.gridMajorMat)
    gridMajor.position.y = GRID_Y
    gridMajor.frustumCulled = false
    gridMajor.renderOrder = 4
    this.group.add(gridMinor, gridMajor)

    // ----- faint radial glow disc seating the plaza centre -----------------
    this.glowTex = this.makeRadialTexture(
      palette.phosphor.clone().lerp(palette.hologram, 0.45),
    )
    this.glowGeo = new THREE.PlaneGeometry(90, 90)
    this.glowGeo.rotateX(-Math.PI / 2)
    this.glowMat = new THREE.MeshBasicMaterial({
      map: this.glowTex,
      transparent: true,
      opacity: GLOW_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: false,
    })
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat)
    glow.position.y = GLOW_Y
    glow.frustumCulled = false
    glow.renderOrder = 1
    this.group.add(glow)

    // ----- expanding scan ring ---------------------------------------------
    // A thin unit ring scaled outward each frame; thickness rides with radius
    // but the ring fades to nothing before the rim so it stays a clean sweep.
    this.ringGeo = new THREE.RingGeometry(0.985, 1.0, 96)
    this.ringGeo.rotateX(-Math.PI / 2)
    this.ringMat = new THREE.MeshBasicMaterial({
      color: palette.phosphor.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      fog: true,
      toneMapped: false,
    })
    this.ringMesh = new THREE.Mesh(this.ringGeo, this.ringMat)
    this.ringMesh.position.y = RING_Y
    this.ringMesh.frustumCulled = false
    this.ringMesh.renderOrder = 2
    this.group.add(this.ringMesh)
  }

  // Soft radial gradient (bright centre -> transparent edge), colour-managed.
  private makeRadialTexture(core: THREE.Color): THREE.CanvasTexture {
    const s = 128
    const canvas = document.createElement('canvas')
    canvas.width = s
    canvas.height = s
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    const style = core.getStyle(THREE.SRGBColorSpace)
    const rgba = (a: number): string =>
      style.replace('rgb(', 'rgba(').replace(')', `,${a})`)
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, rgba(0.9))
    g.addColorStop(0.4, rgba(0.35))
    g.addColorStop(1, rgba(0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  update(ctx: FeatureContext): void {
    this.time += ctx.dt * ctx.motion
    const t = this.time
    const audio = ctx.audio

    // Grid glow: gentle breathing pulse lifted by audio bass.
    const pulse = 0.85 + 0.15 * Math.sin(t * 0.4)
    const lift = (1 + audio * 0.6) * pulse
    this.gridMinorMat.opacity = Math.min(1, MINOR_OPACITY * lift)
    this.gridMajorMat.opacity = Math.min(1, MAJOR_OPACITY * lift)

    // Centre glow softly throbs with the plaza.
    this.glowMat.opacity = Math.min(
      1,
      GLOW_OPACITY * (0.7 + 0.3 * Math.sin(t * 0.5) + audio * 0.6),
    )

    // Scan ring sweeps from origin out to the fogged rim, then resets. sin()
    // fades it in and out so it never pops at the edges.
    const prog = (t / RING_PERIOD) % 1
    const radius = 2 + prog * (RING_MAX - 2)
    this.ringMesh.scale.set(radius, 1, radius)
    this.ringMat.opacity = Math.sin(prog * Math.PI) * RING_OPACITY * (1 + audio * 0.4)

    // Subtle reflection-tint shimmer: keep the mirror dark teal but let it
    // breathe a touch toward hologram blue. Kept small (and barely audio-driven)
    // so the reflection never pulses bright enough to bloom into streaks.
    const shimmer = 0.04 + 0.03 * Math.sin(t * 0.7) + audio * 0.05
    this.refColor.copy(this.baseTint).lerp(this.shimmerTarget, shimmer)
  }

  dispose(): void {
    // Reflector.dispose() already frees its render target + shader material;
    // we still own the plane geometry passed in, so dispose that ourselves.
    this.reflector.dispose()
    this.reflectorGeo.dispose()

    this.gridMinorGeo.dispose()
    this.gridMajorGeo.dispose()
    this.gridMinorMat.dispose()
    this.gridMajorMat.dispose()

    this.glowGeo.dispose()
    this.glowMat.dispose()
    this.glowTex.dispose()

    this.ringGeo.dispose()
    this.ringMat.dispose()

    this.group.clear()
  }
}
