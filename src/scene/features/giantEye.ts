import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// GiantEye — a colossal HOLOGRAPHIC eye in the void at the zenith. Drawn soft
// and faint in additive phosphor-cyan (no crisp lines), it reads as a wavering
// Wired projection, not a pasted image: it billboards to face you, breathes,
// flickers, and drifts, and ties into the idle dread — hold still and it
// brightens, swells, and sinks lower, looming. Generic eye, copyright-safe.

const TAU = Math.PI * 2
const R = 24
const BASE_Y = 88

function drawEyeTexture(p: ScenePalette): THREE.CanvasTexture {
  const S = 2048
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.translate(S / 2, S / 2)
  ctx.lineCap = 'round'

  const W = S * 0.45 // almond half-width
  const H = S * 0.2 // almond half-height (lids bulge to H*1.7)
  const eyePath = () => {
    ctx.beginPath()
    ctx.moveTo(-W, 0)
    ctx.quadraticCurveTo(0, -H * 1.7, W, 0)
    ctx.quadraticCurveTo(0, H * 1.7, -W, 0)
    ctx.closePath()
  }

  // soft overall presence behind everything
  const base = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 1.9)
  base.addColorStop(0, 'rgba(90,180,250,0.10)')
  base.addColorStop(1, 'rgba(90,180,250,0)')
  ctx.fillStyle = base
  ctx.beginPath(); ctx.arc(0, 0, H * 1.9, 0, TAU); ctx.fill()

  // iris, clipped to the eye opening (soft, no hard rings)
  const ir = H * 1.55
  const pr = ir * 0.32 // pupil void
  ctx.save()
  eyePath()
  ctx.clip()

  const g = ctx.createRadialGradient(0, 0, pr * 0.6, 0, 0, ir)
  g.addColorStop(0, 'rgba(8,30,55,0)')
  g.addColorStop(0.3, 'rgba(8,30,55,0)')
  g.addColorStop(0.37, 'rgba(170,225,255,0.42)') // soft pupil rim
  g.addColorStop(0.58, 'rgba(80,170,240,0.3)')
  g.addColorStop(0.9, 'rgba(80,170,240,0.06)')
  g.addColorStop(1, 'rgba(80,170,240,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, ir, 0, TAU); ctx.fill()

  // faint fibres
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 150; i++) {
    const a = (i / 150) * TAU + (Math.random() - 0.5) * 0.05
    const r0 = pr * 1.2 + Math.random() * S * 0.01
    const r1 = ir * (0.65 + Math.random() * 0.28)
    const b = Math.random()
    ctx.strokeStyle = `rgba(150,225,255,${0.02 + b * 0.08})`
    ctx.lineWidth = 1.5 + Math.random() * 2
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.restore()

  // soft, blurred almond edge — a glow, not a line
  ctx.strokeStyle = `${p.phosphorStr}`
  ctx.shadowColor = p.phosphorStr
  ctx.shadowBlur = 70
  ctx.globalAlpha = 0.3
  ctx.lineWidth = S * 0.008
  eyePath()
  ctx.stroke()
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawGlowTexture(): THREE.CanvasTexture {
  const S = 256
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
    g.addColorStop(0, 'rgba(120,210,255,0.22)')
    g.addColorStop(0.5, 'rgba(80,160,230,0.08)')
    g.addColorStop(1, 'rgba(80,160,230,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, S, S)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class GiantEye implements SceneFeature {
  readonly group: THREE.Group

  private readonly eye: THREE.Mesh
  private readonly eyeGeo: THREE.PlaneGeometry
  private readonly eyeMat: THREE.MeshBasicMaterial
  private readonly eyeTex: THREE.CanvasTexture
  private readonly glow: THREE.Sprite
  private readonly glowMat: THREE.SpriteMaterial
  private readonly glowTex: THREE.CanvasTexture

  private anim = 0
  private blinkCooldown = 7
  private blinking = false
  private blinkT = 0
  private readonly sacCur = new THREE.Vector3()
  private readonly sacTarget = new THREE.Vector3()
  private readonly lookTmp = new THREE.Vector3()
  private sacTimer = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.position.set(0, BASE_Y, 0) // directly overhead, centered at the zenith

    this.glowTex = drawGlowTexture()
    this.glowMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.25,
    })
    this.glow = new THREE.Sprite(this.glowMat)
    this.glow.scale.setScalar(R * 3.6)
    this.group.add(this.glow)

    this.eyeTex = drawEyeTexture(palette)
    this.eyeGeo = new THREE.PlaneGeometry(R * 2.4, R * 2.4)
    this.eyeMat = new THREE.MeshBasicMaterial({
      map: this.eyeTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.34,
      side: THREE.DoubleSide,
    })
    this.eye = new THREE.Mesh(this.eyeGeo, this.eyeMat)
    this.group.add(this.eye)
  }

  update(ctx: FeatureContext): void {
    const { dt, motion, dread, camera } = ctx
    this.anim += dt * motion
    const a = this.anim

    // a wavering, drifting projection — never perfectly still
    this.group.position.set(Math.sin(a * 0.13) * 1.6, BASE_Y - dread * 14, Math.cos(a * 0.1) * 1.6)

    // holographic flicker + breathe; brighter with dread
    const flicker = 0.85 + Math.sin(a * 6.3) * 0.06 + Math.sin(a * 1.1) * 0.05 + (Math.random() < 0.03 ? -0.4 : 0)
    const baseOp = 0.3 + dread * 0.35
    this.eyeMat.opacity = Math.max(0, baseOp * flicker)
    this.glowMat.opacity = (0.2 + dread * 0.3) * (0.9 + Math.sin(a * 0.7) * 0.1)
    const swell = 1 + dread * 0.12 + Math.sin(a * 0.4) * 0.02

    // gaze: flick to look in a new direction every couple seconds, then hold
    // (sometimes snapping back to stare straight at you)
    this.sacTimer -= dt * motion
    if (this.sacTimer <= 0) {
      this.sacTimer = 1.4 + Math.random() * 2.6
      if (Math.random() < 0.4) this.sacTarget.set(0, 0, 0)
      else this.sacTarget.set((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 10)
    }
    this.sacCur.lerp(this.sacTarget, 0.22) // snappy flick, then settle
    this.lookTmp.copy(camera.position).add(this.sacCur)
    this.eye.lookAt(this.lookTmp)

    // slow blink (almond squashes to a glowing line)
    let openness = 1
    this.blinkCooldown -= dt * motion
    if (this.blinkCooldown <= 0 && !this.blinking) {
      this.blinking = true
      this.blinkT = 0
    }
    if (this.blinking) {
      this.blinkT += (dt * motion) / 0.28
      openness = 1 - Math.sin(Math.min(this.blinkT, 1) * Math.PI)
      if (this.blinkT >= 1) {
        this.blinking = false
        this.blinkCooldown = 6 + Math.random() * 8 + dread * 6
      }
    }
    this.eye.scale.set(swell, swell * Math.max(0.04, openness), 1)
  }

  dispose(): void {
    this.eyeGeo.dispose()
    this.eyeMat.dispose()
    this.eyeTex.dispose()
    this.glowMat.dispose()
    this.glowTex.dispose()
  }
}
