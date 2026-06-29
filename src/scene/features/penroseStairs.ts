import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// PenroseStairs — a floating IMPOSSIBLE (Penrose/Escher) staircase that reads as
// ascending FOREVER in a loop, hung in the twilight sky off to one side of the
// plaza. The classic Penrose square: FOUR flights of steps wrap the edges of a
// square footprint, each flight climbing as it goes and joining at the corners,
// so as the whole loop slowly turns the eye keeps "walking up" and never arrives.
//
// Every step is one small box. All 4 × STEPS_PER_FLIGHT steps are drawn from a
// single shared unit BoxGeometry by TWO InstancedMeshes (~2 draw calls spanning
// the whole loop):
//   • bodies — a DARK twilight-blue slab body (MeshBasicMaterial, fog) so the
//     mass reads as a solid staircase silhouette against the sky.
//   • frames — the SAME boxes grown a hair, with a shared ADDITIVE edge-glow
//     CanvasTexture (bright border, transparent centre); per-instance tint runs
//     phosphor → hologram around the loop so the ascending edges glow and bloom
//     and the rising gradient sells the "always up" read.
// A single additive SPRITE marker endlessly climbs the treads around the loop,
// fading out at the seam so the reset back to the bottom is never seen.
//
// update(): slowly ROTATE the loop (so the impossible square turns and catches
// the eye), a gentle vertical bob, a faint audio brightness/opacity lift, and
// advance the climbing marker — all × ctx.motion. No per-frame allocation: only
// a couple of material scalars, the spin transform, and the marker position.
// ============================================================================

const STEPS_PER_FLIGHT = 8
const FLIGHTS = 4
const STEP_COUNT = STEPS_PER_FLIGHT * FLIGHTS // 32 steps -> 2 instanced draw calls

const H = 2.0 // half side-length of the square centreline
const TREAD = (2 * H) / STEPS_PER_FLIGHT // tread depth (tiles each edge exactly)
const STAIR_W = 1.15 // step width (across the direction of travel)
const STEP_H = 0.6 // step body height (extends DOWN; overlaps -> solid mass)
const RISE = 0.2 // per-step climb
const TOTAL_RISE = STEP_COUNT * RISE // full loop height, used to centre vertically
const MARKER_LIFT = 0.18 // how far the climbing marker floats above a tread

// where the whole object hangs in the world (outside the clear central plaza)
const BEARING = 2.3 // radians around the origin
const RADIUS = 29
const ELEV = 19

export class PenroseStairs implements SceneFeature {
  readonly group: THREE.Group

  private readonly spin: THREE.Group // inner pivot: rotates about the loop centre

  private readonly bodyMat: THREE.MeshBasicMaterial
  private readonly bodyBase: THREE.Color
  private readonly frameMat: THREE.MeshBasicMaterial
  private readonly frameBaseOpacity = 0.55

  private readonly marker: THREE.Sprite
  private readonly markerMat: THREE.SpriteMaterial
  private readonly markerBaseOpacity = 0.9

  // climbing-marker path: top-of-tread centre for every step (loop order)
  private readonly mcx = new Float32Array(STEP_COUNT)
  private readonly mcy = new Float32Array(STEP_COUNT)
  private readonly mcz = new Float32Array(STEP_COUNT)

  private readonly disposables: Array<{ dispose(): void }> = []

  private anim = 0
  private markerPhase = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'PenroseStairs'
    this.group.position.set(Math.cos(BEARING) * RADIUS, ELEV, Math.sin(BEARING) * RADIUS)

    this.spin = new THREE.Group()
    this.group.add(this.spin)

    const white = new THREE.Color(1, 1, 1)

    // ----- shared geometry + textures ---------------------------------------
    const boxGeo = new THREE.BoxGeometry(1, 1, 1)
    const frameTex = this.makeFrameTexture()
    const dotTex = this.makeDotTexture()

    this.bodyBase = palette.voidColor.clone().lerp(palette.hologram, 0.2)
    this.bodyMat = new THREE.MeshBasicMaterial({ color: this.bodyBase.clone(), fog: true })
    this.frameMat = new THREE.MeshBasicMaterial({
      color: white.clone(),
      map: frameTex,
      transparent: true,
      opacity: this.frameBaseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    })

    const bodies = new THREE.InstancedMesh(boxGeo, this.bodyMat, STEP_COUNT)
    bodies.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    bodies.frustumCulled = false
    const frames = new THREE.InstancedMesh(boxGeo, this.frameMat, STEP_COUNT)
    frames.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    frames.frustumCulled = false

    // ----- lay the four flights around the square ---------------------------
    const mtx = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const scl = new THREE.Vector3()
    const frameScl = new THREE.Vector3()
    const tint = new THREE.Color()

