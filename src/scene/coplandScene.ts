import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { ScenePalette, SceneFeature, FeatureContext } from './features/types'
import { AudioEngine } from './audioEngine'
import { ReflectiveFloor } from './features/reflectiveFloor'
import { HolographicFish } from './features/fish'
import { CableTangle } from './features/cables'
import { DataRain } from './features/dataRain'
import { DataSpires } from './features/dataSpires'
import { TerminalText } from './features/terminalText'
import { NetworkGraph } from './features/networkGraph'
import { InnerSky } from './features/innerSky'
import { InnerRain } from './features/rain'
import { SidewaysCity } from './features/sidewaysCity'
import { Watcher } from './features/watcher'
import { PenroseStairs } from './features/penroseStairs'
import { Totem } from './features/totem'
import { EnergySlashes } from './features/energySlash'
import { ReiatsuBursts } from './features/reiatsu'
import { BattleStorm } from './features/lightning'
import { PANEL_DATA, type PanelDatum } from './panelData'

// ============================================================================
// COPLAND OS — navigable 3D backdrop
// A full-screen WebGL world the DOM looks into: the eye/circuit logo ahead, a
// cloud of billboarded holographic NAVI panels, a drifting particle field, and
// exponential fog for infinite depth. Drag to look around, scroll to fly
// through. Raycaster drives panel hover/click. The React layer drives boot
// phases (setPhase) and reacts to hover/skip via handlers.
// ============================================================================

export type CoplandPhase = 'logo' | 'boot' | 'welcome' | 'desktop'

export interface HoverInfo {
  label: string
  detail: string
  href?: string
}

export interface CoplandHandlers {
  onActivate?: () => void                 // a tap during boot -> skip to desktop
  onHover?: (info: HoverInfo | null) => void
}

interface Panel {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  datum: PanelDatum
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
  ctx.lineJoin = 'round'

