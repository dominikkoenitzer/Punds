import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// GiantEye — a colossal HOLOGRAPHIC eye hanging in the void at the zenith,
// drawn in the same additive phosphor-cyan line-art as the rest of the Wired
// (glowing almond, ring-iris, a dark void pupil with a bright rim) — a ghostly
// presence, not a literal eyeball. It billboards to face you (always staring),
// blinks on a slow timer, and ties into the idle dread: hold still and it
// brightens, swells, and descends, looming closer. Generic eye, copyright-safe.

const TAU = Math.PI * 2
const R = 24
const BASE_Y = 96

function drawEyeTexture(p: ScenePalette): THREE.CanvasTexture {
  const S = 2048
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.translate(S / 2, S / 2)
  ctx.lineCap = 'round'

  const W = S * 0.46 // almond half-width
  const H = S * 0.2 // almond half-height (lids bulge to H*1.7)
  const eyePath = () => {
    ctx.beginPath()
    ctx.moveTo(-W, 0)
    ctx.quadraticCurveTo(0, -H * 1.7, W, 0)
    ctx.quadraticCurveTo(0, H * 1.7, -W, 0)
    ctx.closePath()
  }

  // faint membrane fill inside the almond
  eyePath()
  ctx.fillStyle = 'rgba(80,180,255,0.05)'
  ctx.fill()

  // iris (clipped to the eye opening so the lids cut it off)
  const ir = H * 1.55
  const pr = ir * 0.3 // pupil radius (transparent void)
  ctx.save()
  eyePath()
  ctx.clip()

  const g = ctx.createRadialGradient(0, 0, pr * 0.6, 0, 0, ir)
  g.addColorStop(0, 'rgba(10,40,70,0)')
  g.addColorStop(0.28, 'rgba(10,40,70,0)')
  g.addColorStop(0.34, 'rgba(190,240,255,0.85)') // bright pupil rim
  g.addColorStop(0.55, p.hologramStr)
  g.addColorStop(0.85, 'rgba(80,170,240,0.25)')
  g.addColorStop(1, 'rgba(80,170,240,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, ir, 0, TAU); ctx.fill()

  // radial fibres
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 240; i++) {
    const a = (i / 240) * TAU + (Math.random() - 0.5) * 0.04
    const r0 = pr * 1.15 + Math.random() * S * 0.01
    const r1 = ir * (0.7 + Math.random() * 0.26)
    const b = Math.random()
    ctx.strokeStyle = b > 0.94 ? 'rgba(231,169,60,0.4)' : `rgba(150,225,255,${0.04 + b * 0.16})`
    ctx.lineWidth = 1.5 + Math.random() * 2.5
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'

  // limbal ring
  ctx.strokeStyle = 'rgba(150,225,255,0.35)'
  ctx.lineWidth = S * 0.01
  ctx.beginPath(); ctx.arc(0, 0, ir * 0.96, 0, TAU); ctx.stroke()
  ctx.restore()

  // glowing almond outline over the top
  ctx.strokeStyle = p.phosphorStr
  ctx.shadowColor = p.phosphorStr
  ctx.shadowBlur = 40
  ctx.lineWidth = S * 0.014
  eyePath()
  ctx.stroke()
  // inner corner ticks
  ctx.lineWidth = S * 0.009
  ctx.beginPath(); ctx.moveTo(-W, 0); ctx.lineTo(-W - S * 0.03, 0); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(W + S * 0.03, 0); ctx.stroke()

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
    g.addColorStop(0, 'rgba(120,210,255,0.35)')
    g.addColorStop(0.5, 'rgba(80,160,230,0.12)')
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
  private blinkCooldown = 6
  private blinking = false
  private blinkT = 0

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
      opacity: 0.4,
    })
    this.glow = new THREE.Sprite(this.glowMat)
    this.glow.scale.setScalar(R * 3.4)
    this.group.add(this.glow)

    this.eyeTex = drawEyeTexture(palette)
    this.eyeGeo = new THREE.PlaneGeometry(R * 2.4, R * 2.4)
    this.eyeMat = new THREE.MeshBasicMaterial({
      map: this.eyeTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.55,
      side: THREE.DoubleSide,
    })
    this.eye = new THREE.Mesh(this.eyeGeo, this.eyeMat)
    this.group.add(this.eye)
  }

  update(ctx: FeatureContext): void {
    const { dt, motion, dread, camera } = ctx
    this.anim += dt * motion

    // dread: descend / loom, brighten, swell
    this.group.position.y = BASE_Y - dread * 16
    this.eyeMat.opacity = 0.5 + dread * 0.4 + Math.sin(this.anim * 0.4) * 0.04
    this.glowMat.opacity = 0.35 + dread * 0.4
    const swell = 1 + dread * 0.12

    // billboard toward the camera (always staring)
    this.eye.lookAt(camera.position)
    this.glow.lookAt(camera.position)

    // slow blink (almond squashes to a glowing line)
    let openness = 1
    this.blinkCooldown -= dt * motion
    if (this.blinkCooldown <= 0 && !this.blinking) {
      this.blinking = true
      this.blinkT = 0
    }
    if (this.blinking) {
      this.blinkT += (dt * motion) / 0.26
      openness = 1 - Math.sin(Math.min(this.blinkT, 1) * Math.PI)
      if (this.blinkT >= 1) {
        this.blinking = false
        this.blinkCooldown = 5 + Math.random() * 7 + dread * 6
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
