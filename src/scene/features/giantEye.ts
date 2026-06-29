import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// GiantEye — a colossal HOLOGRAPHIC eye in the void at the zenith. A soft, faint
// additive projection (almond glow frame + a separate iris layer) that
// billboards to face you. The iris flicks to look in a new direction every
// couple of seconds, then settles. It also breathes, flickers, blinks and
// drifts, and looms lower with idle dread. Generic eye, copyright-safe.

const TAU = Math.PI * 2
const R = 24
const BASE_Y = 88

function makeCanvas(s: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = s
  canvas.height = s
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

// the eye opening + soft glow, no iris (the iris is a separate moving layer)
function drawFrameTexture(p: ScenePalette): THREE.CanvasTexture {
  const S = 1024
  const { canvas, ctx } = makeCanvas(S)
  ctx.translate(S / 2, S / 2)
  ctx.lineCap = 'round'
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
  ctx.globalAlpha = 0.3
  ctx.lineWidth = S * 0.009
  eyePath()
  ctx.stroke()
  ctx.globalAlpha = 1

  // eyelashes splaying off the lids
  const bez = (t: number, top: boolean): { x: number; y: number } => {
    const u = 1 - t
    const cy = top ? -H * 1.7 : H * 1.7
    return { x: u * u * -W + t * t * W, y: 2 * u * t * cy }
  }
  const drawLashes = (count: number, top: boolean, len: number, alpha: number): void => {
    ctx.strokeStyle = p.phosphorStr
    ctx.shadowColor = p.phosphorStr
    ctx.shadowBlur = 18
    ctx.lineWidth = S * 0.004
    for (let i = 0; i < count; i++) {
      const t = 0.12 + (i / (count - 1)) * 0.76
      const a0 = bez(t, top)
      const a1 = bez(t + 0.01, top)
      let nx = -(a1.y - a0.y)
      let ny = a1.x - a0.x
      const nl = Math.hypot(nx, ny) || 1
      nx /= nl; ny /= nl
      if ((top && ny > 0) || (!top && ny < 0)) { nx = -nx; ny = -ny } // point outward
      let sx = nx + (a0.x / W) * 0.5 // splay toward the nearer corner
      let sy = ny
      const sl = Math.hypot(sx, sy) || 1
      sx /= sl; sy /= sl
      const l = len * (0.7 + Math.random() * 0.5)
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.moveTo(a0.x, a0.y)
      ctx.lineTo(a0.x + sx * l, a0.y + sy * l)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  drawLashes(15, true, S * 0.05, 0.55)
  drawLashes(9, false, S * 0.03, 0.3)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// the iris disc (soft glow ring + fibres + a void pupil), drawn on its own layer
function drawIrisTexture(): THREE.CanvasTexture {
  const S = 1024
  const { canvas, ctx } = makeCanvas(S)
  ctx.translate(S / 2, S / 2)
  ctx.lineCap = 'round'
  const ir = S * 0.46
  const pr = ir * 0.32
  const g = ctx.createRadialGradient(0, 0, pr * 0.6, 0, 0, ir)
  g.addColorStop(0, 'rgba(8,30,55,0)')
  g.addColorStop(0.3, 'rgba(8,30,55,0)')
  g.addColorStop(0.37, 'rgba(170,225,255,0.42)')
  g.addColorStop(0.58, 'rgba(80,170,240,0.3)')
  g.addColorStop(0.9, 'rgba(80,170,240,0.06)')
  g.addColorStop(1, 'rgba(80,170,240,0)')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, ir, 0, TAU); ctx.fill()

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

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawGlowTexture(): THREE.CanvasTexture {
  const S = 256
  const { canvas, ctx } = makeCanvas(S)
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
  private readonly glowMat: THREE.SpriteMaterial
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
    this.iris = addLayer(drawIrisTexture(), R * 1.2, 0.4, 0.5)
    this.frameMat = frame.material as THREE.MeshBasicMaterial
    this.irisMat = this.iris.material as THREE.MeshBasicMaterial

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

    // wavering, drifting projection — never perfectly still
    this.group.position.set(Math.sin(a * 0.13) * 1.6, BASE_Y - dread * 14, Math.cos(a * 0.1) * 1.6)
    this.group.lookAt(camera.position) // the eyeball keeps facing you

    // holographic flicker + breathe; brighter with dread
    const flicker = 0.85 + Math.sin(a * 6.3) * 0.06 + Math.sin(a * 1.1) * 0.05 + (Math.random() < 0.03 ? -0.4 : 0)
    const op = 0.3 + dread * 0.35
    this.frameMat.opacity = Math.max(0, op * flicker)
    this.irisMat.opacity = Math.max(0, (op + 0.16) * flicker)
    this.glowMat.opacity = (0.18 + dread * 0.3) * (0.9 + Math.sin(a * 0.7) * 0.1)

    // the IRIS flicks to look in a new direction every couple seconds, then holds
    this.sacTimer -= dt * motion
    if (this.sacTimer <= 0) {
      this.sacTimer = 1.4 + Math.random() * 2.6
      if (Math.random() < 0.4) this.sacTarget.set(0, 0)
      else this.sacTarget.set((Math.random() - 0.5) * R * 0.16, (Math.random() - 0.5) * R * 0.07)
    }
    this.sacCur.lerp(this.sacTarget, 0.22) // snappy flick, then settle
    this.iris.position.set(this.sacCur.x, this.sacCur.y, 0.4)

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
