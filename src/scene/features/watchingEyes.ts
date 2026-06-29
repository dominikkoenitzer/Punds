import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// WatchingEyes — the core LAIN motif: disembodied EYES that open in the dark
// between the towers and WATCH you. Quiet, restrained, unsettling — NOT battle
// spectacle.
//
// A small POOL of glowing eyes lives in the darker regions of the world (radius
// ~14-55, varied height, never the dead-centre of the plaza). Each eye is a
// flat assembly billboarded to face the camera:
//   • a soft blue SCLERA glow halo (steady, behind everything),
//   • an almond LENS OUTLINE (two arcs) that opens vertically from a slit,
//   • a glowing IRIS disc + limbal RING that drift to TRACK the camera,
//   • a bright white-hot PUPIL.
//
// BEHAVIOUR (pooled, recurring, staggered): an idle eye waits on a cooldown,
// then fades in while the eyelid OPENS from a slit; it WATCHES for a couple of
// seconds — the iris/pupil leading toward the camera as the eye lazily swivels
// to follow you — BLINKS once (lid snaps shut and open), then fades out and
// recycles to a fresh dark spot. A faint per-eye glow FLICKER (a destabilising
// transmission) rises with ctx.audio. Staggered cooldowns keep ~2-4 watching at
// once.
//
// Billboarding: each frame the eye SLERPS toward facing the camera (a slight
// lag), and the residual angle drives the iris offset, so a moved camera makes
// the eye visibly dart to look at you. Shared geometries + one glow texture;
// per-eye materials only (so eyes fade independently). No per-frame allocation;
// idle eyes are fully hidden. COPYRIGHT-SAFE: generic glowing shapes only.
// ============================================================================

const TAU = Math.PI * 2

const POOL = 6

// unit-space eye dimensions (scaled per eye via group.scale)
const LENS_W = 1.4 // half-width of the almond
const LENS_H = 0.85 // half-height of the almond (max opening)
const IRIS_R = LENS_H * 0.7
const PUPIL_R = IRIS_R * 0.42
const SLIT = 0.05 // minimum lid opening (closed/blinked)

// iris travel clamps (kept inside the lens)
const IRIS_MAX_X = (LENS_W - IRIS_R) * 0.55
const IRIS_MAX_Y = (LENS_H - IRIS_R) * 0.5

const OPEN_DUR = 0.7
const CLOSE_DUR = 0.6
const BLINK_DUR = 0.16

// material base opacities
const GLOW_BASE = 0.55
const OUTLINE_BASE = 0.95
const IRIS_BASE = 0.7
const PUPIL_BASE = 1.0

// state machine
const IDLE = 0
const OPENING = 1
const WATCHING = 2
const CLOSING = 3

interface EyeRec {
  group: THREE.Group // billboarded; holds world position
  content: THREE.Group // scale.y = lid opening
  iris: THREE.Group // x/y offset = gaze tracking

  glowMat: THREE.MeshBasicMaterial
  outlineMat: THREE.LineBasicMaterial
  irisMat: THREE.MeshBasicMaterial
  pupilMat: THREE.MeshBasicMaterial

  state: number
  timer: number
  cooldown: number
  opacity: number
  open: number

  watchDur: number
  blinkAt: number
  blinked: boolean

  // flicker
  fr1: number
  fr2: number
  fp: number
}

