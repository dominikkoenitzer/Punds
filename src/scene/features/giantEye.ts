import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// GiantEye — a colossal eye hanging in the void at the zenith, staring down.
// The iris rides the front of the sclera and slides to keep facing the camera,
// so the eye follows you wherever you look. It blinks on a slow timer, and
// reacts to the idle "dread": the longer you hold still, the wider the pupil
// dilates and the lower the eye descends, looming closer. (Generic eye — no
// character.) The iris is drawn at 2K for crispness when you look straight up.

const TAU = Math.PI * 2
const R = 30 // eyeball radius
const BASE_Y = 112

function drawIrisTexture(p: ScenePalette): THREE.CanvasTexture {
  const S = 2048
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.translate(S / 2, S / 2)

  const rad = S * 0.49 // iris outer radius (fills the disc)
  const pr = S * 0.17 // pupil hole radius

  // base iris gradient: dark teal at the pupil -> hologram -> phosphor -> dark limbus
  const g = ctx.createRadialGradient(0, 0, pr, 0, 0, rad)
  g.addColorStop(0, '#0a3a55')
  g.addColorStop(0.45, p.hologramStr)
  g.addColorStop(0.8, p.phosphorStr)
  g.addColorStop(1, '#091f3a')
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(0, 0, rad, 0, TAU); ctx.fill()

  // radial fibres (the striation)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 460; i++) {
    const a = (i / 460) * TAU + (Math.random() - 0.5) * 0.02
    const r0 = pr * 1.05 + Math.random() * S * 0.02
    const r1 = rad * (0.72 + Math.random() * 0.26)
    const bright = Math.random()
    ctx.strokeStyle = bright > 0.93 ? 'rgba(231,169,60,0.5)' : `rgba(150,225,255,${0.05 + bright * 0.22})`
    ctx.lineWidth = 1.5 + Math.random() * 3
    const mr = (r0 + r1) / 2
    const ma = a + (Math.random() - 0.5) * 0.05
    ctx.beginPath()
    ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0)
    ctx.quadraticCurveTo(Math.cos(ma) * mr, Math.sin(ma) * mr, Math.cos(a) * r1, Math.sin(a) * r1)
    ctx.stroke()
  }
  ctx.globalCompositeOperation = 'source-over'

  // collarette ring + dark limbal ring
  ctx.strokeStyle = 'rgba(185,240,255,0.22)'
  ctx.lineWidth = S * 0.012
  ctx.beginPath(); ctx.arc(0, 0, rad * 0.42, 0, TAU); ctx.stroke()
  ctx.strokeStyle = 'rgba(4,14,30,0.9)'
  ctx.lineWidth = S * 0.03
  ctx.beginPath(); ctx.arc(0, 0, rad * 0.985, 0, TAU); ctx.stroke()

  // shadow that sinks toward the pupil
  const ps = ctx.createRadialGradient(0, 0, pr * 0.6, 0, 0, pr * 1.7)
  ps.addColorStop(0, 'rgba(0,0,0,0.9)')
  ps.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = ps
  ctx.beginPath(); ctx.arc(0, 0, pr * 1.7, 0, TAU); ctx.fill()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawScleraTexture(): THREE.CanvasTexture {
  const S = 1024
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5)
  g.addColorStop(0, '#dfeefb')
  g.addColorStop(0.7, '#bcd6ec')
  g.addColorStop(1, '#7fa2c4')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  // faint veins
  ctx.strokeStyle = 'rgba(120,150,190,0.35)'
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * TAU
    let x = S / 2 + Math.cos(a) * S * 0.46
    let y = S / 2 + Math.sin(a) * S * 0.46
    ctx.lineWidth = 1 + Math.random() * 1.5
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < 5; s++) {
      x += Math.cos(a + Math.PI + (Math.random() - 0.5)) * S * 0.04
      y += Math.sin(a + Math.PI + (Math.random() - 0.5)) * S * 0.04
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
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
    g.addColorStop(0, 'rgba(120,210,255,0.5)')
    g.addColorStop(0.5, 'rgba(80,160,230,0.18)')
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

  private readonly scleraGeo: THREE.SphereGeometry
  private readonly scleraMat: THREE.MeshBasicMaterial
  private readonly scleraTex: THREE.CanvasTexture
  private readonly iris: THREE.Group
  private readonly irisGeo: THREE.CircleGeometry
  private readonly irisMat: THREE.MeshBasicMaterial
  private readonly irisTex: THREE.CanvasTexture
  private readonly pupil: THREE.Mesh
  private readonly pupilGeo: THREE.CircleGeometry
  private readonly pupilMat: THREE.MeshBasicMaterial
  private readonly glowMat: THREE.SpriteMaterial
  private readonly glowTex: THREE.CanvasTexture
  private readonly glow: THREE.Sprite

  private readonly dir = new THREE.Vector3()
  private readonly eyeWorld = new THREE.Vector3()
  private anim = 0
  private blinkCooldown = 5
  private blinking = false
  private blinkT = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.position.set(0, BASE_Y, -26)

    // sclera (the eyeball)
    this.scleraTex = drawScleraTexture()
    this.scleraGeo = new THREE.SphereGeometry(R, 48, 32)
    this.scleraMat = new THREE.MeshBasicMaterial({ map: this.scleraTex, transparent: true, fog: false })
    this.group.add(new THREE.Mesh(this.scleraGeo, this.scleraMat))

    // outer halo so it has presence in the void
    this.glowTex = drawGlowTexture()
    this.glowMat = new THREE.SpriteMaterial({
      map: this.glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      opacity: 0.3,
    })
    this.glow = new THREE.Sprite(this.glowMat)
    this.glow.scale.setScalar(R * 4)
    this.group.add(this.glow)

    // iris assembly (rides the front surface, faces the camera)
    this.iris = new THREE.Group()
    this.irisTex = drawIrisTexture(palette)
    this.irisGeo = new THREE.CircleGeometry(R * 0.5, 72)
    this.irisMat = new THREE.MeshBasicMaterial({
      map: this.irisTex,
      transparent: true,
      depthWrite: false,
      fog: false,
    })
    this.iris.add(new THREE.Mesh(this.irisGeo, this.irisMat))

    this.pupilGeo = new THREE.CircleGeometry(R * 0.5 * 0.34, 48)
    this.pupilMat = new THREE.MeshBasicMaterial({ color: 0x010306, transparent: true, fog: false })
    this.pupil = new THREE.Mesh(this.pupilGeo, this.pupilMat)
    this.pupil.position.z = 0.06
    this.iris.add(this.pupil)

    this.group.add(this.iris)
  }

  update(ctx: FeatureContext): void {
    const { dt, motion, dread, camera } = ctx
    this.anim += dt * motion

    // dread: descend / loom closer, brighten the halo
    this.group.position.y = BASE_Y - dread * 18
    this.glowMat.opacity = 0.28 + dread * 0.4

    // keep the iris on the front of the sclera, facing the camera (tracking)
    this.group.getWorldPosition(this.eyeWorld)
    this.dir.subVectors(camera.position, this.eyeWorld).normalize()
    this.iris.position.copy(this.dir).multiplyScalar(R * 1.04)
    this.iris.lookAt(camera.position)

    // pupil dilation: a slow pulse + dread widens it
    const dil = 1 + dread * 0.8 + Math.sin(this.anim * 0.5) * 0.06
    this.pupil.scale.setScalar(dil)

    // slow blink (less often the more it's fixated on you)
    this.blinkCooldown -= dt * motion
    if (this.blinkCooldown <= 0 && !this.blinking) {
      this.blinking = true
      this.blinkT = 0
    }
    if (this.blinking) {
      this.blinkT += (dt * motion) / 0.22
      const k = Math.sin(Math.min(this.blinkT, 1) * Math.PI)
      this.iris.scale.y = Math.max(0.05, 1 - k)
      this.scleraMat.opacity = 1 - k * 0.45
      if (this.blinkT >= 1) {
        this.blinking = false
        this.iris.scale.y = 1
        this.scleraMat.opacity = 1
        this.blinkCooldown = 4 + Math.random() * 6 + dread * 6
      }
    }
  }

  dispose(): void {
    this.scleraGeo.dispose()
    this.scleraMat.dispose()
    this.scleraTex.dispose()
    this.irisGeo.dispose()
    this.irisMat.dispose()
    this.irisTex.dispose()
    this.pupilGeo.dispose()
    this.pupilMat.dispose()
    this.glowMat.dispose()
    this.glowTex.dispose()
  }
}
