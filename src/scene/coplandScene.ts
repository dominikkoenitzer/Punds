import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

// ============================================================================
// COPLAND OS — Three.js scene
// A drifting holographic void: the eye/circuit logo at center, a cloud of
// floating NAVI panels at depth, an ambient particle field, and a bloom pass
// for the phosphor glow. The React layer drives boot phases via setPhase().
// ============================================================================

export type CoplandPhase = 'logo' | 'boot' | 'welcome' | 'desktop'

interface Palette {
  voidColor: THREE.Color
  phosphor: THREE.Color
  hologram: THREE.Color
  tachibana: THREE.Color
  warning: THREE.Color
  phosphorStr: string
  hologramStr: string
  tachibanaStr: string
  warningStr: string
}

const PANELS: { label: string; variant: number }[] = [
  { label: 'NAVI', variant: 0 },
  { label: 'WIRED', variant: 1 },
  { label: 'PROTOCOL 7', variant: 2 },
  { label: 'PSYCHE', variant: 3 },
  { label: 'LAYER 07', variant: 0 },
  { label: 'SCHUMANN', variant: 1 },
  { label: 'TACHIBANA', variant: 2 },
  { label: 'CYBERIA', variant: 3 },
  { label: 'KIDS', variant: 0 },
  { label: 'MEMEX', variant: 1 },
]

interface Panel {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  baseX: number
  baseY: number
  baseZ: number
  bobPhase: number
  bobSpeed: number
  bobAmp: number
}

function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el)
  const v = (name: string, fallback: string): string => {
    const val = cs.getPropertyValue(name).trim()
    return val || fallback
  }
  const phosphorStr = v('--phosphor', '#76e4ff')
  const hologramStr = v('--hologram', '#2f7fc4')
  const tachibanaStr = v('--tachibana', '#e7a93c')
  const warningStr = v('--warning', '#d83a2b')
  return {
    voidColor: new THREE.Color(v('--copland-void', '#04101c')),
    phosphor: new THREE.Color(phosphorStr),
    hologram: new THREE.Color(hologramStr),
    tachibana: new THREE.Color(tachibanaStr),
    warning: new THREE.Color(warningStr),
    phosphorStr,
    hologramStr,
    tachibanaStr,
    warningStr,
  }
}

// ---------------------------------------------------------------------------
// Canvas-2D textures (crisp control, then amplified by the bloom pass)
// ---------------------------------------------------------------------------

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

