import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// Apparition — a PRESENCE IN THE WIRED. On a long, random timer (~12-28s) ONE
// eerie GENERIC humanoid silhouette materializes out of drifting STATIC at a
// random mid-distance spot, turns to FACE the camera and stands watching for a
// few seconds, then dissolves back into shimmering grains and vanishes — and
// reappears later somewhere else. The "wait… was someone there?" moment.
//
// COPYRIGHT-SAFE: the figure is a GENERIC featureless suggestion of a standing
// person assembled from primitives only — tapered torso, small icosa head,
// suggested legs and hanging arms. NO face, NO recognizable design, no text.
//
// LOOK: the body is a DARK transparent silhouette (fog:true, so it sinks into
// the twilight haze) wrapped in a faint ADDITIVE phosphor wireframe RIM-GLOW
// (fog:false, so it punches through the fog for the bloom pass). Over/through it
// a pooled POINTS cloud of white-hot grains forms the figure: while materialized
// the grains settle into the silhouette and barely shimmer; while transitioning
// they scatter outward into TV-static and the solid body fades away — selling
// the "resolves from / dissolves into static" effect.
//
// PERF: exactly ONE figure, all internals preallocated ONCE (shared geometries
// + materials, a single fixed grain buffer). The grain loop and material writes
// run ONLY while the apparition is visible (~6-10s out of every ~12-28s); the
// rest of the time everything is hidden and update() early-returns. No per-frame
// allocation. update() rates × ctx.motion; rim/grain intensity lift with audio.
// ============================================================================

const TAU = Math.PI * 2
const FLOOR = -10

// grain budget — sampled across the body; kept low (cheap, only runs when shown)
const GRAINS = 200

// state machine durations (seconds) — long quiet gaps between appearances
const COOLDOWN_MIN = 12
const COOLDOWN_VAR = 16 // -> 12..28s hidden
const IN_MIN = 1.9
const IN_VAR = 1.0 // resolve-in time
const WATCH_MIN = 3.0
const WATCH_VAR = 3.2 // standing-and-watching time
const OUT_MIN = 1.4
const OUT_VAR = 0.8 // dissolve-out time

// placement around the plaza (kept clear of the immediate centre)
const RADIUS_MIN = 16
const RADIUS_VAR = 29 // -> 16..45

type Phase = 'hidden' | 'in' | 'watch' | 'out'

interface Seg {
  x0: number; y0: number; z0: number
  x1: number; y1: number; z1: number
  r: number
  count: number
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

// shortest-path angular approach (forward = local +Z)
const approachAngle = (cur: number, target: number, t: number): number => {
  let d = target - cur
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return cur + d * Math.min(1, t)
}

// one soft round grain sprite — shared by every point of the static cloud
function makeGrainTexture(): THREE.CanvasTexture {
  const S = 32
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const ctx = canvas.getContext('2d')
  if (!ctx) return tex
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.45, 'rgba(210,240,255,0.55)')
  g.addColorStop(1, 'rgba(170,220,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  tex.needsUpdate = true
  return tex
}

export class Apparition implements SceneFeature {
  readonly group: THREE.Group

  // the figure sub-group (positioned/rotated per appearance)
  private readonly figure: THREE.Group

  // shared geometries
  private readonly legGeo: THREE.CylinderGeometry
  private readonly torsoGeo: THREE.CylinderGeometry
  private readonly armGeo: THREE.CylinderGeometry
  private readonly headGeo: THREE.IcosahedronGeometry
  private readonly torsoEdges: THREE.EdgesGeometry
  private readonly headEdges: THREE.EdgesGeometry
  private readonly grainGeo: THREE.BufferGeometry

  // shared materials
  private readonly bodyMat: THREE.MeshBasicMaterial // dark silhouette
  private readonly rimMat: THREE.LineBasicMaterial // additive wireframe glow
  private readonly grainMat: THREE.PointsMaterial // static cloud
  private readonly grainTex: THREE.CanvasTexture
  private readonly grainPoints: THREE.Points

  private readonly bodyMeshes: THREE.Mesh[] = []
  private readonly rimLines: THREE.LineSegments[] = []

  // grain buffers (figure-local space)
  private readonly gpos: Float32Array // live positions
  private readonly gposAttr: THREE.BufferAttribute
  private readonly ghome: Float32Array // settled "home" on the body
  private readonly gdir = new Float32Array(GRAINS * 3) // scatter direction
  private readonly gamt = new Float32Array(GRAINS) // scatter distance
  private readonly gord = new Float32Array(GRAINS) // settle stagger 0..1
  private readonly gph = new Float32Array(GRAINS) // shimmer phase

