import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// GiantEye — a colossal HOLOGRAPHIC eye in the void at the zenith. Built in
// layers so it actually moves: a soft almond frame, an iris that slowly spins,
// darts in saccades and pulses, and a scanline that sweeps across it — a living
// Wired projection, not a pasted image. The whole thing billboards to face you,
// blinks, flickers, breathes and drifts, and looms lower with idle dread.
// Generic eye, copyright-safe.

const TAU = Math.PI * 2
const R = 24
const BASE_Y = 88

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

function drawFrameTexture(p: ScenePalette): THREE.CanvasTexture {
  const S = 1024
  const { canvas, ctx } = makeCanvas(S, S)
  ctx.translate(S / 2, S / 2)
  const W = S * 0.45
  const H = S * 0.2
  const eyePath = () => {
    ctx.beginPath()
    ctx.moveTo(-W, 0)
    ctx.quadraticCurveTo(0, -H * 1.7, W, 0)
    ctx.quadraticCurveTo(0, H * 1.7, -W, 0)
    ctx.closePath()
  }
  const base = ctx.createRadialGradient(0, 0, 0, 0, 0, H * 1.9)
  base.addColorStop(0, 'rgba(90,180,250,0.08)')
  base.addColorStop(1, 'rgba(90,180,250,0)')
  ctx.fillStyle = base
  ctx.beginPath(); ctx.arc(0, 0, H * 1.9, 0, TAU); ctx.fill()

  ctx.strokeStyle = p.phosphorStr
  ctx.shadowColor = p.phosphorStr
  ctx.shadowBlur = 70
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.3
  ctx.lineWidth = S * 0.012
  eyePath()
  ctx.stroke()
  ctx.globalAlpha = 1

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawIrisTexture(): THREE.CanvasTexture {
  const S = 1024
  const { canvas, ctx } = makeCanvas(S, S)
  ctx.translate(S / 2, S / 2)
  const ir = S * 0.46
  const pr = ir * 0.32
  const g = ctx.createRadialGradient(0, 0, pr * 0.6, 0, 0, ir)
  g.addColorStop(0, 'rgba(8,30,55,0)')
  g.addColorStop(0.3, 'rgba(8,30,55,0)')
  g.addColorStop(0.37, 'rgba(170,225,255,0.45)')
  g.addColorStop(0.58, 'rgba(80,170,240,0.32)')
  g.addColorStop(0.9, 'rgba(80,170,240,0.07)')
  g.addColorStop(1, 'rgba(80,170,240,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, ir, 0, TAU); ctx.fill()

  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  for (let i = 0; i < 170; i++) {
    const a = (i / 170) * TAU + (Math.random() - 0.5) * 0.05
    const r0 = pr * 1.2 + Math.random() * S * 0.01
    const r1 = ir * (0.65 + Math.random() * 0.28)
    const b = Math.random()
    ctx.strokeStyle = b > 0.95 ? 'rgba(231,169,60,0.35)' : `rgba(150,225,255,${0.02 + b * 0.1})`
    ctx.lineWidth = 1.5 + Math.random() * 2
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
    ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawScanTexture(): THREE.CanvasTexture {
  const W = 8
  const H = 512
  const { canvas, ctx } = makeCanvas(W, H)
  const band = ctx.createLinearGradient(0, H * 0.4, 0, H * 0.6)
  band.addColorStop(0, 'rgba(170,230,255,0)')
  band.addColorStop(0.5, 'rgba(190,240,255,0.6)')
  band.addColorStop(1, 'rgba(170,230,255,0)')
  ctx.fillStyle = band
  ctx.fillRect(0, H * 0.4, W, H * 0.2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapT = THREE.RepeatWrapping
  tex.wrapS = THREE.RepeatWrapping
  return tex
}

function drawGlowTexture(): THREE.CanvasTexture {
  const S = 256
  const { canvas, ctx } = makeCanvas(S, S)
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(120,210,255,0.22)')
  g.addColorStop(0.5, 'rgba(80,160,230,0.08)')
  g.addColorStop(1, 'rgba(80,160,230,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class GiantEye implements SceneFeature {
  readonly group: THREE.Group

  private readonly iris: THREE.Mesh
  private readonly frameMat: THREE.MeshBasicMaterial
  private readonly irisMat: THREE.MeshBasicMaterial
  private readonly scanMat: THREE.MeshBasicMaterial
  private readonly glowMat: THREE.SpriteMaterial
  private readonly scanTex: THREE.CanvasTexture
  private readonly geos: THREE.BufferGeometry[] = []
  private readonly mats: THREE.Material[] = []
  private readonly texs: THREE.Texture[] = []

  private anim = 0
  private blinkCooldown = 7
  private blinking = false
  private blinkT = 0
  private readonly sacCur = new THREE.Vector2()
  private readonly sacTarget = new THREE.Vector2()
  private sacTimer = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.position.set(0, BASE_Y, 0) // directly overhead, centered at the zenith

    const addLayer = (tex: THREE.CanvasTexture, size: number, z: number, opacity: number): THREE.Mesh => {
      const geo = new THREE.PlaneGeometry(size, size)
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        opacity,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.z = z
      this.group.add(mesh)
      this.geos.push(geo)
      this.mats.push(mat)
      this.texs.push(tex)
      return mesh
    }

    const frame = addLayer(drawFrameTexture(palette), R * 2.4, 0, 0.34)
    this.iris = addLayer(drawIrisTexture(), R * 1.55, 0.4, 0.5)
    this.scanTex = drawScanTexture()
    const scan = addLayer(this.scanTex, R * 1.4, 0.7, 0.4)
    this.frameMat = frame.material as THREE.MeshBasicMaterial
    this.irisMat = this.iris.material as THREE.MeshBasicMaterial
    this.scanMat = scan.material as THREE.MeshBasicMaterial

    const gtex = drawGlowTexture()
    this.glowMat = new THREE.SpriteMaterial({
      map: gtex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.22,
    })
    const glow = new THREE.Sprite(this.glowMat)
    glow.scale.setScalar(R * 3.6)
    this.group.add(glow)
    this.texs.push(gtex)
    this.mats.push(this.glowMat)
  }

  update(ctx: FeatureContext): void {
    const { dt, motion, dread, camera } = ctx
    this.anim += dt * motion
    const a = this.anim

    // wandering, drifting projection — never still
    this.group.position.set(Math.sin(a * 0.13) * 1.6, BASE_Y - dread * 14, Math.cos(a * 0.1) * 1.6)
    this.group.lookAt(camera.position) // billboard the whole assembly

    // holographic flicker + breathe
    const flicker = 0.85 + Math.sin(a * 6.3) * 0.06 + Math.sin(a * 1.1) * 0.05 + (Math.random() < 0.03 ? -0.4 : 0)
    const op = 0.3 + dread * 0.35
    this.frameMat.opacity = Math.max(0, op * flicker)
    this.irisMat.opacity = Math.max(0, (op + 0.16) * flicker)
    this.glowMat.opacity = (0.18 + dread * 0.3) * (0.9 + Math.sin(a * 0.7) * 0.1)

    // iris: slow spin + pupil pulse + saccades (it looks around)
    this.iris.rotation.z = a * 0.05
    const dil = 1 + dread * 0.28 + Math.sin(a * 0.8) * 0.04
    this.sacTimer -= dt * motion
    if (this.sacTimer <= 0) {
      this.sacTimer = 1.4 + Math.random() * 2.6
      this.sacTarget.set((Math.random() - 0.5) * R * 0.22, (Math.random() - 0.5) * R * 0.14)
    }
    this.sacCur.lerp(this.sacTarget, 0.1)
    this.iris.position.set(this.sacCur.x, this.sacCur.y, 0.4)
    this.iris.scale.setScalar(dil)

    // scanline sweeping down the eye
    this.scanTex.offset.y = (this.scanTex.offset.y - dt * motion * 0.18) % 1
    this.scanMat.opacity = 0.3 * flicker

    // slow blink — the whole eye squashes to a glowing line
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
    const swell = 1 + dread * 0.1 + Math.sin(a * 0.4) * 0.02
    this.group.scale.set(swell, swell * Math.max(0.04, openness), swell)
  }

  dispose(): void {
    for (const g of this.geos) g.dispose()
    for (const m of this.mats) m.dispose()
    for (const t of this.texs) t.dispose()
  }
}