  const cyan = p.phosphorStr // bright iris / nodes
  const blue = p.hologramStr // mid-blue body / brackets
  const setGlow = (color: string, blur: number): void => {
    ctx.shadowColor = color
    ctx.shadowBlur = blur
    ctx.strokeStyle = color
    ctx.fillStyle = color
  }
  const dot = (x: number, y: number, r: number): void => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // soft outer halo
  const halo = ctx.createRadialGradient(0, 0, 40, 0, 0, 460)
  halo.addColorStop(0, 'rgba(90,170,255,0.22)')
  halo.addColorStop(1, 'rgba(90,170,255,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, 460, 0, Math.PI * 2); ctx.fill()

  // big eye-ring (the iris body), open at the bottom where the stem exits
  setGlow(blue, 26)
  ctx.lineWidth = 16
  ctx.beginPath(); ctx.arc(0, -25, 150, 0.62 * Math.PI, 2.38 * Math.PI); ctx.stroke()

  // angular "< >" chevron wings flanking the eye
  setGlow(blue, 24)
  ctx.lineWidth = 22
  const chevron = (s: number): void => {
    ctx.beginPath()
    ctx.moveTo(s * 108, -138)
    ctx.lineTo(s * 218, -46)
    ctx.lineTo(s * 108, 32)
    ctx.stroke()
  }
  chevron(-1); chevron(1)

  // iris ring + bright scan-lined pupil
  setGlow(cyan, 22)
  ctx.lineWidth = 12
  ctx.beginPath(); ctx.arc(0, -55, 74, 0, Math.PI * 2); ctx.stroke()

  const pupil = ctx.createRadialGradient(0, -55, 4, 0, -55, 54)
  pupil.addColorStop(0, '#ffffff')
  pupil.addColorStop(0.45, cyan)
  pupil.addColorStop(1, 'rgba(120,210,255,0.18)')
  ctx.shadowColor = cyan
  ctx.shadowBlur = 40
  ctx.fillStyle = pupil
  ctx.beginPath(); ctx.arc(0, -55, 52, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(18,52,104,0.55)'
  ctx.lineWidth = 5
  for (let yy = -80; yy <= -30; yy += 12) {
    ctx.beginPath(); ctx.moveTo(-48, yy); ctx.lineTo(48, yy); ctx.stroke()
  }

  // bottom circuit stem + diagonal traces to the corner nodes
  setGlow(cyan, 18)
  ctx.lineWidth = 12
  ctx.beginPath(); ctx.moveTo(0, 120); ctx.lineTo(0, 205); ctx.stroke()
  ctx.lineWidth = 9
  ctx.beginPath(); ctx.moveTo(0, 150); ctx.lineTo(-74, 196); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, 150); ctx.lineTo(74, 196); ctx.stroke()

  // node dots: chevron upper tips, bottom corners, stem terminal
  setGlow(cyan, 16)
  dot(-108, -138, 15)
  dot(108, -138, 15)
  dot(-74, 196, 15)
  dot(74, 196, 15)
  dot(0, 205, 12)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function drawPanelTexture(d: PanelDatum, p: ScenePalette): THREE.CanvasTexture {
  const W = 512
  const H = 320
  const { canvas, ctx } = makeCanvas(W, H)
  const accent = d.accent === 'tachibana' ? p.tachibanaStr : d.accent === 'warning' ? p.warningStr : p.phosphorStr

  // frame
  const r = 22
  ctx.beginPath()
  ctx.moveTo(r, 2)
  ctx.arcTo(W - 2, 2, W - 2, H - 2, r)
  ctx.arcTo(W - 2, H - 2, 2, H - 2, r)
  ctx.arcTo(2, H - 2, 2, 2, r)
  ctx.arcTo(2, 2, W - 2, 2, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(16,58,92,0.18)'
  ctx.fill()
  ctx.shadowColor = accent
  ctx.shadowBlur = 16
  ctx.lineWidth = 2.5
  ctx.strokeStyle = accent
  ctx.stroke()
  ctx.shadowBlur = 0

  ctx.textBaseline = 'top'

  // kind tag, top-right
  const tag = d.kind === 'link' ? 'LINK' : d.kind === 'file' ? 'FILE' : d.kind === 'profile' ? 'OPR' : 'SYS'
  ctx.font = '600 18px "TrixieCyrG", ui-monospace, monospace'
  ctx.fillStyle = 'rgba(120,210,255,0.5)'
  ctx.fillText(tag, W - 30 - ctx.measureText(tag).width, 32)

  // label
  ctx.font = '700 30px "TrixieCyrG", ui-monospace, monospace'
  ctx.fillStyle = accent
  ctx.shadowColor = accent
  ctx.shadowBlur = 12
  ctx.fillText(d.label, 30, 26)
  ctx.shadowBlur = 0

  // divider
  ctx.fillStyle = 'rgba(120,210,255,0.4)'
  ctx.fillRect(30, 72, W - 60, 1.5)

  // body lines (a "▸ …" line renders as a highlighted action)
  let y = 100
  for (const line of d.lines) {
    if (line.startsWith('▸')) {
      ctx.font = '700 26px "TrixieCyrG", ui-monospace, monospace'
      ctx.fillStyle = accent
      ctx.shadowColor = accent
      ctx.shadowBlur = 14
      ctx.fillText(line, 30, y + 4)
      ctx.shadowBlur = 0
    } else {
      ctx.font = '400 24px "TrixieCyrG", ui-monospace, monospace'
      ctx.fillStyle = p.phosphorStr
      ctx.fillText(line, 30, y)
    }
    y += 40
  }

  // corner bracket
  ctx.strokeStyle = accent
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(W - 14, H - 30)
  ctx.lineTo(W - 14, H - 14)
  ctx.lineTo(W - 30, H - 14)
  ctx.stroke()

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ---------------------------------------------------------------------------

// Camera eye height above the world origin. The plaza floor is at y = -10, so
// this lifts the viewer well above the ground; the central logo + UI panels are
// offset by the same amount so the interface stays at eye level.
const EYE_HEIGHT = 6

// The fold line (world Y) the overhead mirror reflects the city about; raise to
// push the inverted ceiling-city higher, lower to bring it closer overhead.
const MIRROR_FOLD_Y = 60

// Clone an object hierarchy and flip it vertically about y = foldY so it reads
// as an upside-down mirror twin hanging above ("as above, so below"). Materials
// are cloned to DoubleSide because the negative scale inverts face winding;
// geometry + textures stay shared by reference, so the twin still animates with
// the original (e.g. the city's blinking window lights stay in sync).
function makeVerticalMirror(src: THREE.Object3D, foldY: number): THREE.Group {
  const clone = src.clone(true)
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) {
      mesh.material = mat.map((m) => {
        const c = m.clone()
        c.side = THREE.DoubleSide
        return c
      })
    } else if (mat) {
      const c = mat.clone()
      c.side = THREE.DoubleSide
      mesh.material = c
    }
  })
  const g = new THREE.Group()
  g.add(clone)
  g.scale.set(1, -1, 1)
  g.position.y = foldY * 2
  return g
}

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
  private diveTimer = 0
  private surgeTimer = 3
  private shake = 0
  private surgeFlash = 0
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
  private base = new THREE.Vector3(0, EYE_HEIGHT, 0)
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
  private onContextMenu = (e: Event) => e.preventDefault()

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
    const horizonStr = getComputedStyle(document.documentElement).getPropertyValue('--copland-horizon').trim() || '#1f4068'
    this.scene.fog = new THREE.FogExp2(new THREE.Color(horizonStr).getHex(), 0.018)

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
    this.logo.position.set(0, EYE_HEIGHT, -9)
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
      if (e.button !== 0) return // ignore right / middle click
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
    el.addEventListener('contextmenu', this.onContextMenu)
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

