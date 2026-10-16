import * as THREE from 'three'
import { Pipeline, type PostParams } from './post'
import { buildSky, type SkyResult } from './sky'
import { realmUniforms, SUN_DIRECTION } from './atmosphere'
import { setMaxAnisotropy } from './assets'
import { Walk, heading } from './walk'
import { Ambience } from './ambience'
import { initialQualityState, stepQuality, type QualityState } from './qualityStepper'
import type { Frame, Interactive, RealmPart, Tier } from './types'

// The realm host: renderer, camera, sun, the parts of the island, the walk
// and the frame loop. The page owns one of these for its lifetime.

export interface RealmOptions {
  tier?: Tier
  reducedMotion: boolean
  onReady?: () => void
  onProgress?: (p: number) => void
  onMove?: () => void
  // the device cannot carry the scene even at the lowest step: the page
  // should drop it for the still picture and the written links
  onTooSlow?: () => void
}

interface Prerenderer {
  prerender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void
}

function hasPrerender(p: RealmPart): p is RealmPart & Prerenderer {
  return typeof (p as Partial<Prerenderer>).prerender === 'function'
}

function isInteractive(p: RealmPart): p is RealmPart & Interactive {
  return typeof (p as Partial<Interactive>).tap === 'function'
}

export function detectTier(renderer: THREE.WebGLRenderer): Tier {
  const forced = new URLSearchParams(location.search).get('tier')
  if (forced === 'ultra' || forced === 'high' || forced === 'phone') return forced
  const name = rendererName(renderer)
  // no graphics chip at all: the scene would run on the processor
  if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name)) throw new Error(`software renderer: ${name}`)
  const coarse = window.matchMedia('(pointer: coarse)').matches
  if (coarse && Math.min(screen.width, screen.height) < 900) return 'phone'
  // a visitor saving data, or a small machine, gets the light settings
  const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number }
  if (nav.connection?.saveData) return 'phone'
  if ((nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency || 8) <= 4) return 'phone'
  if (/RTX|RX [67]\d{3}|Radeon Pro|Apple M\d (Pro|Max|Ultra)/i.test(name)) return 'ultra'
  return 'high'
}

function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
}

// frames per second when the screen holds still, and always on phones, where
// the battery and the heat matter more than the last bit of smoothness
const CALM_FPS = 30
const IDLE_AFTER_MS = 12000

const DPR_CAP: Record<Tier, number> = { ultra: 1.5, high: 1.25, phone: 1.6 }

// light through the walk: warm afternoon gold deepening as the sun sinks
const SUN_EARLY = new THREE.Color(1.0, 0.76, 0.5)
const SUN_LATE = new THREE.Color(1.0, 0.6, 0.32)

export class Realm {
  readonly renderer: THREE.WebGLRenderer
  readonly tier: Tier
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private pipeline: Pipeline
  private sun: THREE.DirectionalLight
  private sunColor = new THREE.Color()
  private sky: SkyResult | null = null
  private parts: RealmPart[] = []
  private walk: Walk
  private container: HTMLElement
  private opts: RealmOptions
  private frame: Frame
  private clock = new THREE.Timer()
  private raf = 0
  private disposed = false
  private ready = false
  private resizeObs: ResizeObserver
  private reduced: boolean
  private wakeT = 0
  private dpr = 1
  private dprScale = 1
  private quality: QualityState = initialQualityState('high')
  private fpsAccum = 0
  private fpsFrames = 0
  private lastDraw = 0
  private lastInput = 0
  private readyAt = 0
  private shown = true
  private onScreen = true
  private soundWhenShown = false
  private calm = false
  private tooSlow = 0
  private visibleObs: IntersectionObserver
  private pointerNdc = new THREE.Vector2()
  private pointerActive = false
  private ray = new THREE.Ray()
  private raycaster = new THREE.Raycaster()
  private dir = new THREE.Vector3()
  private look = new THREE.Vector3()
  private parallax = new THREE.Vector2()
  private post: PostParams
  private frameTimes: number[] = []
  private ambience = new Ambience()
  private debugView: { from: THREE.Vector3; to: THREE.Vector3 } | null = null
  // milliseconds per build step, for headless checks
  readonly buildTimes: [string, number][] = []
  private compiling: Promise<unknown>[] = []
  private warming = false
  private lidColor = new THREE.Color()
  private down: { x: number; y: number; t: number } | null = null
  private mouse = false