  // state
  private phase: Phase = 'hidden'
  private timer: number // counts in the current phase
  private inDur = IN_MIN
  private watchDur = WATCH_MIN
  private outDur = OUT_MIN
  private resolve = 0 // 0 = pure static, 1 = fully present

  // placement / pose
  private baseX = 0
  private baseY = FLOOR
  private baseZ = -30
  private curYaw = 0
  private targetYaw = 0
  private scale = 1
  private anim = 0

  // glitch jitter
  private glitchTimer = 1.5
  private glitchLeft = 0
  private glitchX = 0
  private glitchZ = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'Apparition'

    this.figure = new THREE.Group()
    this.figure.visible = false
    this.group.add(this.figure)

    // ---- shared geometries (figure-local: feet at y=0) ---------------------
    this.legGeo = new THREE.CylinderGeometry(0.1, 0.14, 2.2, 5)
    this.torsoGeo = new THREE.CylinderGeometry(0.5, 0.32, 2.0, 7)
    this.armGeo = new THREE.CylinderGeometry(0.08, 0.11, 1.6, 5)
    this.headGeo = new THREE.IcosahedronGeometry(0.42, 0)
    this.torsoEdges = new THREE.EdgesGeometry(this.torsoGeo)
    this.headEdges = new THREE.EdgesGeometry(this.headGeo)

    // ---- shared materials --------------------------------------------------
    // dark silhouette: a hair above the void, normal-blended so it darkens the
    // haze behind it; sinks into the FogExp2 horizon
    this.bodyMat = new THREE.MeshBasicMaterial({
      color: palette.voidColor.clone().lerp(palette.hologram, 0.1),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    })
    // additive wireframe rim that punches through the fog for the bloom pass
    this.rimMat = new THREE.LineBasicMaterial({
      color: palette.phosphor.clone().lerp(new THREE.Color(1, 1, 1), 0.2),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    // white-hot static grains
    this.grainTex = makeGrainTexture()
    this.grainMat = new THREE.PointsMaterial({
      map: this.grainTex,
      color: palette.phosphor.clone().lerp(new THREE.Color(1, 1, 1), 0.5),
      size: 0.42,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })

    // ---- build the body ----------------------------------------------------
    const addBody = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rot: number, order: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, this.bodyMat)
      mesh.position.set(x, y, z)
      mesh.rotation.z = rot
      mesh.renderOrder = order
      this.figure.add(mesh)
      this.bodyMeshes.push(mesh)
      return mesh
    }
    const addRim = (edges: THREE.EdgesGeometry, y: number): void => {
      const line = new THREE.LineSegments(edges, this.rimMat)
      line.position.y = y
      line.renderOrder = 3
      this.figure.add(line)
      this.rimLines.push(line)
    }

    addBody(this.legGeo, -0.3, 1.1, 0, 0, 2) // left leg
    addBody(this.legGeo, 0.3, 1.1, 0, 0, 2) // right leg
    addBody(this.torsoGeo, 0, 3.2, 0, 0, 2)
    addBody(this.armGeo, -0.62, 3.4, 0.03, 0.16, 2) // left arm
    addBody(this.armGeo, 0.62, 3.4, 0.03, -0.16, 2) // right arm
    addBody(this.headGeo, 0, 4.75, 0, 0, 2)
    addRim(this.torsoEdges, 3.2)
    addRim(this.headEdges, 4.75)

    // ---- grain cloud: sample home positions across the body ----------------
    const segs: Seg[] = [
      { x0: -0.3, y0: 0.05, z0: 0, x1: -0.3, y1: 2.15, z1: 0, r: 0.15, count: 26 }, // L leg
      { x0: 0.3, y0: 0.05, z0: 0, x1: 0.3, y1: 2.15, z1: 0, r: 0.15, count: 26 }, // R leg
      { x0: 0, y0: 2.2, z0: 0, x1: 0, y1: 4.2, z1: 0, r: 0.42, count: 70 }, // torso
      { x0: -0.55, y0: 4.1, z0: 0.03, x1: -0.7, y1: 2.6, z1: 0.05, r: 0.12, count: 21 }, // L arm
      { x0: 0.55, y0: 4.1, z0: 0.03, x1: 0.7, y1: 2.6, z1: 0.05, r: 0.12, count: 21 }, // R arm
    ]
    const HEAD_C = GRAINS - (26 + 26 + 70 + 21 + 21) // remaining -> head sphere

