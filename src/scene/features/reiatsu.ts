import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// ReiatsuBursts — explosive SPIRITUAL-PRESSURE detonations of the unseen god-
// tier clash bleeding into the plaza. On a staggered, recurring timer, points
// around the world (radius ~20-90, mostly on the floor, some midair) ERUPT:
//
//   • a white-hot FLASH pops at the ignition core (billboarded soft sprite),
//   • one or two flat additive SHOCKWAVE RINGS race outward across the ground,
//   • an expanding spherical SHELL blasts out as the pressure wave,
//   • a tall vertical ENERGY PILLAR / beam shoots upward, flickers, and fades,
//   • a quick cluster of glowing EMBER / debris sprites is flung outward and
//     arcs back down under gravity.
//
// White-hot phosphor cores with WARNING-RED + tachibana-AMBER reiatsu accents
// (the red/orange of raw spiritual pressure). Everything is ADDITIVE +
// depthWrite:false so the bloom pass catches the energy; fog:false so distant
// bursts still punch dramatically through the twilight haze.
//
// POOLED + RECURRING — a small fixed pool of bursts is pre-built once (shared
// ring / shell / pillar / flash geometries; one global ember Points cloud).
// Each burst owns a contiguous slice of the ember buffer. A per-burst cooldown
// (staggered across the pool) fires the detonation; it animates over ~0.6-1.2s
// then recycles. Cadence + intensity rise with ctx.audio bass (the fight
// surging). No per-frame allocation; idle bursts are fully hidden.
// ============================================================================

const TAU = Math.PI * 2
const FLOOR = -10

const POOL = 5
const EMBERS_PER_BURST = 10
const EMBER_TOTAL = POOL * EMBERS_PER_BURST
const GRAVITY = 16 // world units / s^2 pulling embers back down

interface Burst {
  index: number
  active: boolean
  cooldown: number // seconds until next detonation while idle
  age: number
  life: number

  // detonation-randomised parameters
  ringMax: number
  shellMax: number
  pillarH: number
  pillarW: number
  ring1Delay: number
  hasSecondRing: boolean
  flickRate: number
  flickPhase: number
  bright: number

  // pooled meshes (shared geometry, own material)
  ring0: THREE.Mesh
  ring1: THREE.Mesh
  shell: THREE.Mesh
  pillar: THREE.Mesh
  flash: THREE.Mesh

  ringMat0: THREE.MeshBasicMaterial
  ringMat1: THREE.MeshBasicMaterial
  shellMat: THREE.MeshBasicMaterial
  pillarMat: THREE.MeshBasicMaterial
  flashMat: THREE.MeshBasicMaterial
}

// One soft round glow sprite — shared by the ignition flash and every ember.
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
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.3, 'rgba(255,236,210,0.85)')
  g.addColorStop(0.7, 'rgba(255,170,120,0.25)')
  g.addColorStop(1, 'rgba(255,140,90,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  tex.needsUpdate = true
  return tex
}

export class ReiatsuBursts implements SceneFeature {
  readonly group: THREE.Group

  // shared geometry
  private readonly ringGeo: THREE.RingGeometry
  private readonly shellGeo: THREE.SphereGeometry
  private readonly pillarGeo: THREE.CylinderGeometry
  private readonly flashGeo: THREE.PlaneGeometry
  private readonly emberGeo: THREE.BufferGeometry

  private readonly glowTex: THREE.CanvasTexture
  private readonly emberMat: THREE.PointsMaterial

  private readonly bursts: Burst[] = []

  // ember state — global cloud; each burst owns a fixed slice of these buffers
  private readonly epos: Float32Array
  private readonly ecol: Float32Array
  private readonly eposAttr: THREE.BufferAttribute
  private readonly ecolAttr: THREE.BufferAttribute
  private readonly evx = new Float32Array(EMBER_TOTAL)
  private readonly evy = new Float32Array(EMBER_TOTAL)
  private readonly evz = new Float32Array(EMBER_TOTAL)
  private readonly ebaseR = new Float32Array(EMBER_TOTAL)
  private readonly ebaseG = new Float32Array(EMBER_TOTAL)
  private readonly ebaseB = new Float32Array(EMBER_TOTAL)
  private emberDirty = false