    for (let i = 0; i < STEP_COUNT; i++) {
      const flight = Math.floor(i / STEPS_PER_FLIGHT)
      const within = i % STEPS_PER_FLIGHT
      const along = (within + 0.5) * TREAD // distance from this flight's start corner

      // top of step i, centred so the whole loop straddles local y = 0
      const topY = i * RISE - TOTAL_RISE / 2
      const centerY = topY - STEP_H / 2

      // walk the square perimeter CCW; yaw aligns the tread axis with travel
      let cx: number
      let cz: number
      let yaw: number
      switch (flight) {
        case 0: // edge -X..+X along +X
          cx = -H + along
          cz = -H
          yaw = 0
          break
        case 1: // edge -Z..+Z along +Z
          cx = H
          cz = -H + along
          yaw = -Math.PI / 2
          break
        case 2: // edge +X..-X along -X
          cx = H - along
          cz = H
          yaw = Math.PI
          break
        default: // flight 3: edge +Z..-Z along -Z
          cx = -H
          cz = H - along
          yaw = Math.PI / 2
          break
      }

      pos.set(cx, centerY, cz)
      euler.set(0, yaw, 0)
      quat.setFromEuler(euler)
      scl.set(TREAD, STEP_H, STAIR_W)
      mtx.compose(pos, quat, scl)
      bodies.setMatrixAt(i, mtx)

      // frame: identical transform grown a hair so its glowing edge rims the step
      frameScl.set(TREAD + 0.06, STEP_H + 0.06, STAIR_W + 0.06)
      mtx.compose(pos, quat, frameScl)
      frames.setMatrixAt(i, mtx)

      // edge tint climbs phosphor -> hologram around the loop, lifted toward white
      tint.copy(palette.phosphor).lerp(palette.hologram, i / (STEP_COUNT - 1)).lerp(white, 0.18)
      frames.setColorAt(i, tint)

      // remember the climbing-marker waypoint for this tread
      this.mcx[i] = cx
      this.mcy[i] = topY + MARKER_LIFT
      this.mcz[i] = cz
    }

    bodies.instanceMatrix.needsUpdate = true
    frames.instanceMatrix.needsUpdate = true
    if (frames.instanceColor) frames.instanceColor.needsUpdate = true

    this.spin.add(bodies)
    this.spin.add(frames)
    this.disposables.push(boxGeo, frameTex, this.bodyMat, this.frameMat, bodies, frames)

    // ----- the endlessly-climbing glow marker -------------------------------
    this.markerMat = new THREE.SpriteMaterial({
      map: dotTex,
      color: palette.phosphor.clone().lerp(white, 0.6),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    })
    this.marker = new THREE.Sprite(this.markerMat)
    this.marker.scale.set(0.55, 0.55, 1)
    this.marker.position.set(this.mcx[0], this.mcy[0], this.mcz[0])
    this.spin.add(this.marker)
    this.disposables.push(this.markerMat, dotTex)
  }

  // glowing edge frame: transparent centre, bright soft border, one per box face
  // so each small step box catches an additive wireframe-style rim glow.
  private makeFrameTexture(): THREE.CanvasTexture {
    const S = 64
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')

    ctx.clearRect(0, 0, S, S)
    const steps = 6
    for (let i = 0; i < steps; i++) {
      const a = (1 - i / steps) * 0.9
      const inset = 0.5 + i
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
      ctx.lineWidth = 1
      ctx.strokeRect(inset, inset, S - inset * 2, S - inset * 2)
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // soft round dot for the climbing marker sprite
  private makeDotTexture(): THREE.CanvasTexture {
    const s = 32
    const canvas = document.createElement('canvas')
    canvas.width = s
    canvas.height = s
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  update(ctx: FeatureContext): void {
    const motion = ctx.motion
    this.anim += ctx.dt * motion
    const a = this.anim

    // slowly turn the impossible loop + a gentle bob + faint impossible-tilt wobble
    this.spin.rotation.y = a * 0.16
    this.spin.rotation.z = Math.sin(a * 0.21) * 0.025
    this.group.position.y = ELEV + Math.sin(a * 0.4) * 0.5

    // audio gently lifts the edge glow + body brightness
    this.frameMat.opacity =
      this.frameBaseOpacity * (0.82 + 0.18 * Math.sin(a * 0.9) + ctx.audio * 0.6)
    this.bodyMat.color.copy(this.bodyBase).multiplyScalar(1 + ctx.audio * 0.3)

    // advance the climbing marker; one full loop every ~12s, scaled by motion
    this.markerPhase = (this.markerPhase + ctx.dt * motion * 0.085) % 1
    const u = this.markerPhase
    const fIdx = u * STEP_COUNT
    let k = Math.floor(fIdx)
    if (k >= STEP_COUNT) k = STEP_COUNT - 1
    const frac = fIdx - k

    if (k >= STEP_COUNT - 1) {
      // descending return segment: hide the reset entirely
      this.markerMat.opacity = 0
    } else {
      const k1 = k + 1
      this.marker.position.set(
        this.mcx[k] + (this.mcx[k1] - this.mcx[k]) * frac,
        this.mcy[k] + (this.mcy[k1] - this.mcy[k]) * frac,
        this.mcz[k] + (this.mcz[k1] - this.mcz[k]) * frac,
      )
      // fade in off the bottom, fade out approaching the seam at the top
      const fadeIn = Math.min(1, u / (0.6 / STEP_COUNT))
      const fadeOut = Math.min(1, (1 - u) / (1.6 / STEP_COUNT))
      const fade = Math.max(0, Math.min(fadeIn, fadeOut))
      this.markerMat.opacity = this.markerBaseOpacity * fade * (0.85 + ctx.audio * 0.5)
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.group.clear()
  }
}
