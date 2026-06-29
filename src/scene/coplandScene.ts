import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { ScenePalette, SceneFeature, FeatureContext } from './features/types'
import { AudioEngine } from './audioEngine'
import { CableTangle } from './features/cables'
import { DataRain } from './features/dataRain'
import { DataSpires } from './features/dataSpires'
import { TerminalText } from './features/terminalText'
import { NetworkGraph } from './features/networkGraph'

// ============================================================================
// COPLAND OS — navigable 3D backdrop
// A full-screen WebGL world the DOM looks into: the eye/circuit logo ahead, a
// cloud of billboarded holographic NAVI panels, a drifting particle field, and
// exponential fog for infinite depth. Drag to look around, scroll to fly
// through. Raycaster drives panel hover/click. The React layer drives boot
// phases (setPhase) and reacts to hover/skip via handlers.
// ============================================================================

export type CoplandPhase = 'logo' | 'boot' | 'welcome' | 'desktop'

export interface CoplandHandlers {
  onActivate?: () => void                 // a tap during boot -> skip to desktop
  onHover?: (label: string | null) => void
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
  { label: 'XANADU', variant: 2 },
  { label: 'PRESENT DAY', variant: 3 },
]

interface Panel {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  label: string
  baseX: number
  baseY: number
  baseZ: number
  bobPhase: number
  bobSpeed: number
  bobAmp: number
  hover: number
}