  // palette-derived colours (reused, never reallocated)
  private readonly white = new THREE.Color(1, 1, 1)
  private readonly warn: THREE.Color
  private readonly amber: THREE.Color
  private readonly cyan: THREE.Color
  private readonly tmp = new THREE.Color()

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'ReiatsuBursts'

    this.warn = palette.warning.clone().lerp(this.white, 0.12)
    this.amber = palette.tachibana.clone().lerp(this.white, 0.12)
    this.cyan = palette.phosphor.clone().lerp(this.white, 0.2)

    // ---- shared geometry ---------------------------------------------------
    this.ringGeo = new THREE.RingGeometry(0.9, 1.0, 48)
    this.ringGeo.rotateX(-Math.PI / 2) // lay flat on the ground (normal +Y)

    this.shellGeo = new THREE.SphereGeometry(1, 16, 12)

    // unit-height beam, base translated to y=0 so scale.y grows it upward
    this.pillarGeo = new THREE.CylinderGeometry(0.5, 1.0, 1, 16, 1, true)
    this.pillarGeo.translate(0, 0.5, 0)

    this.flashGeo = new THREE.PlaneGeometry(1, 1)

    this.glowTex = makeGlowTexture()

    // ---- per-burst meshes --------------------------------------------------
    for (let i = 0; i < POOL; i++) {
      const ringMat0 = this.makeMat()
      const ringMat1 = this.makeMat()
      const shellMat = this.makeMat()
      const pillarMat = this.makeMat()
      const flashMat = this.makeMat(this.glowTex)

      const ring0 = new THREE.Mesh(this.ringGeo, ringMat0)
      const ring1 = new THREE.Mesh(this.ringGeo, ringMat1)
      const shell = new THREE.Mesh(this.shellGeo, shellMat)
      const pillar = new THREE.Mesh(this.pillarGeo, pillarMat)
      const flash = new THREE.Mesh(this.flashGeo, flashMat)

      for (const m of [ring0, ring1, shell, pillar, flash]) {
        m.visible = false
        m.renderOrder = 4
        m.frustumCulled = false // scale grows far past the static bound
        this.group.add(m)
      }

      this.bursts.push({
        index: i,
        active: false,
        cooldown: 0.4 + i * 0.55 + Math.random() * 0.5, // staggered first fire
        age: 0,
        life: 1,
        ringMax: 12,
        shellMax: 8,
        pillarH: 24,
        pillarW: 1,
        ring1Delay: 0.18,
        hasSecondRing: true,
        flickRate: 28,
        flickPhase: 0,
        bright: 1,
        ring0,
        ring1,
        shell,
        pillar,
        flash,
        ringMat0,
        ringMat1,
        shellMat,
        pillarMat,
        flashMat,
      })
    }

    // ---- global ember cloud ------------------------------------------------
    this.epos = new Float32Array(EMBER_TOTAL * 3)
    this.ecol = new Float32Array(EMBER_TOTAL * 3) // all 0 -> invisible additive
    this.eposAttr = new THREE.BufferAttribute(this.epos, 3)
    this.ecolAttr = new THREE.BufferAttribute(this.ecol, 3)
    this.eposAttr.setUsage(THREE.DynamicDrawUsage)
    this.ecolAttr.setUsage(THREE.DynamicDrawUsage)
    this.emberGeo = new THREE.BufferGeometry()
    this.emberGeo.setAttribute('position', this.eposAttr)
    this.emberGeo.setAttribute('color', this.ecolAttr)