// soft round blue glow sprite — shared by every eye's sclera halo
function makeGlowTexture(): THREE.CanvasTexture {
  const S = 64
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const ctx = canvas.getContext('2d')
  if (!ctx) return tex
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(205,232,255,0.9)')
  g.addColorStop(0.4, 'rgba(120,200,255,0.32)')
  g.addColorStop(1, 'rgba(55,115,200,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  tex.needsUpdate = true
  return tex
}

export class WatchingEyes implements SceneFeature {
  readonly group: THREE.Group

  // shared geometry
  private readonly lensGeo: THREE.BufferGeometry
  private readonly limbalGeo: THREE.BufferGeometry
  private readonly irisGeo: THREE.CircleGeometry
  private readonly pupilGeo: THREE.CircleGeometry
  private readonly glowGeo: THREE.PlaneGeometry
  private readonly glowTex: THREE.CanvasTexture

  private readonly eyes: EyeRec[] = []

  // palette-derived colours (cloned once, never reallocated)
  private readonly white = new THREE.Color(1, 1, 1)
  private readonly outlineColor: THREE.Color
  private readonly irisColor: THREE.Color
  private readonly glowColor: THREE.Color

  // reused temporaries (no per-frame allocation)
  private readonly _m = new THREE.Matrix4()
  private readonly _q = new THREE.Quaternion()
  private readonly _invQ = new THREE.Quaternion()
  private readonly _dir = new THREE.Vector3()
  private readonly _local = new THREE.Vector3()
  private readonly _up = new THREE.Vector3(0, 1, 0)

  private anim = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'WatchingEyes'

    this.outlineColor = palette.phosphor.clone().lerp(this.white, 0.3)
    this.irisColor = palette.hologram.clone().lerp(palette.phosphor, 0.4)
    this.glowColor = palette.hologram.clone().lerp(palette.phosphor, 0.5)

    // ---- shared geometry ---------------------------------------------------
    this.lensGeo = this.makeAlmondLine(LENS_W, LENS_H, 22)
    this.limbalGeo = this.makeCircleLine(IRIS_R, 26)
    this.irisGeo = new THREE.CircleGeometry(IRIS_R, 24)
    this.pupilGeo = new THREE.CircleGeometry(PUPIL_R, 18)
    this.glowGeo = new THREE.PlaneGeometry(LENS_W * 3.4, LENS_H * 4.4)
    this.glowTex = makeGlowTexture()

    // ---- build the pool ----------------------------------------------------
    for (let i = 0; i < POOL; i++) this.eyes.push(this.buildEye(i))
  }

  // almond / lens outline (closed loop): a rounded upper lid + a flatter lower
  // lid meeting at pointed corners. Scaling Y -> 0 collapses it to a slit.
  private makeAlmondLine(w: number, h: number, segs: number): THREE.BufferGeometry {
    const pts: number[] = []
    // upper lid, left -> right
    for (let i = 0; i <= segs; i++) {
      const x = -w + (2 * w * i) / segs
      const k = 1 - (x / w) * (x / w)
      pts.push(x, h * Math.pow(Math.max(0, k), 0.8), 0)
    }
    // lower lid, right -> left (skip shared corner endpoints)
    for (let i = segs - 1; i >= 1; i--) {
      const x = -w + (2 * w * i) / segs
      const k = 1 - (x / w) * (x / w)
      pts.push(x, -h * 0.62 * Math.pow(Math.max(0, k), 0.9), 0)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    return geo
  }

  private makeCircleLine(r: number, segs: number): THREE.BufferGeometry {
    const pts: number[] = []
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU
      pts.push(Math.cos(a) * r, Math.sin(a) * r, 0)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
    return geo
  }

  private makeMat(color: THREE.Color, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    })
  }

  private buildEye(i: number): EyeRec {
    const glowMat = this.makeMat(this.glowColor, 0)
    glowMat.map = this.glowTex
    const outlineMat = new THREE.LineBasicMaterial({
      color: this.outlineColor.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    const irisMat = this.makeMat(this.irisColor, 0)
    const pupilMat = this.makeMat(this.white, 0)

    const group = new THREE.Group()
    group.visible = false

    const glow = new THREE.Mesh(this.glowGeo, glowMat)
    glow.position.z = -0.05
    glow.renderOrder = 0
    group.add(glow)

    const content = new THREE.Group()
    group.add(content)

    const lens = new THREE.LineLoop(this.lensGeo, outlineMat)
    lens.position.z = 0.03
    lens.renderOrder = 3
    content.add(lens)

    const iris = new THREE.Group()
    content.add(iris)

    const irisDisc = new THREE.Mesh(this.irisGeo, irisMat)
    irisDisc.renderOrder = 1
    iris.add(irisDisc)

    const limbal = new THREE.LineLoop(this.limbalGeo, outlineMat)
    limbal.position.z = 0.015
    limbal.renderOrder = 2
    iris.add(limbal)

    const pupil = new THREE.Mesh(this.pupilGeo, pupilMat)
    pupil.position.z = 0.02
    pupil.renderOrder = 2
    iris.add(pupil)

    this.group.add(group)

    return {
      group,
      content,
      iris,
      glowMat,
      outlineMat,
      irisMat,
      pupilMat,
      state: IDLE,
      timer: 0,
      cooldown: 0.3 + i * 0.9 + Math.random() * 0.8, // staggered first opening
      opacity: 0,
      open: SLIT,
      watchDur: 0,
      blinkAt: 0,
      blinked: false,
      fr1: 0,
      fr2: 0,
      fp: 0,
    }
  }

  // re-home an eye to a fresh dark spot and aim it at the camera immediately
  private place(eye: EyeRec, camPos: THREE.Vector3): void {
    const ang = Math.random() * TAU
    const rad = 14 + Math.random() * 41
    const high = Math.random() < 0.45
    const y = high ? 12 + Math.random() * 28 : -4 + Math.random() * 11
    eye.group.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad)

    const size = 1 + ((rad - 14) / 41) * 1.4 // distant eyes are larger to stay readable
    eye.group.scale.setScalar(size)

    eye.iris.position.set(0, 0, 0)
    eye.watchDur = 2.0 + Math.random() * 2.2
    eye.blinkAt = 0.5 + Math.random() * Math.max(0.3, eye.watchDur - 1.2)
    eye.blinked = false
    eye.fr1 = 4 + Math.random() * 6
    eye.fr2 = 9 + Math.random() * 9
    eye.fp = Math.random() * TAU

    // aim at the camera right away so it opens already facing you
    this._m.lookAt(camPos, eye.group.position, this._up)
    eye.group.quaternion.setFromRotationMatrix(this._m)
  }

  update(ctx: FeatureContext): void {
    const dtm = ctx.dt * ctx.motion
    this.anim += dtm
    const t = this.anim
    const audio = ctx.audio
    const camPos = ctx.camera.position
    const turn = 1 - Math.exp(-2.2 * ctx.dt) // billboard slerp (camera-responsive)
    const irisLerp = Math.min(1, ctx.dt * 10)

    for (const eye of this.eyes) {
      // ---- state machine --------------------------------------------------
      switch (eye.state) {
        case IDLE:
          eye.cooldown -= dtm * (1 + audio * 0.6)
          if (eye.cooldown <= 0) {
            this.place(eye, camPos)
            eye.group.visible = true
            eye.state = OPENING
            eye.timer = 0
            eye.opacity = 0
            eye.open = SLIT
          }
          break
        case OPENING: {
          eye.timer += dtm
          const f = Math.min(eye.timer / OPEN_DUR, 1)
          eye.opacity = f
          const e = 1 - (1 - f) * (1 - f) * (1 - f) // easeOutCubic
          eye.open = SLIT + (1 - SLIT) * e
          if (f >= 1) {
            eye.state = WATCHING
            eye.timer = 0
          }
          break
        }
        case WATCHING: {
          eye.timer += dtm
          eye.opacity = 1
          let open = 1
          if (!eye.blinked && eye.timer >= eye.blinkAt) {
            const bt = eye.timer - eye.blinkAt
            if (bt < BLINK_DUR) {
              const tri = Math.abs(bt / BLINK_DUR - 0.5) * 2 // 1 -> 0 -> 1
              open = SLIT + (1 - SLIT) * tri
            } else {
              eye.blinked = true
            }
          }
          eye.open = open
          if (eye.timer >= eye.watchDur) {
            eye.state = CLOSING
            eye.timer = 0
          }
          break
        }
        case CLOSING: {
          eye.timer += dtm
          const f = Math.min(eye.timer / CLOSE_DUR, 1)
          eye.opacity = 1 - f
          eye.open = SLIT + (1 - SLIT) * (1 - f * f) // ease-in close
          if (f >= 1) {
            eye.state = IDLE
            eye.group.visible = false
            eye.cooldown = 2.5 + Math.random() * 3.5
          }
          break
        }
        default:
          break
      }

      if (!eye.group.visible) continue

      // ---- billboard toward the camera (with a slight lag) ----------------
      this._m.lookAt(camPos, eye.group.position, this._up)
      this._q.setFromRotationMatrix(this._m)
      eye.group.quaternion.slerp(this._q, turn)

      // ---- gaze: residual angle to the camera drives the iris offset ------
      this._dir.copy(camPos).sub(eye.group.position).normalize()
      this._invQ.copy(eye.group.quaternion).invert()
      this._local.copy(this._dir).applyQuaternion(this._invQ)
      const tx = THREE.MathUtils.clamp(this._local.x * 2.0, -IRIS_MAX_X, IRIS_MAX_X)
      const ty = THREE.MathUtils.clamp(this._local.y * 2.0, -IRIS_MAX_Y, IRIS_MAX_Y)
      eye.iris.position.x += (tx - eye.iris.position.x) * irisLerp
      eye.iris.position.y += (ty - eye.iris.position.y) * irisLerp

      // ---- lid opening ----------------------------------------------------
      eye.content.scale.set(1, eye.open, 1)

      // ---- flicker + opacity ----------------------------------------------
      const fl = 0.8 + 0.2 * Math.sin(t * eye.fr1 + eye.fp) * Math.cos(t * eye.fr2 + eye.fp * 1.7)
      const jitter = audio * 0.25 * Math.sin(t * 26 + eye.fp)
      const flick = Math.max(0, fl + jitter)
      const o = eye.opacity
      eye.glowMat.opacity = o * GLOW_BASE * flick * (1 + audio * 0.5)
      eye.outlineMat.opacity = o * OUTLINE_BASE * flick
      eye.irisMat.opacity = o * IRIS_BASE * flick
      eye.pupilMat.opacity = o * PUPIL_BASE * (0.85 + 0.15 * flick)
    }
  }

  dispose(): void {
    this.lensGeo.dispose()
    this.limbalGeo.dispose()
    this.irisGeo.dispose()
    this.pupilGeo.dispose()
    this.glowGeo.dispose()
    this.glowTex.dispose()
    for (const eye of this.eyes) {
      eye.glowMat.dispose()
      eye.outlineMat.dispose()
      eye.irisMat.dispose()
      eye.pupilMat.dispose()
    }
    this.eyes.length = 0
    this.group.clear()
  }
}