    this.gpos = new Float32Array(GRAINS * 3)
    this.ghome = new Float32Array(GRAINS * 3)
    let g = 0
    for (const s of segs) {
      const taper = (s.r - 0.04) // narrow slightly toward limb ends
      for (let k = 0; k < s.count && g < GRAINS; k++, g++) {
        const t = Math.random()
        const rr = (0.2 + Math.random() * 0.8) * (s.r - taper * 0.4)
        const a = Math.random() * TAU
        const i3 = g * 3
        this.ghome[i3] = s.x0 + (s.x1 - s.x0) * t + Math.cos(a) * rr
        this.ghome[i3 + 1] = s.y0 + (s.y1 - s.y0) * t
        this.ghome[i3 + 2] = s.z0 + (s.z1 - s.z0) * t + Math.sin(a) * rr
      }
    }
    for (let k = 0; k < HEAD_C && g < GRAINS; k++, g++) {
      // points on a sphere shell around the head centre
      const u = Math.random() * 2 - 1
      const a = Math.random() * TAU
      const sr = Math.sqrt(1 - u * u)
      const rad = 0.42 * (0.7 + Math.random() * 0.3)
      const i3 = g * 3
      this.ghome[i3] = Math.cos(a) * sr * rad
      this.ghome[i3 + 1] = 4.75 + u * rad
      this.ghome[i3 + 2] = Math.sin(a) * sr * rad
    }
    // any leftover grains (rounding) park at the chest
    for (; g < GRAINS; g++) {
      const i3 = g * 3
      this.ghome[i3] = (Math.random() - 0.5) * 0.4
      this.ghome[i3 + 1] = 3.4 + (Math.random() - 0.5) * 0.6
      this.ghome[i3 + 2] = (Math.random() - 0.5) * 0.3
    }
    this.gpos.set(this.ghome)

    this.gposAttr = new THREE.BufferAttribute(this.gpos, 3)
    this.gposAttr.setUsage(THREE.DynamicDrawUsage)
    this.grainGeo = new THREE.BufferGeometry()
    this.grainGeo.setAttribute('position', this.gposAttr)
    this.grainPoints = new THREE.Points(this.grainGeo, this.grainMat)
    this.grainPoints.frustumCulled = false
    this.grainPoints.renderOrder = 3
    this.figure.add(this.grainPoints)

    this.randomizeGrains()

    // first appearance fairly soon, then settle into the long rhythm
    this.phase = 'hidden'
    this.timer = 6 + Math.random() * 8
  }

  // re-roll per-grain scatter behaviour (cheap, once per appearance)
  private randomizeGrains(): void {
    for (let i = 0; i < GRAINS; i++) {
      const u = Math.random() * 2 - 1
      const a = Math.random() * TAU
      const sr = Math.sqrt(1 - u * u)
      const i3 = i * 3
      // bias the dispersal slightly upward — static drifting off into the Wired
      this.gdir[i3] = Math.cos(a) * sr
      this.gdir[i3 + 1] = u * 0.6 + 0.5
      this.gdir[i3 + 2] = Math.sin(a) * sr
      this.gamt[i] = 1.5 + Math.random() * 3.5
      this.gord[i] = Math.random()
      this.gph[i] = Math.random() * TAU
    }
  }

  // choose a new appearance spot/pose; called as we leave the hidden phase
  private spawn(ctx: FeatureContext): void {
    const ang = Math.random() * TAU
    const rad = RADIUS_MIN + Math.random() * RADIUS_VAR
    this.baseX = Math.cos(ang) * rad
    this.baseZ = Math.sin(ang) * rad
    // mostly standing on the floor; sometimes faintly floating above it
    this.baseY = Math.random() < 0.3 ? FLOOR + 2 + Math.random() * 7 : FLOOR
    this.scale = 0.9 + Math.random() * 0.4

    this.inDur = IN_MIN + Math.random() * IN_VAR
    this.watchDur = WATCH_MIN + Math.random() * WATCH_VAR
    this.outDur = OUT_MIN + Math.random() * OUT_VAR

    // face the camera, but start turned away by some amount so it visibly turns
    const cam = ctx.camera.position
    this.targetYaw = Math.atan2(cam.x - this.baseX, cam.z - this.baseZ)
    this.curYaw = this.targetYaw + (Math.random() * 2 - 1) * 1.3

    this.randomizeGrains()
    this.glitchTimer = 0.8 + Math.random() * 1.8
    this.glitchLeft = 0
    this.glitchX = 0
    this.glitchZ = 0

    this.figure.position.set(this.baseX, this.baseY, this.baseZ)
    this.figure.scale.setScalar(this.scale)
    this.figure.visible = true
    this.resolve = 0
  }

  private hide(): void {
    this.figure.visible = false
    this.resolve = 0
    this.phase = 'hidden'
    this.timer = COOLDOWN_MIN + Math.random() * COOLDOWN_VAR
  }

