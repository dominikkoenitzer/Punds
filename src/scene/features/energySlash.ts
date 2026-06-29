import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// EnergySlashes — the sword-energy-wave BEAT of the battle bleeding into the
// sky. A small POOL of giant crescent ENERGY SLASHES (Getsuga-style waves) that
// ignite on a recurring, staggered timer at random sky positions around/above
// the plaza, STREAK across along their length, stretch-smear into a brief
// afterglow trail and rapidly dissipate — leaving the sense of an unseen titan
// carving the heavens just over the horizon.
//
// Each slash is a single camera-BILLBOARDED plane textured with a pre-rendered
// CanvasTexture crescent: a bright filled arc tapering to sharp points, white-
// hot core fading to a fierce coloured edge. Three shared textures give colour
// variety — phosphor cyan (dominant) plus tachibana amber and warning-red/orange
// reiatsu accents. A second tiny pool of radial FLASH blobs pops at each ignition
// point for the bright muzzle-flare of power.
//
// Everything is additive / depthWrite:false / toneMapped:false / fog:false so the
// bloom pass catches the white-hot cores and the energy reads as a sky event that
// ignores depth. The plane geometry, crescent textures and flash texture are all
// SHARED; only thin per-slot materials carry opacity. Pooled, recycled on an
// internal timer, NO per-frame allocation; hidden (visible=false) between bursts.
//
// update(): tick the spawn timer (frequency + brightness lift with ctx.audio,
// rate × ctx.motion), advance every active slash (streak + stretch + fade +
// re-billboard), and pop/expire its flash.
// ============================================================================

const TAU = Math.PI * 2

const POOL = 6 // giant crescent waves alive at once (transient — few overlap)

// recurring ignition cadence (seconds) — staggered, shortened by loud audio
const SPAWN_MIN = 2.5
const SPAWN_VAR = 2.5

// per-slash lifetimes (seconds)
const LIFE_MIN = 0.42
const LIFE_VAR = 0.4
const FLASH_LIFE = 0.16

// sky placement around the plaza (kept well outside the central plaza radius)
const RADIUS_MIN = 30
const RADIUS_VAR = 60 // -> 30..90
const Y_MIN = 8
const Y_VAR = 64 // -> 8..72, biased high so some carve overhead

// crescent length (world units) and streak speed
const LEN_MIN = 30
const LEN_VAR = 50 // -> 30..80
const SPEED_MIN = 28
const SPEED_VAR = 42 // -> 28..70

const CANVAS_W = 512
const CANVAS_H = 256

const rand = (min: number, span: number): number => min + Math.random() * span

// a THREE.Color's channels reused directly as sRGB bytes (matches the existing
// DataRain / cloud canvas convention so the palette reads consistently)
function rgba(c: THREE.Color, a: number): string {
  const r = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255)
  const g = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255)
  const b = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255)
  return `rgba(${r},${g},${b},${a})`
}

// trace a crescent (lune): two upward-bulging quadratic arcs sharing sharp tips
function crescentPath(
  ctx: CanvasRenderingContext2D,
  left: number,
  right: number,
  cy: number,
  outer: number,
  inner: number,
): void {
  const mid = (left + right) * 0.5
  ctx.beginPath()
  ctx.moveTo(left, cy)
  ctx.quadraticCurveTo(mid, cy - outer, right, cy) // outer edge
  ctx.quadraticCurveTo(mid, cy - inner, left, cy) // inner edge back to the tip
  ctx.closePath()
}