    this.emberMat = new THREE.PointsMaterial({
      map: this.glowTex,
      size: 2.4,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    const emberPoints = new THREE.Points(this.emberGeo, this.emberMat)
    emberPoints.frustumCulled = false
    emberPoints.renderOrder = 4
    this.group.add(emberPoints)
  }

  private makeMat(map?: THREE.Texture): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      color: this.white.clone(),
      ...(map ? { map } : {}),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    })
  }

  private detonate(b: Burst, audio: number): void {
    const aBoost = 1 + audio * 0.7

    b.life = 0.7 + Math.random() * 0.5
    b.ringMax = (9 + Math.random() * 16) * (1 + audio * 0.3)
    b.shellMax = (5 + Math.random() * 8) * (1 + audio * 0.3)
    b.pillarH = (16 + Math.random() * 26) * aBoost
    b.pillarW = 0.7 + Math.random() * 1.3
    b.ring1Delay = 0.12 + Math.random() * 0.14
    b.hasSecondRing = Math.random() < 0.6
    b.flickRate = 22 + Math.random() * 18
    b.flickPhase = Math.random() * TAU
    b.bright = (0.85 + Math.random() * 0.5) * aBoost

    // placement: ring the plaza, clear of the immediate centre
    const ang = Math.random() * TAU
    const rad = 20 + Math.random() * 70
    const x = Math.cos(ang) * rad
    const z = Math.sin(ang) * rad
    const y = Math.random() < 0.3 ? FLOOR + 6 + Math.random() * 32 : FLOOR

    // reiatsu accent: mostly red, then amber, occasionally phosphor
    const pick = Math.random()
    const accent = pick < 0.45 ? this.warn : pick < 0.8 ? this.amber : this.cyan

    this.tmp.copy(accent).lerp(this.white, 0.25)
    b.ringMat0.color.copy(this.tmp)
    b.ringMat1.color.copy(this.tmp)
    b.shellMat.color.copy(this.cyan).lerp(this.white, 0.55) // phosphor-white pressure wave
    b.pillarMat.color.copy(this.white).lerp(accent, 0.45) // white-hot core, accent tint
    b.flashMat.color.copy(this.white)

    b.ring0.position.set(x, y + 0.05, z)
    b.ring1.position.set(x, y + 0.05, z)
    b.shell.position.set(x, y, z)
    b.pillar.position.set(x, y, z)
    b.flash.position.set(x, y + 1.2, z)

    b.ring0.visible = true
    b.ring1.visible = b.hasSecondRing
    b.shell.visible = true
    b.pillar.visible = true
    b.flash.visible = true

    // fling the ember cluster
    this.tmp.copy(accent).lerp(this.white, 0.4)
    const er = this.tmp.r
    const eg = this.tmp.g
    const eb = this.tmp.b
    const base = b.index * EMBERS_PER_BURST
    for (let k = 0; k < EMBERS_PER_BURST; k++) {
      const i = base + k
      const ea = Math.random() * TAU
      const es = (5 + Math.random() * 9) * aBoost
      this.evx[i] = Math.cos(ea) * es
      this.evz[i] = Math.sin(ea) * es
      this.evy[i] = (5 + Math.random() * 11) * aBoost
      const p3 = i * 3
      this.epos[p3] = x
      this.epos[p3 + 1] = y + 0.5
      this.epos[p3 + 2] = z
      this.ebaseR[i] = er
      this.ebaseG[i] = eg
      this.ebaseB[i] = eb
      this.ecol[p3] = er
      this.ecol[p3 + 1] = eg
      this.ecol[p3 + 2] = eb
    }
    this.emberDirty = true

    b.active = true
    b.age = 0
  }

  private deactivate(b: Burst): void {
    b.active = false
    b.cooldown = 1.8 + Math.random() * 2.4
    b.ring0.visible = false
    b.ring1.visible = false
    b.shell.visible = false
    b.pillar.visible = false
    b.flash.visible = false
    const base = b.index * EMBERS_PER_BURST
    for (let k = 0; k < EMBERS_PER_BURST; k++) {
      const p3 = (base + k) * 3
      this.ecol[p3] = 0
      this.ecol[p3 + 1] = 0
      this.ecol[p3 + 2] = 0
    }
    this.emberDirty = true
  }

  update(ctx: FeatureContext): void {
    const dtm = ctx.dt * ctx.motion
    const audio = ctx.audio
    const gain = 1 + audio * 0.6
    const camPos = ctx.camera.position

    for (const b of this.bursts) {
      if (!b.active) {
        b.cooldown -= dtm * (1 + audio * 1.6) // bass quickens the cadence
        if (b.cooldown <= 0) this.detonate(b, audio)
        if (!b.active) continue
      }

      b.age += dtm
      if (b.age >= b.life) {
        this.deactivate(b)
        continue
      }

      const f = b.age / b.life

      // primary ground shockwave ring
      const e0 = 1 - (1 - f) * (1 - f)
      const r0 = 0.5 + (b.ringMax - 0.5) * e0
      b.ring0.scale.set(r0, 1, r0)
      b.ringMat0.opacity = Math.min(1, b.bright * (1 - f) * gain)

      // delayed secondary ring
      if (b.hasSecondRing) {
        const a1 = b.age - b.ring1Delay
        if (a1 > 0) {
          const f1 = Math.min(a1 / (b.life * 0.9), 1)
          const e1 = 1 - (1 - f1) * (1 - f1)
          const r1 = 0.5 + (b.ringMax * 0.72 - 0.5) * e1
          b.ring1.scale.set(r1, 1, r1)
          b.ringMat1.opacity = Math.min(1, b.bright * 0.7 * (1 - f1) * gain)
        } else {
          b.ringMat1.opacity = 0
        }
      }

      // expanding spherical pressure shell — fast out, fades by ~f 0.66
      const sf = Math.min(f * 1.5, 1)
      const es = 1 - (1 - sf) * (1 - sf)
      b.shell.scale.setScalar(0.5 + b.shellMax * es)
      b.shellMat.opacity = Math.min(1, b.bright * 0.7 * (1 - sf) * (1 - sf) * gain)

      // vertical energy pillar — shoots up, flickers, fades from f 0.4
      const rf = Math.min(b.age / 0.22, 1)
      const re = 1 - (1 - rf) * (1 - rf) * (1 - rf)
      const ph = b.pillarH * re
      let pEnv = f < 0.4 ? 1 : 1 - (f - 0.4) / 0.6
      if (pEnv < 0) pEnv = 0
      const flick = 0.6 + 0.4 * Math.sin(b.age * b.flickRate + b.flickPhase)
      const pw = b.pillarW * (0.55 + 0.45 * pEnv)
      b.pillar.scale.set(pw, Math.max(0.001, ph), pw)
      b.pillarMat.opacity = Math.min(1.1, b.bright * 0.85 * pEnv * flick * gain)

      // ignition flash — a sharp white pop in the first sliver of the life
      const ff = b.age / (b.life * 0.16)
      if (ff < 1) {
        const fs = 3 + ff * 9
        b.flash.scale.set(fs, fs, fs)
        b.flash.lookAt(camPos)
        b.flashMat.opacity = Math.min(1.2, b.bright * (1 - ff) * gain)
      } else if (b.flash.visible) {
        b.flash.visible = false
      }

      // embers: integrate ballistic fling + fall, fade with the burst
      const fade = (1 - f) * (1 - f)
      const base = b.index * EMBERS_PER_BURST
      for (let k = 0; k < EMBERS_PER_BURST; k++) {
        const i = base + k
        this.evy[i] -= GRAVITY * dtm
        const p3 = i * 3
        this.epos[p3] += this.evx[i] * dtm
        this.epos[p3 + 1] += this.evy[i] * dtm
        this.epos[p3 + 2] += this.evz[i] * dtm
        this.ecol[p3] = this.ebaseR[i] * fade
        this.ecol[p3 + 1] = this.ebaseG[i] * fade
        this.ecol[p3 + 2] = this.ebaseB[i] * fade
      }
      this.emberDirty = true
    }

    if (this.emberDirty) {
      this.eposAttr.needsUpdate = true
      this.ecolAttr.needsUpdate = true
      this.emberDirty = false
    }
  }

  dispose(): void {
    this.ringGeo.dispose()
    this.shellGeo.dispose()
    this.pillarGeo.dispose()
    this.flashGeo.dispose()
    this.emberGeo.dispose()
    this.emberMat.dispose()
    this.glowTex.dispose()
    for (const b of this.bursts) {
      b.ringMat0.dispose()
      b.ringMat1.dispose()
      b.shellMat.dispose()
      b.pillarMat.dispose()
      b.flashMat.dispose()
    }
    this.bursts.length = 0
    this.group.clear()
  }
}