  update(ctx: FeatureContext): void {
    const dtm = ctx.dt * ctx.motion

    // ---- hidden: just tick the long cooldown, do nothing else ----
    if (this.phase === 'hidden') {
      this.timer -= dtm * (1 + ctx.audio * 0.3) // a louder Wired calls it sooner
      if (this.timer <= 0) {
        this.spawn(ctx)
        this.phase = 'in'
        this.timer = 0
      }
      return
    }

    // ---- advance the visible state machine ----
    this.anim += dtm
    this.timer += dtm

    switch (this.phase) {
      case 'in':
        this.resolve = Math.min(1, this.timer / this.inDur)
        if (this.timer >= this.inDur) {
          this.phase = 'watch'
          this.timer = 0
          this.resolve = 1
        }
        break
      case 'watch':
        this.resolve = 1
        if (this.timer >= this.watchDur) {
          this.phase = 'out'
          this.timer = 0
        }
        break
      case 'out':
        this.resolve = Math.max(0, 1 - this.timer / this.outDur)
        if (this.timer >= this.outDur) {
          this.hide()
          return
        }
        break
    }

    const r = this.resolve
    const t = this.anim
    const audioLift = 1 + ctx.audio * 0.35

    // ---- glitch jitter (brief, only while reasonably present) ----
    this.glitchLeft -= dtm
    if (this.phase !== 'out' && r > 0.4) {
      this.glitchTimer -= dtm * (1 + ctx.audio * 0.6)
      if (this.glitchTimer <= 0) {
        this.glitchTimer = 0.7 + Math.random() * 2.4
        this.glitchLeft = 0.05 + Math.random() * 0.08
        this.glitchX = (Math.random() * 2 - 1) * 0.18
        this.glitchZ = (Math.random() * 2 - 1) * 0.12
      }
    }
    const glitching = this.glitchLeft > 0
    if (!glitching) {
      this.glitchX = 0
      this.glitchZ = 0
    }

    // ---- turn to face the camera + subtle sway/bob ----
    const cam = ctx.camera.position
    this.targetYaw = Math.atan2(cam.x - this.baseX, cam.z - this.baseZ)
    this.curYaw = approachAngle(this.curYaw, this.targetYaw, dtm * 1.6)

    const sway = Math.sin(t * 0.7)
    const sway2 = Math.sin(t * 0.45 + 1.1)
    this.figure.rotation.set(sway2 * 0.02, this.curYaw + sway * 0.025, sway * 0.03)
    this.figure.position.set(
      this.baseX + this.glitchX,
      this.baseY + sway2 * 0.06,
      this.baseZ + this.glitchZ,
    )

    // ---- material envelopes ----
    // solid body only firms up once mostly resolved; static dominates the edges
    const bodyVis = smoothstep(0.45, 0.95, r)
    const edgeFade = Math.min(1, r / 0.12) // global fade-from-zero, no pop
    const rimFlicker = 0.55 + 0.45 * Math.sin(t * 8.5 + 0.6) + (glitching ? 0.6 : 0)
    this.bodyMat.opacity = 0.8 * bodyVis
    this.rimMat.opacity = 0.7 * smoothstep(0.5, 1, r) * rimFlicker * audioLift
    this.grainMat.opacity = 0.8 * edgeFade * (0.3 + 0.7 * (1 - bodyVis)) * audioLift * (glitching ? 1.3 : 1)

    // ---- drive the static grains (figure-local space) ----
    const shimmerBase = glitching ? 0.16 : 0.05
    for (let i = 0; i < GRAINS; i++) {
      // staggered settle: low-order grains snap home first
      const s = Math.min(1, Math.max(0, (r - this.gord[i] * 0.4) / 0.6))
      const disp = (1 - s) * this.gamt[i]
      const shimmerAmp = shimmerBase + (1 - s) * 0.28
      const ph = this.gph[i]
      const i3 = i * 3
      this.gpos[i3] = this.ghome[i3] + this.gdir[i3] * disp + Math.sin(t * 11 + ph) * shimmerAmp
      this.gpos[i3 + 1] = this.ghome[i3 + 1] + this.gdir[i3 + 1] * disp + Math.sin(t * 9 + ph * 1.7) * shimmerAmp
      this.gpos[i3 + 2] = this.ghome[i3 + 2] + this.gdir[i3 + 2] * disp + Math.cos(t * 12 + ph) * shimmerAmp
    }
    this.gposAttr.needsUpdate = true
  }

  dispose(): void {
    this.legGeo.dispose()
    this.torsoGeo.dispose()
    this.armGeo.dispose()
    this.headGeo.dispose()
    this.torsoEdges.dispose()
    this.headEdges.dispose()
    this.grainGeo.dispose()
    this.bodyMat.dispose()
    this.rimMat.dispose()
    this.grainMat.dispose()
    this.grainTex.dispose()
    this.bodyMeshes.length = 0
    this.rimLines.length = 0
    this.group.clear()
  }
}