// one shared crescent texture: soft coloured glow halo + white-hot core blade
function makeCrescentTexture(edge: THREE.Color): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace

  const ctx = canvas.getContext('2d')
  if (!ctx) return tex // stays transparent without a 2d context

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.globalCompositeOperation = 'lighter'

  const left = CANVAS_W * 0.06
  const right = CANVAS_W * 0.94
  const cy = CANVAS_H * 0.66 // chord line near the lower third; crescent bulges up

  // --- glow halo: a thick crescent, blurred, coloured ---
  ctx.save()
  ctx.shadowColor = rgba(edge, 0.85)
  ctx.shadowBlur = 40
  ctx.fillStyle = rgba(edge, 0.45)
  crescentPath(ctx, left, right, cy, CANVAS_H * 0.5, CANVAS_H * 0.1)
  ctx.fill()
  ctx.restore()

  // --- core blade: thinner crescent, coloured edge -> white-hot centre -> edge ---
  const coreOuter = CANVAS_H * 0.44
  const coreInner = CANVAS_H * 0.2
  const grad = ctx.createLinearGradient(0, cy - coreOuter, 0, cy - coreInner)
  grad.addColorStop(0, rgba(edge, 0.95))
  grad.addColorStop(0.42, 'rgba(255,255,255,1)')
  grad.addColorStop(0.58, 'rgba(255,255,255,1)')
  grad.addColorStop(1, rgba(edge, 0.95))
  ctx.fillStyle = grad
  crescentPath(ctx, left, right, cy, coreOuter, coreInner)
  ctx.fill()

  tex.needsUpdate = true
  return tex
}