function drawLogoTexture(p: Palette): THREE.CanvasTexture {
  const S = 1024
  const { canvas, ctx } = makeCanvas(S)
  const cx = S / 2
  const cy = S / 2
  ctx.translate(cx, cy)
  ctx.lineCap = 'round'

  const glow = (color: string, blur: number) => {
    ctx.shadowColor = color
    ctx.shadowBlur = blur
    ctx.strokeStyle = color
    ctx.fillStyle = color
  }

  // outer soft halo
  const halo = ctx.createRadialGradient(0, 0, 40, 0, 0, 420)
  halo.addColorStop(0, 'rgba(120,210,255,0.20)')
  halo.addColorStop(1, 'rgba(120,210,255,0)')
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(0, 0, 420, 0, Math.PI * 2)
  ctx.fill()

  // concentric iris rings
  glow(p.phosphorStr, 28)
  ctx.lineWidth = 10
  for (const r of [70, 120, 175]) {
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  // central pupil node
  const pupil = ctx.createRadialGradient(0, 0, 4, 0, 0, 60)
  pupil.addColorStop(0, '#ffffff')
  pupil.addColorStop(0.4, p.phosphorStr)
  pupil.addColorStop(1, 'rgba(120,210,255,0)')
  ctx.shadowColor = p.phosphorStr
  ctx.shadowBlur = 40
  ctx.fillStyle = pupil
  ctx.beginPath()
  ctx.arc(0, 0, 60, 0, Math.PI * 2)
  ctx.fill()

  // flanking bracket arcs  < >
  glow(p.hologramStr, 24)
  ctx.lineWidth = 16
  const bracket = (dir: number) => {
    ctx.beginPath()
    ctx.arc(dir * 250, 0, 150, dir === 1 ? -0.85 : Math.PI - 0.85, dir === 1 ? 0.85 : Math.PI + 0.85, dir !== 1)
    ctx.stroke()
  }
  bracket(1)
  bracket(-1)

  // circuit stem + node dots
  glow(p.phosphorStr, 18)
  ctx.lineWidth = 8
  ctx.beginPath()
  ctx.moveTo(0, 175)
  ctx.lineTo(0, 300)
  ctx.stroke()
  for (const [dx, dy] of [[0, 300], [-250, 150], [250, 150], [-175, -120], [175, -120]] as const) {
    ctx.beginPath()
    ctx.arc(dx, dy, 14, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawPanelTexture(label: string, variant: number, p: Palette): THREE.CanvasTexture {
  const W = 512
  const H = 320
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  // translucent rounded panel
  const r = 22
  ctx.beginPath()
  ctx.moveTo(r, 2)
  ctx.arcTo(W - 2, 2, W - 2, H - 2, r)
  ctx.arcTo(W - 2, H - 2, 2, H - 2, r)
  ctx.arcTo(2, H - 2, 2, 2, r)
  ctx.arcTo(2, 2, W - 2, 2, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(28,86,130,0.16)'
  ctx.fill()
  ctx.shadowColor = p.hologramStr
  ctx.shadowBlur = 16
  ctx.lineWidth = 2.5
  ctx.strokeStyle = p.hologramStr
  ctx.stroke()
  ctx.shadowBlur = 0

  // label
  ctx.fillStyle = p.phosphorStr
  ctx.font = '600 26px "TrixieCyrG", ui-monospace, monospace'
  ctx.textBaseline = 'top'
  ctx.shadowColor = p.phosphorStr
  ctx.shadowBlur = 10
  ctx.fillText(label.toUpperCase(), 28, 26)
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(120,210,255,0.45)'
  ctx.fillRect(28, 66, W - 56, 1.5)

  ctx.strokeStyle = p.phosphorStr
  ctx.fillStyle = p.phosphorStr
  ctx.lineWidth = 2

  if (variant === 0) {
    // radial dial
    const dcx = W / 2
    const dcy = 200
    ctx.globalAlpha = 0.35
    ctx.beginPath(); ctx.arc(dcx, dcy, 78, 0, Math.PI * 2); ctx.stroke()
    ctx.globalAlpha = 1
    ctx.beginPath(); ctx.arc(dcx, dcy, 78, -Math.PI / 2, Math.PI * 0.85); ctx.stroke()
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2
      ctx.globalAlpha = i % 3 === 0 ? 0.9 : 0.3
      ctx.beginPath()
      ctx.moveTo(dcx + Math.cos(a) * 88, dcy + Math.sin(a) * 88)
      ctx.lineTo(dcx + Math.cos(a) * 98, dcy + Math.sin(a) * 98)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  } else if (variant === 1) {
    // signal bars
    for (let i = 0; i < 11; i++) {
      const bh = 20 + ((i * 37) % 110)
      ctx.globalAlpha = 0.25 + ((i * 13) % 70) / 100
      ctx.fillRect(34 + i * 42, 250 - bh, 26, bh)
    }
    ctx.globalAlpha = 1
  } else if (variant === 2) {
    // waveform
    ctx.beginPath()
    for (let x = 28; x <= W - 28; x += 6) {
      const t = (x - 28) / (W - 56)
      const y = 195 + Math.sin(t * Math.PI * 8) * 40 * Math.sin(t * Math.PI)
      if (x === 28) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  } else {
    // glyph grid
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 10; gx++) {
        ctx.globalAlpha = (gx * 7 + gy * 5) % 4 === 0 ? 0.85 : 0.18
        ctx.fillRect(34 + gx * 44, 110 + gy * 40, 30, 24)
      }
    }
    ctx.globalAlpha = 1
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ---------------------------------------------------------------------------

export class CoplandScene {
  private container: HTMLElement
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private timer = new THREE.Timer()
  private rafId = 0
  private resizeObs: ResizeObserver
  private palette: Palette

  private particles: THREE.Points
  private logo: THREE.Mesh
  private logoMat: THREE.MeshBasicMaterial
  private panels: Panel[] = []

  private logoOpacity = 0
  private logoTarget = 1
  private panelOpacity = 0
  private panelTarget = 0
  private reduced = false

  private pointer = new THREE.Vector2(0, 0)
  private pointerTarget = new THREE.Vector2(0, 0)
  private onContextLost = (e: Event) => e.preventDefault()

  constructor(container: HTMLElement) {
    this.container = container
    this.palette = readPalette(document.documentElement)
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost)

    this.scene = new THREE.Scene()
    this.scene.background = this.palette.voidColor.clone()
    this.scene.fog = new THREE.FogExp2(this.palette.voidColor.clone(), 0.045)

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 120)
    this.camera.position.set(0, 0, 7)

    this.particles = this.buildParticles()
    this.scene.add(this.particles)

    this.logoMat = new THREE.MeshBasicMaterial({
      map: drawLogoTexture(this.palette),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.logo = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), this.logoMat)
    this.scene.add(this.logo)

    this.buildPanels()

    // postprocessing — bloom for the phosphor glow
    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.composer.setSize(w, h)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.9, 0.7, 0.15)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
  }

  private buildParticles(): THREE.Points {
    const COUNT = this.reduced ? 900 : 2600
    const positions = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 44
      positions[i * 3 + 1] = (Math.random() - 0.5) * 28
      positions[i * 3 + 2] = -Math.random() * 40 + 4
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: this.palette.hologram.clone(),
      size: 0.06,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    return new THREE.Points(geo, mat)
  }

  private buildPanels(): void {
    PANELS.forEach((def, i) => {
      const tex = drawPanelTexture(def.label, def.variant, this.palette)
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const aspect = 512 / 320
      const hgt = 1.5 + (i % 3) * 0.25
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hgt * aspect, hgt), mat)

      // distribute in a loose cloud around the centre, biased to the sides/back
      const angle = (i / PANELS.length) * Math.PI * 2 + 0.6
      const radius = 3.6 + (i % 4) * 1.1
      const baseX = Math.cos(angle) * radius * 1.25
      const baseY = Math.sin(angle) * radius * 0.62
      const baseZ = -2 - (i % 5) * 1.7
      mesh.position.set(baseX, baseY, baseZ)
      mesh.rotation.y = -baseX * 0.07
      mesh.rotation.z = (Math.random() - 0.5) * 0.08

      this.panels.push({
        mesh,
        mat,
        baseX,
        baseY,
        baseZ,
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.25 + Math.random() * 0.35,
        bobAmp: 0.12 + Math.random() * 0.18,
      })
      this.scene.add(mesh)
    })
  }

  setPhase(phase: CoplandPhase): void {
    this.logoTarget = phase === 'boot' ? 0.35 : 1
    this.panelTarget = phase === 'desktop' ? 1 : 0
  }

  setPointer(nx: number, ny: number): void {
    // normalised -1..1
    this.pointerTarget.set(nx, ny)
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.bloom.setSize(w, h)
  }

  start(): void {
    this.animate()
  }

  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate)
    this.timer.update()
    const dt = Math.min(this.timer.getDelta(), 0.05)
    const t = this.timer.getElapsed()
    const motion = this.reduced ? 0.25 : 1

    // pointer parallax
    this.pointer.lerp(this.pointerTarget, 0.04)
    this.camera.position.x = this.pointer.x * 0.6
    this.camera.position.y = this.pointer.y * 0.4 + Math.sin(t * 0.2) * 0.1 * motion
    this.camera.lookAt(0, 0, -1)

    // drifting void
    this.particles.rotation.y = t * 0.012 * motion
    this.particles.rotation.x = Math.sin(t * 0.05) * 0.04 * motion
    this.particles.position.z = ((t * 0.25 * motion) % 6)

    // logo: fade + slow breathe
    this.logoOpacity += (this.logoTarget - this.logoOpacity) * Math.min(dt * 2.2, 1)
    this.logoMat.opacity = this.logoOpacity
    const breathe = 1 + Math.sin(t * 0.6) * 0.015 * motion
    this.logo.scale.setScalar(breathe)
    this.logo.rotation.z = Math.sin(t * 0.08) * 0.02 * motion

    // panels: fade + bob
    this.panelOpacity += (this.panelTarget - this.panelOpacity) * Math.min(dt * 1.4, 1)
    for (const pn of this.panels) {
      pn.mat.opacity = this.panelOpacity * 0.9
      pn.mesh.position.y = pn.baseY + Math.sin(t * pn.bobSpeed + pn.bobPhase) * pn.bobAmp * motion
      pn.mesh.position.x = pn.baseX + Math.cos(t * pn.bobSpeed * 0.7 + pn.bobPhase) * 0.06 * motion
      pn.mesh.rotation.z = (Math.sin(t * 0.2 + pn.bobPhase) * 0.03) * motion
    }

    // phosphor flicker on the bloom
    const flick = 0.9 + Math.sin(t * 30) * 0.03 + (Math.random() < 0.015 ? -0.25 : 0)
    this.bloom.strength = (this.reduced ? 0.7 : flick)

    this.composer.render()
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.resizeObs.disconnect()
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost)

    this.scene.traverse((obj) => {
      const anyObj = obj as THREE.Mesh | THREE.Points
      const geom = (anyObj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
      geom?.dispose()
      const mat = (anyObj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat) {
        const mm = mat as THREE.MeshBasicMaterial
        mm.map?.dispose()
        mm.dispose()
      }
    })
    this.composer.dispose()
    this.bloom.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement)
    }
  }
}
