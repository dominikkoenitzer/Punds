import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// HolographicFish — a school of holographic KOI drifting through the air of the
// corporate plaza (the iconic cyberpunk holo-fish-ad motif from the wet-neon
// downtown). Each fish is a single FLATTENED plane textured with ONE shared,
// pre-rendered koi-SILHOUETTE CanvasTexture (body + dorsal/pectoral fins + a
// fanned tail, drawn as a soft additive glow). The whole school shares that one
// texture and ONE unit PlaneGeometry; only the per-fish MeshBasicMaterial is
// unique (so each koi carries its own phosphor/hologram/tachibana tint and its
// own brightness shimmer).
//
// Motion is smooth looping orbital drift, not boids: every fish circles the
// plaza on its own slowly-modulated orbit (angle + breathing radius + vertical
// bob + a small epicycle for an organic, non-circular path) so the flock stays
// inside bounds (radius ~8..40, y ~-9..23) with no escape and no clumping. The
// heading is taken from a fixed finite-difference of the path (stable under any
// motion scale), then the koi is laid along its travel direction kept roughly
// upright; because tangential travel makes each koi's broad side face radially —
// i.e. toward the camera at the origin — you read the silhouette in profile. A
// brisk sine TAIL WAG (yaw + a little roll, fast relative to the slow body
// drift) plus a length breathe makes them undulate like swimming.
//
// update(): per fish two cheap scalar position samples, one orientation basis,
// two small quaternion wags, an opacity shimmer lifted by ctx.audio. All scratch
// objects are reused — no per-frame allocation. All rates scale with ctx.motion
// via a private accumulated anim clock.
// ============================================================================

const TAU = Math.PI * 2
const COUNT = 22
const HEADING_EPS = 0.05 // anim-units used to finite-difference the travel heading

const UP = new THREE.Vector3(0, 1, 0)
const AXIS_Y = new THREE.Vector3(0, 1, 0)
const AXIS_Z = new THREE.Vector3(0, 0, 1)

interface Fish {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  len: number
  baseOpacity: number
  // orbit
  angle0: number
  angSpeed: number
  radius0: number
  radAmp: number
  radSpeed: number
  radPhase: number
  y0: number
  yAmp: number
  ySpeed: number
  yPhase: number
  epiAmp: number
  epiSpeed: number
  epiPhase: number
  // swim
  tailSpeed: number
  tailPhase: number
  tailAmpY: number
  tailAmpZ: number
  shimSpeed: number
  shimPhase: number
}

// One soft, glowing koi silhouette (white -> tinted per fish by material.color).
// Drawn pointing +X (head at right) so the plane's local +X reads as "forward".
function makeKoiTexture(): THREE.CanvasTexture {
  const W = 320
  const H = 160
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace

  const ctx = canvas.getContext('2d')
  if (!ctx) return tex // stays transparent if no 2d context

  ctx.clearRect(0, 0, W, H)
  ctx.translate(W / 2, H / 2)
  ctx.lineJoin = 'round'

  // trace the koi outline (body + tail fan + dorsal + pectoral) as one path so a
  // single fill unions them; nonzero winding fills the whole silhouette
  const trace = (): void => {
    ctx.beginPath()
    // body: nose at +95, tail wrist at -55
    ctx.moveTo(95, 0)
    ctx.bezierCurveTo(60, -34, -10, -34, -55, -12)
    ctx.bezierCurveTo(-66, -5, -66, 5, -55, 12)
    ctx.bezierCurveTo(-10, 34, 60, 34, 95, 0)
    ctx.closePath()
    // tail fan
    ctx.moveTo(-55, 0)
    ctx.lineTo(-120, -46)
    ctx.quadraticCurveTo(-92, 0, -120, 46)
    ctx.closePath()
    // dorsal fin (top)
    ctx.moveTo(5, -30)
    ctx.quadraticCurveTo(-10, -56, -34, -50)
    ctx.quadraticCurveTo(-16, -34, -22, -28)
    ctx.closePath()
    // pectoral fin (lower, near the head)
    ctx.moveTo(38, 16)
    ctx.quadraticCurveTo(30, 50, 6, 52)
    ctx.quadraticCurveTo(22, 26, 24, 18)
    ctx.closePath()
  }

  // soft outer halo so the bloom pass has something to bloom
  ctx.shadowColor = 'rgba(255,255,255,0.85)'
  ctx.shadowBlur = 28
  ctx.fillStyle = 'rgba(255,255,255,0.22)'
  trace()
  ctx.fill()

  // brighter inner body
  ctx.shadowBlur = 11
  ctx.fillStyle = 'rgba(255,255,255,0.66)'
  trace()
  ctx.fill()

  // hot core / eye glint near the head
  ctx.shadowBlur = 0
  const glint = ctx.createRadialGradient(56, -4, 0, 56, -4, 34)
  glint.addColorStop(0, 'rgba(255,255,255,0.95)')
  glint.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glint
  ctx.beginPath()
  ctx.arc(56, -4, 34, 0, TAU)
  ctx.fill()

  tex.needsUpdate = true
  return tex
}

export class HolographicFish implements SceneFeature {
  readonly group: THREE.Group

  private readonly geometry: THREE.PlaneGeometry
  private readonly texture: THREE.CanvasTexture
  private readonly fish: Fish[] = []
  private anim = 0

  // reusable scratch — no per-frame allocation
  private readonly posA = new THREE.Vector3()
  private readonly posB = new THREE.Vector3()
  private readonly fwd = new THREE.Vector3()
  private readonly nrm = new THREE.Vector3()
  private readonly upv = new THREE.Vector3()
  private readonly basis = new THREE.Matrix4()
  private readonly quat = new THREE.Quaternion()
  private readonly qWag = new THREE.Quaternion()

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'HolographicFish'