// shared radial flash blob (white-hot ignition flare)
function makeFlashTexture(): THREE.CanvasTexture {
  const S = 128
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace

  const ctx = canvas.getContext('2d')
  if (!ctx) return tex

  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(235,250,255,0.85)')
  g.addColorStop(0.6, 'rgba(170,235,255,0.35)')
  g.addColorStop(1, 'rgba(120,210,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2, 0, TAU)
  ctx.fill()

  tex.needsUpdate = true
  return tex
}

interface Slash {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  flash: THREE.Mesh
  flashMat: THREE.MeshBasicMaterial
  active: boolean
  age: number
  life: number
  pos: THREE.Vector3 // current crescent centre (streaks each frame)
  travel: THREE.Vector3 // unit streak direction
  speed: number
  roll: number // in-plane diagonal tilt
  len: number // base crescent length (world units)
  thick: number // base crescent height (world units)
  flicker: number // fierce-edge flicker phase
  bright: number // per-slash brightness scatter
}

export class EnergySlashes implements SceneFeature {
  readonly group: THREE.Group

  private readonly geo: THREE.PlaneGeometry
  private readonly crescentTex: THREE.CanvasTexture[]
  private readonly flashTex: THREE.CanvasTexture
  private readonly slashes: Slash[] = []
  private spawnTimer = 1.0 // first slash carves soon after load
  private t = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'EnergySlashes'

    this.geo = new THREE.PlaneGeometry(1, 1) // unit plane; per-slash scale

    // colour variants: phosphor cyan dominant, with amber + red/orange reiatsu
    const cyan = palette.phosphor.clone().lerp(palette.hologram, 0.25)
    const amber = palette.tachibana.clone()
    const redOrange = palette.warning.clone().lerp(palette.tachibana, 0.3)
    this.crescentTex = [
      makeCrescentTexture(cyan),
      makeCrescentTexture(amber),
      makeCrescentTexture(redOrange),
    ]
    this.flashTex = makeFlashTexture()

    // fixed per-slot colour so a random-slot spawn yields ongoing variety
    const slotTex = [0, 0, 1, 0, 2, 0] // 4 cyan, 1 amber, 1 red

    for (let i = 0; i < POOL; i++) {
      const tex = this.crescentTex[slotTex[i] ?? 0]

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false, // a sky event — energy reads over everything
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(this.geo, mat)
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 6
      this.group.add(mesh)

      const flashMat = new THREE.MeshBasicMaterial({
        map: this.flashTex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      })
      const flash = new THREE.Mesh(this.geo, flashMat)
      flash.visible = false
      flash.frustumCulled = false
      flash.renderOrder = 7
      this.group.add(flash)

      this.slashes.push({
        mesh,
        mat,
        flash,
        flashMat,
        active: false,
        age: 0,
        life: 1,
        pos: new THREE.Vector3(),
        travel: new THREE.Vector3(0, 0, -1),
        speed: 0,
        roll: 0,
        len: 0,
        thick: 0,
        flicker: Math.random() * TAU,
        bright: 1,
      })
    }
  }

  private ignite(): void {
    // pick a random inactive slot (random => colour variety over time)
    let count = 0
    for (const s of this.slashes) if (!s.active) count++
    if (count === 0) return
    let pick = (Math.random() * count) | 0
    let chosen: Slash | null = null
    for (const s of this.slashes) {
      if (s.active) continue
      if (pick === 0) {
        chosen = s
        break
      }
      pick--
    }
    if (!chosen) return
    const s = chosen

    // sky position: outside the plaza, varied azimuth, biased-high altitude
    const ang = Math.random() * TAU
    const radius = rand(RADIUS_MIN, RADIUS_VAR)
    const y = Y_MIN + Math.random() * Math.random() * Y_VAR + Math.random() * 12
    s.pos.set(Math.cos(ang) * radius, y, Math.sin(ang) * radius)

    // streak direction: mostly horizontal/diagonal, slight vertical component
    const tAng = Math.random() * TAU
    s.travel.set(Math.cos(tAng), (Math.random() * 2 - 1) * 0.35, Math.sin(tAng)).normalize()
    s.speed = rand(SPEED_MIN, SPEED_VAR)

    // dramatic diagonal in-plane tilt (biased away from flat horizontal)
    s.roll = (0.28 + Math.random() * 0.85) * (Math.random() < 0.5 ? 1 : -1)

    s.len = rand(LEN_MIN, LEN_VAR)
    s.thick = s.len * (0.18 + Math.random() * 0.14)
    s.life = LIFE_MIN + Math.random() * LIFE_VAR
    s.age = 0
    s.bright = 0.85 + Math.random() * 0.4
    s.active = true

    s.mesh.position.copy(s.pos)
    s.mesh.visible = true

    s.flash.position.copy(s.pos) // flash stays at the ignition point as the wave flies
    s.flash.visible = true
    s.flashMat.opacity = 1
  }

  update(ctx: FeatureContext): void {
    const m = ctx.motion
    const dt = ctx.dt * m
    this.t += dt
    const audio = ctx.audio
    const cam = ctx.camera.position
    const audioGain = 1 + audio * 0.6

    // ----- recurring, audio-driven ignition cadence -----
    this.spawnTimer -= dt
    if (this.spawnTimer <= 0) {
      this.ignite()
      // louder battle => the storm of slashes comes faster
      this.spawnTimer = (SPAWN_MIN + Math.random() * SPAWN_VAR) / (1 + audio * 1.8)
      // intense moments fire an overlapping second wave
      if (audio > 0.55 && Math.random() < audio * 0.6) this.ignite()
    }

    // ----- advance active slashes -----
    for (const s of this.slashes) {
      if (!s.active) continue

      s.age += dt
      const f = s.age / s.life
      if (f >= 1) {
        s.active = false
        s.mesh.visible = false
        s.flash.visible = false
        s.mat.opacity = 0
        s.flashMat.opacity = 0
        continue
      }

      // streak across along the wave's travel direction
      s.pos.addScaledVector(s.travel, s.speed * dt)
      s.mesh.position.copy(s.pos)

      // stretch-smear into an afterglow trail while it dissipates
      const stretch = 0.78 + f * 1.25
      const sx = s.len * stretch
      const sy = s.thick * (1 - 0.28 * f)
      s.mesh.scale.set(sx, sy, 1)

      // fast bright ignite, then fade; fierce edge flicker
      const up = 0.12
      let op = f < up ? f / up : 1 - (f - up) / (1 - up)
      op *= op // ease
      const flick = 0.8 + 0.2 * Math.sin(this.t * 42 + s.flicker)
      s.mat.opacity = Math.min(1.2, op * s.bright * flick * audioGain)

      // billboard toward the camera, then roll for the dramatic diagonal
      s.mesh.lookAt(cam)
      s.mesh.rotateZ(s.roll)

      // ignition flash: quick expanding white-hot flare at the spawn point
      const ff = s.age / FLASH_LIFE
      if (ff < 1) {
        const fsize = s.len * (0.35 + ff * 0.9)
        s.flash.scale.set(fsize, fsize, 1)
        s.flashMat.opacity = (1 - ff) * (0.9 + audio * 0.4)
        s.flash.lookAt(cam)
      } else if (s.flash.visible) {
        s.flash.visible = false
        s.flashMat.opacity = 0
      }
    }
  }

  dispose(): void {
    for (const s of this.slashes) {
      s.mat.dispose()
      s.flashMat.dispose()
    }
    this.slashes.length = 0
    for (const tex of this.crescentTex) tex.dispose()
    this.crescentTex.length = 0
    this.flashTex.dispose()
    this.geo.dispose()
    this.group.clear()
  }
}