function readPalette(el: HTMLElement): ScenePalette {
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
// Canvas-2D textures (crisp control, amplified by the bloom pass)
// ---------------------------------------------------------------------------

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

function makeSpriteTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 64)
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(160,230,255,0.8)')
  g.addColorStop(1, 'rgba(120,210,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function drawLogoTexture(p: ScenePalette): THREE.CanvasTexture {
  const S = 1024
  const { canvas, ctx } = makeCanvas(S, S)
  ctx.translate(S / 2, S / 2)
  ctx.lineCap = 'round'

  const stroke = (color: string, blur: number) => {
    ctx.shadowColor = color
    ctx.shadowBlur = blur
    ctx.strokeStyle = color
    ctx.fillStyle = color
  }

  const halo = ctx.createRadialGradient(0, 0, 40, 0, 0, 420)
  halo.addColorStop(0, 'rgba(120,210,255,0.20)')
  halo.addColorStop(1, 'rgba(120,210,255,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, 420, 0, Math.PI * 2); ctx.fill()

  stroke(p.phosphorStr, 28)
  ctx.lineWidth = 10
  for (const r of [70, 120, 175]) {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke()
  }

  const pupil = ctx.createRadialGradient(0, 0, 4, 0, 0, 60)
  pupil.addColorStop(0, '#ffffff')
  pupil.addColorStop(0.4, p.phosphorStr)
  pupil.addColorStop(1, 'rgba(120,210,255,0)')
  ctx.shadowColor = p.phosphorStr
  ctx.shadowBlur = 40
  ctx.fillStyle = pupil
  ctx.beginPath(); ctx.arc(0, 0, 60, 0, Math.PI * 2); ctx.fill()

  stroke(p.hologramStr, 24)
  ctx.lineWidth = 16
  const bracket = (dir: number) => {
    ctx.beginPath()
    ctx.arc(dir * 250, 0, 150, dir === 1 ? -0.85 : Math.PI - 0.85, dir === 1 ? 0.85 : Math.PI + 0.85, dir !== 1)
    ctx.stroke()
  }
  bracket(1); bracket(-1)

  stroke(p.phosphorStr, 18)
  ctx.lineWidth = 8
  ctx.beginPath(); ctx.moveTo(0, 175); ctx.lineTo(0, 300); ctx.stroke()
  for (const [dx, dy] of [[0, 300], [-250, 150], [250, 150], [-175, -120], [175, -120]] as const) {
    ctx.beginPath(); ctx.arc(dx, dy, 14, 0, Math.PI * 2); ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawPanelTexture(label: string, variant: number, p: ScenePalette): THREE.CanvasTexture {
  const W = 512
  const H = 320
  const { canvas, ctx } = makeCanvas(W, H)

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
    for (let i = 0; i < 11; i++) {
      const bh = 20 + ((i * 37) % 110)
      ctx.globalAlpha = 0.25 + ((i * 13) % 70) / 100
      ctx.fillRect(34 + i * 42, 250 - bh, 26, bh)
    }
    ctx.globalAlpha = 1
  } else if (variant === 2) {
    ctx.beginPath()
    for (let x = 28; x <= W - 28; x += 6) {
      const t = (x - 28) / (W - 56)
      const y = 195 + Math.sin(t * Math.PI * 8) * 40 * Math.sin(t * Math.PI)
      if (x === 28) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  } else {
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
  private glitch: GlitchPass
  private glitchTimer = 0
  private audio = new AudioEngine()
  private audioLevel = 0
  private features: SceneFeature[] = []
  private graph: NetworkGraph | null = null
  private fogPulse = 0
  private timer = new THREE.Timer()
  private rafId = 0
  private resizeObs: ResizeObserver
  private palette: ScenePalette
  private handlers: CoplandHandlers

  private particles: THREE.Points
  private particleSpeeds: Float32Array
  private spriteTex: THREE.CanvasTexture
  private logo: THREE.Mesh
  private logoMat: THREE.MeshBasicMaterial
  private panels: Panel[] = []
  private panelMeshes: THREE.Mesh[] = []

  private currentPhase: CoplandPhase = 'logo'
  private logoOpacity = 0
  private logoTarget = 1
  private panelOpacity = 0
  private panelTarget = 0
  private reduced = false

  // camera rig
  private base = new THREE.Vector3(0, 0, 0)
  private yaw = 0
  private pitch = 0
  private yawTarget = 0
  private pitchTarget = 0
  private dolly = -26
  private dollyTarget = 0
  private dragging = false
  private moved = 0
  private lastX = 0
  private lastY = 0
  private parallax = new THREE.Vector2()
  private parallaxTarget = new THREE.Vector2()
  private ndc = new THREE.Vector2()
  private raycaster = new THREE.Raycaster()
  private hovered: Panel | null = null
  private frame = 0

  private onPointerDown: (e: PointerEvent) => void
  private onPointerMove: (e: PointerEvent) => void
  private onPointerUp: () => void
  private onWheel: (e: WheelEvent) => void
  private onContextLost = (e: Event) => e.preventDefault()

  constructor(container: HTMLElement, handlers: CoplandHandlers = {}) {
    this.container = container
    this.handlers = handlers
    this.palette = readPalette(document.documentElement)
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.setSize(w, h)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    this.renderer.domElement.style.cursor = 'grab'
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = this.palette.voidColor.clone()
    this.scene.fog = new THREE.FogExp2(this.palette.voidColor.clone().getHex(), 0.018)

    this.camera = new THREE.PerspectiveCamera(70, w / h, 0.1, 240)

    this.spriteTex = makeSpriteTexture()
    const built = this.buildParticles()
    this.particles = built.points
    this.particleSpeeds = built.speeds
    this.scene.add(this.particles)

    this.logoMat = new THREE.MeshBasicMaterial({
      map: drawLogoTexture(this.palette),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    this.logo = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), this.logoMat)
    this.logo.position.set(0, 0, -9)
    this.scene.add(this.logo)

    this.buildPanels()
    this.buildFeatures()

    this.composer = new EffectComposer(this.renderer)
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.composer.setSize(w, h)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 1.2, 0.6, 0.85)
    this.composer.addPass(this.bloom)
    this.glitch = new GlitchPass()
    this.glitch.enabled = false
    this.composer.addPass(this.glitch)
    this.composer.addPass(new OutputPass())

    // --- input ---------------------------------------------------------------
    this.onPointerDown = (e: PointerEvent) => {
      this.audio.resume()
      this.dragging = true
      this.moved = 0
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.renderer.domElement.style.cursor = 'grabbing'
    }
    this.onPointerMove = (e: PointerEvent) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      this.parallaxTarget.set((e.clientX / vw) * 2 - 1, -((e.clientY / vh) * 2 - 1))
      this.ndc.copy(this.parallaxTarget)
      if (this.dragging) {
        const dx = e.clientX - this.lastX
        const dy = e.clientY - this.lastY
        this.lastX = e.clientX
        this.lastY = e.clientY
        this.moved += Math.abs(dx) + Math.abs(dy)
        this.yawTarget -= dx * 0.0032
        this.pitchTarget -= dy * 0.0032
        const lim = Math.PI / 2.4
        this.pitchTarget = Math.max(-lim, Math.min(lim, this.pitchTarget))
      }
    }
    this.onPointerUp = () => {
      if (this.dragging && this.moved < 8) {
        if (this.currentPhase !== 'desktop') this.handlers.onActivate?.()
        else this.handleTap()
      }
      this.dragging = false
      this.renderer.domElement.style.cursor = this.hovered ? 'pointer' : 'grab'
    }
    this.onWheel = (e: WheelEvent) => {
      this.dollyTarget = THREE.MathUtils.clamp(this.dollyTarget + e.deltaY * 0.006, -8, 26)
    }
    const el = this.renderer.domElement
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('wheel', this.onWheel, { passive: true })
    el.addEventListener('webglcontextlost', this.onContextLost)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
  }

  private buildParticles(): { points: THREE.Points; speeds: Float32Array } {
    const COUNT = this.reduced ? 1100 : 3200
    const positions = new Float32Array(COUNT * 3)
    const speeds = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3 + 0] = (Math.random() - 0.5) * 70
      positions[i * 3 + 1] = (Math.random() - 0.5) * 44
      positions[i * 3 + 2] = -Math.random() * 90 + 20
      speeds[i] = 0.6 + Math.random() * 1.6
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      color: this.palette.hologram.clone(),
      map: this.spriteTex,
      size: 0.4,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    return { points: new THREE.Points(geo, mat), speeds }
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
      const hgt = 1.7 + (i % 3) * 0.35
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hgt * aspect, hgt), mat)

      const angle = (i / PANELS.length) * Math.PI * 2 + 0.6
      const radius = 8 + (i % 4) * 2.4
      const baseX = Math.cos(angle) * radius
      const baseY = Math.sin(angle) * radius * 0.5 + (i % 2 ? 1.6 : -1.6)
      const baseZ = -5 - (i % 5) * 4.2
      mesh.position.set(baseX, baseY, baseZ)

      this.panels.push({
        mesh,
        mat,
        label: def.label,
        baseX,
        baseY,
        baseZ,
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.25 + Math.random() * 0.35,
        bobAmp: 0.18 + Math.random() * 0.26,
        hover: 0,
      })
      this.scene.add(mesh)
      this.panelMeshes.push(mesh)
    })
  }

  private buildFeatures(): void {
    this.graph = new NetworkGraph(this.palette)
    this.features = [
      new CableTangle(this.palette),
      new DataRain(this.palette),
      new DataSpires(this.palette),
      new TerminalText(this.palette),
      this.graph,
    ]
    for (const f of this.features) this.scene.add(f.group)
  }

  setPhase(phase: CoplandPhase): void {
    this.currentPhase = phase
    this.logoTarget = phase === 'boot' ? 0.35 : 1
    this.panelTarget = phase === 'desktop' ? 1 : 0
    this.glitchTimer = 0.4 // brief glitch warp on layer change
  }

  private handleTap(): void {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    // jack-in: clicking a network-graph node dives the camera a layer deeper
    if (this.graph) {
      const nodeHits = this.raycaster.intersectObjects(this.graph.nodeMeshes, false)
      if (nodeHits.length) {
        this.jackIn(nodeHits[0].object as THREE.Mesh)
        return
      }
    }
    const hits = this.raycaster.intersectObjects(this.panelMeshes, false)
    if (hits.length) this.lookToward(hits[0].object.position)
  }

  private lookToward(worldPos: THREE.Vector3): void {
    const dir = worldPos.clone().sub(this.camera.position).normalize()
    this.yawTarget = Math.atan2(-dir.x, -dir.z)
    this.pitchTarget = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))
  }

  private jackIn(node: THREE.Mesh): void {
    if (!this.graph) return
    const target = this.graph.nodeWorldPosition(node, new THREE.Vector3())
    this.lookToward(target)
    const dist = target.distanceTo(this.base)
    this.dollyTarget = THREE.MathUtils.clamp(dist - 2.5, -8, 24)
    this.fogPulse = 0.02 // fog darkens as you dive a layer deeper
    this.glitchTimer = 0.45
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
    this.frame++
    this.audioLevel = this.audio.level()

    // --- camera rig: ease yaw/pitch/dolly, idle auto-drift, parallax ---------
    if (!this.dragging) this.yawTarget += dt * 0.02 * motion
    this.yaw += (this.yawTarget - this.yaw) * 0.08
    this.pitch += (this.pitchTarget - this.pitch) * 0.08
    this.dolly += (this.dollyTarget - this.dolly) * 0.05
    this.parallax.lerp(this.parallaxTarget, 0.04)

    const e = new THREE.Euler(
      this.pitch + this.parallax.y * 0.05,
      this.yaw + this.parallax.x * 0.06,
      0,
      'YXZ',
    )
    this.camera.quaternion.setFromEuler(e)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
    this.camera.position.copy(this.base).addScaledVector(forward, this.dolly)
    this.camera.position.y = Math.max(this.camera.position.y, -6)

    // --- jack-in fog pulse + feature update + glitch warp timer --------------
    this.fogPulse += (0 - this.fogPulse) * 0.02
    const fog = this.scene.fog as THREE.FogExp2
    fog.density = 0.018 + this.fogPulse
    const ctx: FeatureContext = { dt, t, motion, audio: this.audioLevel, camera: this.camera }
    for (const f of this.features) f.update(ctx)
    if (this.glitchTimer > 0) {
      this.glitchTimer -= dt
      this.glitch.enabled = true
    } else {
      this.glitch.enabled = false
    }

    // --- drifting particle field (endless: wrap Y) ---------------------------
    const arr = this.particles.geometry.attributes.position.array as Float32Array
    for (let i = 0; i < this.particleSpeeds.length; i++) {
      const yi = i * 3 + 1
      arr[yi] -= dt * this.particleSpeeds[i] * motion
      if (arr[yi] < -22) arr[yi] = 22
    }
    this.particles.geometry.attributes.position.needsUpdate = true
    this.particles.rotation.y = t * 0.008 * motion
    const pmat = this.particles.material as THREE.PointsMaterial
    pmat.opacity = 0.6 + this.audioLevel * 0.3

    // --- logo: fade + slow breathe + billboard -------------------------------
    this.logoOpacity += (this.logoTarget - this.logoOpacity) * Math.min(dt * 2.2, 1)
    this.logoMat.opacity = this.logoOpacity
    this.logo.scale.setScalar(1 + Math.sin(t * 0.6) * 0.015 * motion + this.audioLevel * 0.06)
    this.logo.lookAt(this.camera.position)

    // --- panels: fade + bob + billboard + hover ------------------------------
    this.panelOpacity += (this.panelTarget - this.panelOpacity) * Math.min(dt * 1.4, 1)
    if (this.currentPhase === 'desktop' && this.frame % 4 === 0) this.updateHover()
    for (const pn of this.panels) {
      const hoverTarget = this.hovered === pn ? 1 : 0
      pn.hover += (hoverTarget - pn.hover) * 0.12
      pn.mesh.position.set(
        pn.baseX + Math.cos(t * pn.bobSpeed * 0.7 + pn.bobPhase) * 0.1 * motion,
        pn.baseY + Math.sin(t * pn.bobSpeed + pn.bobPhase) * pn.bobAmp * motion,
        pn.baseZ,
      )
      pn.mesh.lookAt(this.camera.position)
      pn.mesh.scale.setScalar(1 + pn.hover * 0.12)
      pn.mat.opacity = this.panelOpacity * (0.78 + pn.hover * 0.5)
    }

    // --- phosphor flicker on the bloom ---------------------------------------
    const flick = Math.sin(t * 30) * 0.04 + (Math.random() < 0.015 ? -0.3 : 0)
    this.bloom.strength = this.reduced ? 1.0 : 1.2 + this.audioLevel * 0.7 + flick

    this.composer.render()
  }

  private updateHover(): void {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.panelMeshes, false)
    const hitMesh = hits.length ? hits[0].object : null
    const next = hitMesh ? this.panels.find((p) => p.mesh === hitMesh) ?? null : null
    if (next !== this.hovered) {
      this.hovered = next
      this.handlers.onHover?.(next ? next.label : null)
      if (!this.dragging) this.renderer.domElement.style.cursor = next ? 'pointer' : 'grab'
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId)
    this.resizeObs.disconnect()
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('webglcontextlost', this.onContextLost)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)

    for (const f of this.features) f.dispose()
    this.audio.dispose()

    this.scene.traverse((obj) => {
      const asMesh = obj as THREE.Mesh
      asMesh.geometry?.dispose()
      const mat = asMesh.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat) {
        const mm = mat as THREE.MeshBasicMaterial
        mm.map?.dispose()
        mm.dispose()
      }
    })
    this.spriteTex.dispose()
    this.composer.dispose()
    this.bloom.dispose()
    this.glitch.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    if (el.parentNode) el.parentNode.removeChild(el)
  }
}