  constructor(container: HTMLElement, opts: RealmOptions) {
    this.container = container
    this.opts = opts
    this.reduced = opts.reducedMotion
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false })
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV
    this.renderer.toneMapping = THREE.AgXToneMapping
    this.renderer.toneMappingExposure = 1
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.tier = opts.tier ?? detectTier(this.renderer)
    setMaxAnisotropy(Math.min(this.renderer.capabilities.getMaxAnisotropy(), this.tier === 'phone' ? 4 : 16))
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'

    const w = container.clientWidth || window.innerWidth
    const h = container.clientHeight || window.innerHeight
    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 3000)
    this.pipeline = new Pipeline(this.renderer, this.tier)

    // the sun: one static shadow map over the whole island, refreshed only
    // when parts are added
    this.sun = new THREE.DirectionalLight(0xffffff, 10)
    this.sun.castShadow = true
    const size = this.tier === 'ultra' ? 4096 : 2048
    this.sun.shadow.mapSize.set(size, size)
    const sc = this.sun.shadow.camera
    sc.left = -34
    sc.right = 34
    sc.top = 34
    sc.bottom = -34
    sc.near = 1
    sc.far = 200
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.035
    this.sun.shadow.radius = 3
    this.scene.add(this.sun, this.sun.target)

    this.frame = { t: 0, dt: 0, camera: this.camera, pointer: null, progress: 0, motion: this.reduced ? 0 : 1 }
    this.post = {
      exposure: 1,
      fogColor: new THREE.Color(),
      sunFogColor: new THREE.Color(),
      fogDensity: 0.0016,
      fogHeight: -6,
      fogFalloff: 0.09,
      haze: 0.00025,
      bloom: 0.12,
      shafts: 0.35,
      sunColor: new THREE.Color(),
      focusDistance: 20,
      focusRange: 8,
      blur: 0.4,
      vignette: 0.28,
      saturation: 1.12,
      wake: this.reduced ? 1 : 0,
    }

    this.walk = new Walk(this.renderer.domElement, this.reduced, () => this.opts.onMove?.())

    const el = this.renderer.domElement
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointerleave', this.onPointerLeave)
    el.addEventListener('webglcontextlost', this.onContextLost)
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    // nothing is drawn while the tab is hidden or the canvas off screen
    document.addEventListener('visibilitychange', this.onVisibility)
    this.visibleObs = new IntersectionObserver((entries) => {
      this.onScreen = entries.some((e) => e.isIntersecting)
      this.onVisibility()
    })
    this.visibleObs.observe(container)
    for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(type, this.onInput, { passive: true })
  }

  private onInput = () => {
    this.lastInput = performance.now()
  }

  private onVisibility = () => {
    const show = !document.hidden && this.onScreen
    if (show === this.shown) return
    this.shown = show
    if (!show) {
      cancelAnimationFrame(this.raf)
      this.soundWhenShown = this.ambience.on
      if (this.soundWhenShown) this.ambience.setEnabled(false)
    } else if (!this.disposed) {
      this.raf = requestAnimationFrame(this.tick)
      if (this.soundWhenShown) this.ambience.setEnabled(true)
    }
  }

  private onContextLost = (e: Event) => e.preventDefault()

  private onPointerMove = (e: PointerEvent) => {
    const r = this.renderer.domElement.getBoundingClientRect()
    this.pointerNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    this.pointerActive = true
    this.mouse = e.pointerType === 'mouse'
  }

  private onPointerDown = (e: PointerEvent) => {
    this.onPointerMove(e)
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() }
  }

  // a tap is a press that neither moved nor lingered; it has to be handled
  // inside the event so a plaque may open its link in a new tab
  private onPointerUp = (e: PointerEvent) => {
    const d = this.down
    this.down = null
    if (!d || !this.ready) return
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || performance.now() - d.t > 600) return
    this.onPointerMove(e)
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    for (const part of this.parts) {
      if (isInteractive(part) && part.tap(this.raycaster.ray, e.pointerType !== 'mouse')) break
    }
  }

  private onPointerLeave = () => {
    this.pointerActive = false
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP[this.tier]) * this.dprScale
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.pipeline.setSize(w, h, this.dpr)
    this.camera.aspect = w / h
    // keep a minimum horizontal field on tall phone screens
    const vMin = 40
    const hMin = 38
    const v = Math.max(vMin, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hMin / 2)) / this.camera.aspect)))
    this.camera.fov = Math.min(v, 72)
    this.camera.updateProjectionMatrix()
  }

  // add a part and refresh the shadow map so it casts
  add(part: RealmPart): void {
    if (this.disposed) {
      part.dispose()
      return
    }
    this.parts.push(part)
    this.scene.add(part.object)
    this.renderer.shadowMap.needsUpdate = true
    // compile its programs now, in parallel where the browser allows, so the
    // driver works while the next part is being built
    // with the HDR target bound, as when it is drawn, or every program
    // would be built once for the screen and again for the target
    const before = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.pipeline.main)
    this.compiling.push(this.renderer.compileAsync(part.object, this.camera, this.scene).catch(() => {}))
    this.renderer.setRenderTarget(before)
  }

  async start(build: (realm: Realm) => Promise<void>): Promise<void> {
    this.sunColor.copy(SUN_EARLY)
    // the warm dark shows from the first frame, while everything loads
    this.raf = requestAnimationFrame(this.tick)
    const ts = performance.now()
    this.buildTimes.push(['start at', Math.round(ts)])
    this.sky = await buildSky(this.renderer, this.tier, this.sunColor)
    this.buildTimes.push(['sky', Math.round(performance.now() - ts)])
    if (this.disposed) return
    this.scene.add(this.sky.mesh)
    this.scene.environment = this.sky.environment
    this.scene.environmentIntensity = 0.38
    this.placeSun()
    await build(this)
    if (this.disposed) return
    let t0 = performance.now()
    await Promise.all(this.compiling)
    if (this.disposed) return
    this.buildTimes.push(['compile', Math.round(performance.now() - t0)])
    t0 = performance.now()
    // The passes that draw the scene again (reflection, cloud depth) compile
    // their programs on first use, and the walk's later views show things the
    // first view does not. Run a few frames at those views while the eyes are
    // still closed, so the hitches happen in the dark.
    const keep = this.walk.target
    this.warming = true
    for (const p of [0, 0.5, 1, keep]) {
      this.setProgress(p, true)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (this.disposed) return
    }
    this.warming = false
    this.buildTimes.push(['warm-up', Math.round(performance.now() - t0)])
    this.buildTimes.push(['programs', this.renderer.info.programs?.length ?? 0])
    this.buildTimes.push(['ready at', Math.round(performance.now())])
    this.ready = true
    this.readyAt = performance.now()
    this.opts.onReady?.()
  }

  private placeSun(): void {
    this.sun.position.copy(SUN_DIRECTION).multiplyScalar(90)
    this.sun.target.position.set(0, -4, 0)
    this.sun.updateMatrixWorld()
    this.sun.target.updateMatrixWorld()
    this.sun.shadow.camera.updateProjectionMatrix()
    this.renderer.shadowMap.needsUpdate = true
  }

  // used by the page and by headless checks
  setProgress(p: number, immediate = false): void {
    this.walk.target = THREE.MathUtils.clamp(p, 0, 1)
    if (immediate) this.walk.progress = this.walk.target
  }

  // headless checks: look from one point at another instead of the walk
  view(from: [number, number, number] | null, to: [number, number, number] = [0, 0, 0]): void {
    this.debugView = from ? { from: new THREE.Vector3(...from), to: new THREE.Vector3(...to) } : null
  }

  // headless checks: show or hide every part of one kind, to measure it
  setPartVisible(name: string, visible: boolean): string[] {
    const names: string[] = []
    for (const part of this.parts) {
      const n = part.constructor.name
      names.push(n)
      if (n === name) part.object.visible = visible
    }
    return names
  }

  // a link got keyboard focus (or lost it): its plaque turns as on hover
  focusLink(index: number | null): void {
    for (const part of this.parts) {
      const p = part as Partial<{ focusLink(i: number | null): void }>
      if (typeof p.focusLink === 'function') p.focusLink(index)
    }
  }

  // water and wind; call from a click or key handler
  setSound(on: boolean): void {
    this.ambience.setEnabled(on)
  }

  get sound(): boolean {
    return this.ambience.on
  }

  skipWake(): void {
    this.wakeT = 10
  }

  get skyInfo(): SkyResult | null {
    return this.sky
  }

  get isReady(): boolean {
    return this.ready
  }

  get progress(): number {
    return this.walk.progress
  }

  frameStats(): { avg: number; p95: number; count: number } {
    const a = [...this.frameTimes].sort((x, y) => x - y)
    const avg = a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)
    return { avg, p95: a[Math.floor(a.length * 0.95)] ?? 0, count: a.length }
  }

  // a short fade up from dark once the island is there to see
  private wake(dt: number): number {
    if (this.reduced) return 1
    if (!this.ready) return 0
    this.wakeT += dt
    return THREE.MathUtils.smoothstep(this.wakeT, 0, 0.7)
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    // a calm frame rate on phones and whenever nothing moves
    const now = performance.now()
    const settled = now - this.lastInput > IDLE_AFTER_MS && Math.abs(this.walk.target - this.walk.progress) < 1e-3
    const calm = this.ready && (this.tier === 'phone' || settled)
    if (calm && now - this.lastDraw < 1000 / CALM_FPS - 2) return
    this.lastDraw = now
    this.calm = calm
    this.clock.update()
    const raw = this.clock.getDelta()
    const dt = Math.min(raw, 1 / 20)
    const t = this.clock.getElapsed()
    this.sampleFps(raw)

    // Until the island is built and its programs compiled draw only a warm
    // dark. Drawing the scene now would
    // make the driver compile each program the moment it is first used, on
    // this thread, and stall the build for seconds.
    if (!this.ready && !this.warming) {
      // a slow breath of warm light, so a long load never looks frozen
      const breath = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(this.clock.getElapsed() * 1.1)
      this.lidColor.setRGB(0.032 + breath * 0.022, 0.012 + breath * 0.008, 0.007 + breath * 0.004, THREE.SRGBColorSpace)
      this.renderer.setRenderTarget(null)
      this.renderer.setClearColor(this.lidColor, 1)
      this.renderer.clear()
      return
    }
    const pose = this.walk.update(dt)
    const wake = this.wake(dt)
    const p = this.walk.progress

    const breathe = this.reduced ? 0 : 1
    const sway = Math.sin(t * 0.55) * 0.004 + Math.sin(t * 0.31 + 1.3) * 0.003
    if (this.pointerActive && !this.reduced) this.parallax.lerp(this.pointerNdc, 1 - Math.exp(-dt * 2))
    else this.parallax.multiplyScalar(Math.exp(-dt * 1.5))

    this.camera.position.copy(pose.position)
    this.camera.position.y += Math.sin(t * 0.9) * 0.006 * breathe
    const yaw = pose.yaw - this.parallax.x * 0.025 + sway * breathe
    const pitch = pose.pitch + this.parallax.y * 0.015 + Math.sin(t * 0.43) * 0.003 * breathe
    heading(yaw, pitch, this.dir)
    // a tall screen sees less across: near the end, where the plaques must
    // all be in frame, step back along the view to make room
    if (this.camera.aspect < 1) {
      const back = (1 - this.camera.aspect) * 2.2 * THREE.MathUtils.smoothstep(p, 0.86, 1)
      this.camera.position.addScaledVector(this.dir, -back)
    }
    this.look.copy(this.camera.position).add(this.dir)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.look)
    if (this.debugView) {
      this.camera.position.copy(this.debugView.from)
      this.camera.up.set(0, 1, 0)
      this.camera.lookAt(this.debugView.to)
    }
    this.camera.updateMatrixWorld()

    // the pointer as a world ray for the koi, the petals and the plaques
    if (this.pointerActive) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera)
      this.ray.copy(this.raycaster.ray)
      this.frame.pointer = this.ray
    } else {
      this.frame.pointer = null
    }
    let pointing = false
    for (const part of this.parts) {
      if (!isInteractive(part)) continue
      if (this.mouse) part.hover(this.frame.pointer)
      pointing ||= part.pointing && this.mouse
    }
    this.renderer.domElement.style.cursor = pointing ? 'pointer' : 'default'

    realmUniforms.uTime.value = t
    realmUniforms.uGust.value = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.07 + 2.0)

    // the sun sinks through the walk
    this.sunColor.copy(SUN_EARLY).lerp(SUN_LATE, p)
    this.sun.color.copy(this.sunColor)
    this.sun.intensity = 13 - p * 2.5

    this.frame.t = t
    this.frame.dt = dt
    this.frame.progress = p
    for (const part of this.parts) part.update(this.frame)
    this.ambience.update(dt, this.camera.position, realmUniforms.uGust.value)
    for (const part of this.parts) if (hasPrerender(part)) part.prerender(this.renderer, this.scene, this.camera)

    const pp = this.post
    pp.wake = wake
    pp.exposure = 0.68 + p * 0.05
    pp.fogColor.setRGB(0.55, 0.62, 0.74).lerp(new THREE.Color(0.62, 0.56, 0.52), p * 0.6)
    pp.sunFogColor.setRGB(1.0, 0.78, 0.55).multiplyScalar(1.6)
    pp.sunColor.copy(this.sunColor).multiplyScalar(0.9)
    pp.focusDistance = this.debugView ? this.debugView.from.distanceTo(this.debugView.to) : pose.focus
    pp.focusRange = Math.max(1.5, pp.focusDistance * 0.45)
    this.pipeline.render(this.scene, this.camera, pp, SUN_DIRECTION, t)
    this.opts.onProgress?.(p)
  }

  private sampleFps(raw: number): void {
    // a stall from a hidden tab or a background hitch says nothing about the GPU
    if (raw > 0.25) return
    this.frameTimes.push(raw * 1000)
    if (this.frameTimes.length > 240) this.frameTimes.shift()
    this.fpsAccum += raw
    this.fpsFrames++
    if (this.fpsAccum < 1.5) return
    const fps = this.fpsFrames / this.fpsAccum
    this.fpsAccum = 0
    this.fpsFrames = 0
    if (!this.ready) return
    // at the calm rate a frame that keeps up is neither slow nor spare
    const rate = this.calm ? (fps >= CALM_FPS * 0.9 ? 45 : fps) : fps
    const next = stepQuality(this.quality, rate)
    // still far too slow at the lowest step in the first half minute: this
    // device should not be asked to carry the scene at all
    if (next.tier === 'low' && this.quality.tier === 'low' && fps < 14 && performance.now() - this.readyAt < 30000) {
      this.tooSlow++
      if (this.tooSlow >= 2) this.opts.onTooSlow?.()
    }
    if (next.tier !== this.quality.tier) {
      // the tiers here only scale the resolution; the look stays the same
      this.dprScale = next.tier === 'low' ? 0.72 : next.tier === 'high' ? 1 : 1
      this.resize()
    }
    this.quality = next
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    this.visibleObs.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    for (const type of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart']) window.removeEventListener(type, this.onInput)
    this.walk.dispose()
    this.ambience.dispose()
    const el = this.renderer.domElement
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointerleave', this.onPointerLeave)
    el.removeEventListener('webglcontextlost', this.onContextLost)
    for (const part of this.parts) part.dispose()
    this.sky?.dispose()
    this.pipeline.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    el.remove()
  }
}