    this.texture = makeKoiTexture()
    this.geometry = new THREE.PlaneGeometry(1, 1) // unit plane; per-fish scale sets length/height

    const white = new THREE.Color(1, 1, 1)

    for (let i = 0; i < COUNT; i++) {
      // mostly phosphor cyan / hologram blue, an occasional tachibana-amber koi
      const r = Math.random()
      const tint =
        r < 0.12
          ? palette.tachibana.clone()
          : r < 0.46
            ? palette.hologram.clone().lerp(white, 0.18)
            : palette.phosphor.clone().lerp(white, 0.12)

      const mat = new THREE.MeshBasicMaterial({
        map: this.texture,
        color: tint,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })

      const mesh = new THREE.Mesh(this.geometry, mat)
      mesh.renderOrder = 2

      const f: Fish = {
        mesh,
        mat,
        len: 2.2 + Math.random() * 1.8,
        baseOpacity: (r < 0.12 ? 0.4 : 0.46) + Math.random() * 0.22,
        angle0: Math.random() * TAU,
        angSpeed: (0.06 + Math.random() * 0.12) * (Math.random() < 0.5 ? 1 : -1),
        radius0: 12 + Math.random() * 22,
        radAmp: 1.5 + Math.random() * 2.5,
        radSpeed: 0.05 + Math.random() * 0.11,
        radPhase: Math.random() * TAU,
        y0: -3 + Math.random() * 20,
        yAmp: 1.5 + Math.random() * 4.5,
        ySpeed: 0.05 + Math.random() * 0.1,
        yPhase: Math.random() * TAU,
        epiAmp: 0.5 + Math.random() * 1.5,
        epiSpeed: 0.2 + Math.random() * 0.4,
        epiPhase: Math.random() * TAU,
        tailSpeed: 2.5 + Math.random() * 2.5,
        tailPhase: Math.random() * TAU,
        tailAmpY: 0.18 + Math.random() * 0.12,
        tailAmpZ: 0.05 + Math.random() * 0.06,
        shimSpeed: 0.8 + Math.random() * 1.6,
        shimPhase: Math.random() * TAU,
      }

      // seat at its start position so nothing pops on the first frame
      this.computePos(f, 0, this.posA)
      mesh.position.copy(this.posA)
      mesh.scale.set(f.len, f.len * 0.5, 1)

      this.group.add(mesh)
      this.fish.push(f)
    }
  }

  // smooth looping orbit: angle + breathing radius + vertical bob + small epicycle
  private computePos(f: Fish, a: number, out: THREE.Vector3): void {
    const angle = f.angle0 + a * f.angSpeed
    const radius = f.radius0 + Math.sin(a * f.radSpeed + f.radPhase) * f.radAmp
    const ex = Math.cos(a * f.epiSpeed + f.epiPhase) * f.epiAmp
    const ez = Math.sin(a * f.epiSpeed * 1.3 + f.epiPhase) * f.epiAmp
    out.set(
      Math.cos(angle) * radius + ex,
      f.y0 + Math.sin(a * f.ySpeed + f.yPhase) * f.yAmp,
      Math.sin(angle) * radius + ez,
    )
  }

  update(ctx: FeatureContext): void {
    this.anim += ctx.dt * ctx.motion
    const a = this.anim
    const audioGain = 1 + ctx.audio * 0.5

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i]

      // position + a fixed look-ahead sample to derive a stable travel heading
      this.computePos(f, a, this.posA)
      this.computePos(f, a + HEADING_EPS, this.posB)
      this.fwd.copy(this.posB).sub(this.posA)

      if (this.fwd.lengthSq() > 1e-9) {
        this.fwd.normalize()
        // normal = forward x up -> radial-ish, kept horizontal so koi stay upright
        this.nrm.copy(this.fwd).cross(UP)
        if (this.nrm.lengthSq() < 1e-6) this.nrm.set(1, 0, 0)
        this.nrm.normalize()
        this.upv.copy(this.nrm).cross(this.fwd).normalize()
        // local X -> forward(head), local Y -> up, local Z(plane normal) -> side
        this.basis.makeBasis(this.fwd, this.upv, this.nrm)
        this.quat.setFromRotationMatrix(this.basis)

        // tail wag: brisk yaw swish + a little roll, in the fish's local frame
        const wag = Math.sin(a * f.tailSpeed + f.tailPhase)
        this.qWag.setFromAxisAngle(AXIS_Y, wag * f.tailAmpY)
        this.quat.multiply(this.qWag)
        this.qWag.setFromAxisAngle(AXIS_Z, Math.sin(a * f.tailSpeed + f.tailPhase + 1.2) * f.tailAmpZ)
        this.quat.multiply(this.qWag)

        f.mesh.quaternion.copy(this.quat)
      }

      f.mesh.position.copy(this.posA)

      // subtle body breathe along the length (undulation)
      const breathe = 1 + Math.sin(a * f.tailSpeed + f.tailPhase) * 0.05
      f.mesh.scale.set(f.len * breathe, f.len * 0.5, 1)

      // holographic shimmer, lifted gently by the bass
      f.mat.opacity =
        f.baseOpacity * (0.72 + 0.28 * Math.sin(a * f.shimSpeed + f.shimPhase)) * audioGain
    }
  }

  dispose(): void {
    for (const f of this.fish) f.mat.dispose()
    this.fish.length = 0
    this.geometry.dispose()
    this.texture.dispose()
    this.group.clear()
  }
}