  // Place each panel at a DISTINCT direction from the camera origin so that,
  // billboarded, no two cards stack on the same screen ray (every card stays
  // clickable). Clickable core (links + operator) fills the front arc; lore /
  // flavor wraps around the sides and behind.
  private placePanel(i: number, yawDeg: number, pitchDeg: number, dist: number, near: boolean): void {
    const datum = PANEL_DATA[i]
    const mat = new THREE.MeshBasicMaterial({
      map: drawPanelTexture(datum, this.palette),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    const aspect = 512 / 320
    const hgt = near ? 2.3 : 2.0
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hgt * aspect, hgt), mat)
    const yaw = (yawDeg * Math.PI) / 180
    const pitch = (pitchDeg * Math.PI) / 180
    const baseX = Math.sin(yaw) * Math.cos(pitch) * dist
    const baseY = EYE_HEIGHT + Math.sin(pitch) * dist
    const baseZ = -Math.cos(yaw) * Math.cos(pitch) * dist
    mesh.position.set(baseX, baseY, baseZ)
    this.panels.push({
      mesh,
      mat,
      datum,
      baseX,
      baseY,
      baseZ,
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.25 + Math.random() * 0.35,
      bobAmp: 0.1 + Math.random() * 0.14,
      hover: 0,
    })
    this.scene.add(mesh)
    this.panelMeshes.push(mesh)
  }

  private buildPanels(): void {
    const nearIdx: number[] = []
    const farIdx: number[] = []
    PANEL_DATA.forEach((d, i) => {
      if (d.kind === 'link' || d.kind === 'profile') nearIdx.push(i)
      else farIdx.push(i)
    })

    // front arc: ±40° spread, comfortably spaced and near eye level
    nearIdx.forEach((i, k) => {
      const span = Math.max(1, nearIdx.length - 1)
      const yawDeg = nearIdx.length > 1 ? -40 + (k * 80) / span : 0
      const pitchDeg = k % 2 === 0 ? -7 : 9
      const dist = 6 + (k % 2) * 0.8
      this.placePanel(i, yawDeg, pitchDeg, dist, true)
    })

    // sides + back: 92°..276°, varied height and depth
    farIdx.forEach((i, j) => {
      const yawDeg = 92 + (j * 184) / Math.max(1, farIdx.length)
      const pitchDeg = -18 + ((j * 67) % 44)
      const dist = 9.5 + (j % 3) * 2.4
      this.placePanel(i, yawDeg, pitchDeg, dist, false)
    })
  }

  private buildFeatures(): void {
    this.graph = new NetworkGraph(this.palette)
    const spires = new DataSpires(this.palette)
    this.features = [
      new InnerSky(this.palette),
      new ReflectiveFloor(this.palette),
      new SidewaysCity(this.palette),
      new CableTangle(this.palette),
      new DataRain(this.palette),
      spires,
      new HolographicFish(this.palette),
      new InnerRain(this.palette),
      new BattleStorm(this.palette),
      new Watcher(this.palette),
      new PenroseStairs(this.palette),
      new Totem(this.palette),
      new EnergySlashes(this.palette),
      new ReiatsuBursts(this.palette),
      new TerminalText(this.palette),
      this.graph,
    ]
    for (const f of this.features) this.scene.add(f.group)

    // The top of the world mirrors the bottom: an inverted twin of the city
    // hangs overhead ("as above, so below").
    this.scene.add(makeVerticalMirror(spires.group, MIRROR_FOLD_Y))
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
    if (hits.length === 0) return
    const panel = this.panels.find((p) => p.mesh === hits[0].object)
    if (panel?.datum.href) {
      this.diveTo(hits[0].object.position, panel.datum.href)
    } else {
      this.lookToward(hits[0].object.position)
    }
  }

  // "Wired dive": lunge the camera into the clicked card with a glitch warp,
  // open the link in a background tab, then ease back out.
  private diveTo(worldPos: THREE.Vector3, href: string): void {
    this.lookToward(worldPos)
    const dist = worldPos.distanceTo(this.base)
    this.dollyTarget = THREE.MathUtils.clamp(dist * 0.62, -8, 26)
    this.glitchTimer = 0.5
    this.fogPulse = 0.016
    this.diveTimer = 0.9
    window.open(href, '_blank', 'noopener,noreferrer')
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

    // combat surge: a periodic battle impact — camera shake + flash + glitch
    this.surgeTimer -= dt
    if (this.surgeTimer <= 0) {
      this.surgeTimer = 3.5 + Math.random() * 4
      if (!this.reduced) {
        this.shake = 0.45 + this.audioLevel * 0.5
        this.surgeFlash = 0.8
        if (this.glitchTimer < 0.16) this.glitchTimer = 0.16
      }
    }
    this.shake *= 0.86
    this.surgeFlash *= 0.9

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
    this.camera.position.y = Math.max(this.camera.position.y, -2)
    if (this.shake > 0.002) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake
      this.camera.position.y += (Math.random() - 0.5) * this.shake
      this.camera.position.z += (Math.random() - 0.5) * this.shake * 0.5
    }

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
    if (this.diveTimer > 0) {
      this.diveTimer -= dt
      if (this.diveTimer <= 0) this.dollyTarget = 1.2 // ease back out after the lunge
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
    this.bloom.strength = this.reduced ? 1.0 : 1.2 + this.audioLevel * 0.7 + flick + this.surgeFlash * 1.6
    this.renderer.toneMappingExposure = 1.1 + this.surgeFlash * 0.5

    this.composer.render()
  }

  private updateHover(): void {
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const hits = this.raycaster.intersectObjects(this.panelMeshes, false)
    const hitMesh = hits.length ? hits[0].object : null
    const next = hitMesh ? this.panels.find((p) => p.mesh === hitMesh) ?? null : null
    if (next !== this.hovered) {
      this.hovered = next
      if (next) {
        const dd = next.datum
        const detail = dd.lines[0] ?? ''
        const info: HoverInfo = dd.href ? { label: dd.label, detail, href: dd.href } : { label: dd.label, detail }
        this.handlers.onHover?.(info)
      } else {
        this.handlers.onHover?.(null)
      }
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
    el.removeEventListener('contextmenu', this.onContextMenu)
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
