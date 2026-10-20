import * as THREE from 'three'
import { Pipeline, type PostParams } from './post'
import { buildSky, sunKnown, type SkyResult } from './sky'
import { prefetchScans } from './rocks'
import { realmUniforms, SUN_DIRECTION } from './atmosphere'
import { prefetchSets, setMaxAnisotropy, upgradeTextures } from './assets'
import { Look, PORTRAIT_TURN, heading, type Place } from './look'
import { pondSdf, POND_LEVEL } from './layout'
import { Ambience } from './ambience'
import { FrameTimer, GpuTimer } from './gpuTimer'
import { MIN_SCALE, WINDOW_SECONDS, initialScale, initialScaleState, percentile, rememberedLevel, stepScale, type ScaleState } from './quality'
import type { Frame, Interactive, RealmPart, Tier } from './types'

// The realm host: renderer, camera, sun, the parts of the island, the look
// and the frame loop. The page owns one of these for its lifetime.

export interface RealmOptions {
  tier?: Tier
  reducedMotion: boolean
  onReady?: () => void
  onProgress?: (p: number) => void
  onMove?: () => void
  // how far the build has come, 0..1, for the page's loading line
  onLoad?: (f: number) => void
  // what the pointer is over: the page draws its own small cursor, which
  // grows over anything that can be clicked and carries a name where one fits
  onCursor?: (state: CursorState) => void
  // the device cannot carry this much garden even at the lowest resolution:
  // the page builds a lighter one, or shows the still picture and the
  // written links when it is already the lightest
  onTooSlow?: () => void
  // the page shows a picture of the start view while the scene loads: no
  // fade from dark, the picture fades out over the first frames instead
  instant?: boolean
}

export type CursorState = 'idle' | 'point' | 'grab'

interface Prerenderer {
  prerender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void
}

function hasPrerender(p: RealmPart): p is RealmPart & Prerenderer {
  return typeof (p as Partial<Prerenderer>).prerender === 'function'
}

function isInteractive(p: RealmPart): p is RealmPart & Interactive {
  return typeof (p as Partial<Interactive>).tap === 'function'
}

// How much garden to build. Every computer starts with all of it; only what
// this device has measured (a lighter level it fell back to before, see
// quality.ts) or the visitor's own wish to save data takes some away. How
// sharp it is drawn is measured live instead (resize, sampleFrame).
export function detectTier(renderer: THREE.WebGLRenderer): Tier {
  const forced = new URLSearchParams(location.search).get('tier')
  if (forced === 'ultra' || forced === 'high' || forced === 'phone') return forced
  const name = rendererName(renderer)
  // no graphics chip at all: the scene would run on the processor
  if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name)) throw new Error(`software renderer: ${name}`)
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } }
  if (nav.connection?.saveData) return 'phone'
  const remembered = rememberedLevel()
  if (remembered) return remembered
  // phones: fewer instances and smaller textures for their memory and data
  const coarse = window.matchMedia('(pointer: coarse)').matches
  if (coarse && Math.min(screen.width, screen.height) < 900) return 'phone'
  return 'ultra'
}

function rendererName(renderer: THREE.WebGLRenderer): string {
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
}

// Frame rates: never above 60, even on fast screens; 30 when the screen holds
// still, and always on phones, where the battery and the heat matter more
// than the last bit of smoothness; nothing at all once the window has been
// in the background for a while and nobody touches it.
const MAX_FPS = 60
const CALM_FPS = 30
const IDLE_AFTER_MS = 12000
const ASLEEP_AFTER_MS = 60000
// headless cost checks measure the frame without the caps
const UNCAPPED = new URLSearchParams(location.search).has('uncapped')
// a fixed share of the screen's resolution, for comparisons and tests
const FIXED_SCALE = Number(new URLSearchParams(location.search).get('scale')) || 0

// the low afternoon sun
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
  private look: Look
  private drag: { x: number; y: number; moved: boolean } | null = null
  private hoveredPlace: Place | null = null
  private lastX = 0
  private baseFov = 50
  private cursorKey = ''
  private lastY = 0
  private placeBoxes: Partial<Record<Place, THREE.Box3>> = {}
  private container: HTMLElement
  private opts: RealmOptions
  private frame: Frame
  private clock = new THREE.Timer()
  private raf = 0
  private disposed = false
  private ready = false
  // a tap on the start view's picture while the scene loads
  private pendingTap: { x: number; y: number; touch: boolean } | null = null
  private resizeObs: ResizeObserver
  private reduced: boolean
  private wakeT = 0
  private dpr = 1
  private dprScale = FIXED_SCALE ? Math.min(1, Math.max(0.25, FIXED_SCALE)) : 1
  private quality: ScaleState = initialScaleState(1)
  private frameTimer: FrameTimer | null = null
  // per frame: the GPU's time where there is a timer, else the time between frames
  private costs: number[] = []
  private windowStart = 0
  private lastWindow = { p75: 0, budget: 0, timed: false }
  private calibration = { ms: 0, scale: 1 }
  private calibrating: number[] | null = null
  private drawStart = 0
  private windowCalm = false
  private pixel = new Uint8Array(4)
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
  private aimPoint = new THREE.Vector3()
  private parallax = new THREE.Vector2()
  private post: PostParams
  private frameTimes: number[] = []
  private ambience = new Ambience()
  private debugView: { from: THREE.Vector3; to: THREE.Vector3 } | null = null
  // milliseconds per build step, for headless checks
  readonly buildTimes: [string, number][] = []
  private compiling: Promise<unknown>[] = []
  // parts are built while the sky loads; their programs compile once its
  // environment is set, so each is built for it only once
  private pendingCompile: THREE.Object3D[] | null = null
  private skyResolve: (sky: SkyResult) => void = () => {}
  readonly skyReady = new Promise<SkyResult>((resolve) => (this.skyResolve = resolve))
  private warming = false
  private lidColor = new THREE.Color()
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
    this.frameTimer = new FrameTimer(this.renderer.getContext() as WebGL2RenderingContext)
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

    this.frame = { t: 0, dt: 0, camera: this.camera, pointer: null, progress: 0, motion: this.reduced ? 0 : 1, sound: this.ambience }
    this.post = {
      exposure: 1,
      fogColor: new THREE.Color(),
      sunFogColor: new THREE.Color(),
      fogDensity: 0.0022,
      fogHeight: -6,
      fogFalloff: 0.09,
      haze: 0.00042,
      bloom: 0.16,
      shafts: 0.5,
      sunColor: new THREE.Color(),
      focusDistance: 20,
      focusRange: 8,
      blur: 0.4,
      vignette: 0.28,
      saturation: 1.12,
      wake: this.reduced ? 1 : 0,
    }

    this.look = new Look(this.reduced)
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('popstate', this.onPopState)

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
    const d = this.drag
    if (d) {
      // a press that travels is a drag: it turns the head
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) {
        d.moved = true
        this.opts.onMove?.()
      }
      if (d.moved) this.look.dragBy(-(e.clientX - this.lastX) / Math.max(1, r.width), (e.clientY - this.lastY) / Math.max(1, r.height))
    } else if (this.mouse) {
      this.look.setAim(this.pointerNdc.x, this.pointerNdc.y)
      if (Math.abs(this.pointerNdc.x) > 0.3) this.opts.onMove?.()
    }
    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  private onPointerDown = (e: PointerEvent) => {
    this.onPointerMove(e)
    this.drag = { x: e.clientX, y: e.clientY, moved: false }
    this.renderer.domElement.setPointerCapture?.(e.pointerId)
  }

  // a tap is a press that did not travel; it has to be handled inside the
  // event so a plaque may open its link in a new tab
  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag
    this.drag = null
    if (!d || d.moved) return
    if (!this.ready) {
      this.pendingTap = { x: e.clientX, y: e.clientY, touch: e.pointerType !== 'mouse' }
      return
    }
    this.onPointerMove(e)
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    this.click(this.raycaster.ray, e.pointerType !== 'mouse')
  }

  private click(ray: THREE.Ray, touch: boolean): void {
    this.opts.onMove?.()
    const at = this.look.place
    if (at === null) {
      const place = this.pickPlace(ray)
      if (place) this.visit(place)
      return
    }
    if (at === 'rack') {
      for (const part of this.parts) if (isInteractive(part) && part.tap(ray, touch)) return
    }
    if (at === 'pond') {
      const hit = this.pondPoint(ray)
      if (hit) {
        this.findPart<{ drop(x: number, z: number): void }>('Pond')?.drop(hit.x, hit.z)
        return
      }
    }
    // at the shrine a click by the bell rope, in the middle of the hall's
    // front, rings the bell (with sound on); anywhere else goes home
    if (at === 'shrine' && Math.abs(this.pointerNdc.x) < 0.22 && this.pointerNdc.y > -0.45) {
      this.ambience.bell()
      return
    }
    // any other click in a close view goes home
    this.leave()
  }

  // fly to a place, with a step in the browser's history so back returns
  visit(place: Place | null): void {
    if (place === this.look.place) return
    if (place && !this.look.place) history.pushState({ sandoPlace: place }, '')
    else if (place) history.replaceState({ sandoPlace: place }, '')
    this.look.go(place)
  }

  private leave(): void {
    if ((history.state as { sandoPlace?: string } | null)?.sandoPlace) history.back()
    else this.look.go(null)
  }

  private onPopState = () => {
    const place = (history.state as { sandoPlace?: Place } | null)?.sandoPlace ?? null
    this.look.go(place)
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.look.place) this.leave()
  }

  private findPart<T>(name: string): (RealmPart & T) | null {
    for (const part of this.parts) {
      const inner = (part as { inner?: RealmPart }).inner ?? part
      if (inner.kind === name) return inner as RealmPart & T
    }
    return null
  }

  // the world box a place is picked by, from its part, once it is built
  private placeBox(place: Place): THREE.Box3 | null {
    if (place === 'pond') return null
    let box = this.placeBoxes[place]
    if (!box) {
      const name = place === 'rack' ? 'EmaRack' : 'Shrine'
      const part = this.findPart(name)
      if (!part) return null
      box = new THREE.Box3().setFromObject(part.object)
      this.placeBoxes[place] = box
    }
    return box
  }

  private pondPoint(ray: THREE.Ray): THREE.Vector3 | null {
    if (Math.abs(ray.direction.y) < 1e-3) return null
    const t = (POND_LEVEL - ray.origin.y) / ray.direction.y
    if (t <= 0 || t > 40) return null
    const hit = ray.at(t, new THREE.Vector3())
    return pondSdf(hit.x, hit.z) < 0 ? hit : null
  }

  // the nearest place under a ray from the centre
  private pickPlace(ray: THREE.Ray): Place | null {
    let best: Place | null = null
    let bestD = Infinity
    const v = new THREE.Vector3()
    for (const place of ['rack', 'shrine'] as const) {
      const box = this.placeBox(place)
      if (box && ray.intersectBox(box, v)) {
        const d = v.distanceTo(ray.origin)
        if (d < bestD) {
          bestD = d
          best = place
        }
      }
    }
    const water = this.pondPoint(ray)
    if (water && water.distanceTo(ray.origin) < bestD) best = 'pond'
    return best
  }

  private onPointerLeave = () => {
    this.pointerActive = false
    this.look.setAim(null)
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    // the screen's own density, less only what this device measured
    this.dpr = (window.devicePixelRatio || 1) * this.dprScale
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
    this.baseFov = Math.min(v, 72)
    this.camera.fov = this.baseFov
    this.camera.updateProjectionMatrix()
    // the same screens that get the tall poster (see POSTERS in Sando.tsx)
    this.look.centreTurn = this.camera.aspect < 17 / 18 ? PORTRAIT_TURN : 0
    this.look.tall = this.camera.aspect < 1
  }

  // add a part and refresh the shadow map so it casts
  add(part: RealmPart): void {
    if (this.disposed) {
      part.dispose()
      return
    }
    this.parts.push(part)
    this.opts.onLoad?.(Math.min(0.92, this.parts.length / 22))
    this.scene.add(part.object)
    this.renderer.shadowMap.needsUpdate = true
    // compile its programs now, in parallel where the browser allows, so the
    // driver works while the next part is being built
    // with the HDR target bound, as when it is drawn, or every program
    // would be built once for the screen and again for the target
    if (this.pendingCompile) this.pendingCompile.push(part.object)
    else this.compile(part.object)
  }

  private compile(object: THREE.Object3D): void {
    const before = this.renderer.getRenderTarget()
    this.renderer.setRenderTarget(this.pipeline.main)
    this.compiling.push(this.renderer.compileAsync(object, this.camera, this.scene).catch(() => {}))
    this.renderer.setRenderTarget(before)
  }

  async start(build: (realm: Realm) => Promise<void>): Promise<void> {
    this.sunColor.copy(SUN_EARLY)
    // the warm dark shows from the first frame, while everything loads
    this.raf = requestAnimationFrame(this.tick)
    const ts = performance.now()
    this.buildTimes.push(['start at', Math.round(ts)])
    prefetchSets(this.tier)
    prefetchScans(this.tier)
    // the sky loads while the island is built; the build only needs the
    // sun's direction, which comes before the sky's images
    this.pendingCompile = []
    const sky = buildSky(this.renderer, this.tier, this.sunColor).then((s) => {
      if (this.disposed) return
      this.sky = s
      this.buildTimes.push(['sky', Math.round(performance.now() - ts)])
      this.scene.add(s.mesh)
      this.scene.environment = s.environment
      this.scene.environmentIntensity = 0.38
      this.placeSun()
      this.skyResolve(s)
      const pending = this.pendingCompile ?? []
      this.pendingCompile = null
      for (const o of pending) this.compile(o)
    })
    await Promise.race([sunKnown, sky])
    if (this.disposed) return
    this.placeSun()
    await build(this)
    await sky
    if (this.disposed) return
    let t0 = performance.now()
    await Promise.all(this.compiling)
    if (this.disposed) return
    this.buildTimes.push(['compile', Math.round(performance.now() - t0)])
    t0 = performance.now()
    // The passes that draw the scene again (reflection, cloud depth) compile
    // their programs on first use, and the close views show things the centre
    // does not. Run a few frames at each while the screen is still dark, so
    // the hitches happen unseen.
    this.warming = true
    for (const place of ['rack', 'pond', 'shrine', null] as const) {
      this.look.go(place, true)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (this.disposed) return
    }
    if (!FIXED_SCALE) await this.calibrate()
    if (this.disposed) return
    this.warming = false
    this.buildTimes.push(['warm-up', Math.round(performance.now() - t0)])
    this.buildTimes.push(['programs', this.renderer.info.programs?.length ?? 0])
    this.buildTimes.push(['ready at', Math.round(performance.now())])
    this.ready = true
    this.readyAt = performance.now()
    this.opts.onLoad?.(1)
    this.opts.onReady?.()
    // the plaques sway once, so the eye finds the rack without a word
    this.findPart<{ greet(): void }>('EmaRack')?.greet()
    const tap = this.pendingTap
    this.pendingTap = null
    if (tap) {
      const rect = this.renderer.domElement.getBoundingClientRect()
      this.pointerNdc.set(((tap.x - rect.left) / rect.width) * 2 - 1, -((tap.y - rect.top) / rect.height) * 2 + 1)
      this.raycaster.setFromCamera(this.pointerNdc, this.camera)
      this.click(this.raycaster.ray, tap.touch)
    }
    // the 2k close-up textures, one upload per frame, now that it shows
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    void upgradeTextures(this.tier, frame).then(() => this.buildTimes.push(['2k done at', Math.round(performance.now())]))
  }

  // The first number for quality.ts: a few frames of the start view at the
  // screen's full resolution, each waited for until the GPU is done, while
  // the screen is still dark. A frame costs the GPU's own time where there is
  // a timer; else the larger of the processor's part and the wait for the
  // GPU after it, since the two overlap in a running loop. The first frames
  // may still carry first-use work.
  private async calibrate(): Promise<void> {
    this.calibrating = []
    for (let i = 0; i < 8; i++) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const ms = this.calibrating.slice(2)
    this.calibrating = null
    if (this.disposed || !ms.length) return
    // the lower quarter: a frame that also waited on a late upload or a
    // clock still rising says less about this device than the quick ones
    const cost = percentile(ms, 0.25)
    const budget = this.frameBudget(true)
    const scale = initialScale(cost, budget)
    this.calibration = { ms: Math.round(cost * 10) / 10, scale }
    this.buildTimes.push(['frame at full resolution', this.calibration.ms], ['scale', Math.round(scale * 1000) / 1000])
    this.quality = initialScaleState(scale)
    if (scale !== this.dprScale) {
      this.dprScale = scale
      this.resize()
    }
  }

  // what one frame may take: phones and a still screen run at the calm rate;
  // the GPU's own time is held to the full rate on a computer either way,
  // so it is ready the moment the visitor moves
  private frameBudget(timed: boolean): number {
    return 1000 / (this.tier === 'phone' || (this.calm && !timed) ? CALM_FPS : MAX_FPS)
  }

  // the measured quality, for `?debug` and headless checks
  get qualityInfo(): { tier: Tier; scale: number; dpr: number; calibration: { ms: number; scale: number }; window: { p75: number; budget: number; timed: boolean }; timer: boolean } {
    return { tier: this.tier, scale: this.dprScale, dpr: this.dpr, calibration: this.calibration, window: this.lastWindow, timer: !!this.frameTimer?.available }
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
    this.look.go(p > 0.9 ? 'rack' : null, immediate)
    this.onInput()
  }

  // headless checks: look from one point at another instead of the walk
  view(from: [number, number, number] | null, to: [number, number, number] = [0, 0, 0]): void {
    this.debugView = from ? { from: new THREE.Vector3(...from), to: new THREE.Vector3(...to) } : null
    this.onInput()
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
    if (index !== null) this.visit('rack')
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

  // headless cost checks: GPU milliseconds per section of the frame
  gpuTimes(reset = false): Record<string, number> | null {
    if (!this.pipeline.timer) this.pipeline.timer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext)
    if (!this.pipeline.timer.available) return null
    if (reset) this.pipeline.timer.reset()
    return this.pipeline.timer.report()
  }

  // where the eyes are: null at the centre, else the close view
  get place(): Place | null {
    return this.look.place
  }

  // headless checks: project a world point to the screen, in CSS pixels
  toScreen(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    const r = this.renderer.domElement.getBoundingClientRect()
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }
  }

  get isReady(): boolean {
    return this.ready
  }

  get progress(): number {
    return this.look.place === 'rack' ? this.look.closeness : 0
  }

  frameStats(): { avg: number; p95: number; count: number } {
    const a = [...this.frameTimes].sort((x, y) => x - y)
    const avg = a.reduce((s, v) => s + v, 0) / Math.max(1, a.length)
    return { avg, p95: a[Math.floor(a.length * 0.95)] ?? 0, count: a.length }
  }

  // a short fade up from dark once the island is there to see
  private wake(dt: number): number {
    if (this.reduced || this.opts.instant) return this.ready ? 1 : 0
    if (!this.ready) return 0
    this.wakeT += dt
    return THREE.MathUtils.smoothstep(this.wakeT, 0, 0.7)
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (this.ready && !UNCAPPED) {
      const quiet = now - this.lastInput
      const settled = quiet > IDLE_AFTER_MS && this.look.settled
      if (!document.hasFocus() && quiet > ASLEEP_AFTER_MS) return
      this.calm = this.tier === 'phone' || settled
      // hold the beat: a 144 Hz screen alternates gaps of two and three
      // refreshes instead of dropping to 48 frames a second
      const interval = 1000 / (this.calm ? CALM_FPS : MAX_FPS)
      if (now - this.lastDraw < interval - 1.5) return
      this.lastDraw = Math.max(this.lastDraw + interval, now - interval)
    }
    this.clock.update()
    const raw = this.clock.getDelta()
    const dt = Math.min(raw, 1 / 20)
    const t = this.clock.getElapsed()
    this.sampleFrame(raw)

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
    const pose = this.look.update(dt)
    const wake = this.wake(dt)
    // the light of the garden's one hour; the walk once moved it on
    const p = 0

    const breathe = this.reduced ? 0 : 1
    const sway = Math.sin(t * 0.55) * 0.004 + Math.sin(t * 0.31 + 1.3) * 0.003
    if (this.pointerActive && !this.reduced) this.parallax.lerp(this.pointerNdc, 1 - Math.exp(-dt * 2))
    else this.parallax.multiplyScalar(Math.exp(-dt * 1.5))

    this.camera.position.copy(pose.position)
    this.camera.position.y += Math.sin(t * 0.9) * 0.006 * breathe
    const yaw = pose.yaw - this.parallax.x * 0.025 + sway * breathe
    const pitch = pose.pitch + this.parallax.y * 0.015 + Math.sin(t * 0.43) * 0.003 * breathe
    heading(yaw, pitch, this.dir)
    this.aimPoint.copy(this.camera.position).add(this.dir)
    this.camera.up.set(0, 1, 0)
    this.camera.lookAt(this.aimPoint)
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
    // from the centre the places answer the pointer; at the rack the plaques
    let pointing = false
    const centre = this.look.place === null
    this.hoveredPlace = centre && this.mouse && this.frame.pointer && !this.drag?.moved ? this.pickPlace(this.frame.pointer) : null
    for (const part of this.parts) {
      if (!isInteractive(part)) continue
      const live = this.look.place === 'rack' || centre
      if (this.mouse) part.hover(live ? this.frame.pointer : null)
      pointing ||= part.pointing && this.mouse && this.look.place === 'rack'
    }
    pointing ||= this.hoveredPlace !== null
    // the page draws the cursor over the scene; the system one stays hidden
    this.renderer.domElement.style.cursor = this.mouse ? 'none' : 'default'
    const state: CursorState = this.drag?.moved ? 'grab' : pointing ? 'point' : 'idle'
    if (state !== this.cursorKey) {
      this.cursorKey = state
      this.opts.onCursor?.(state)
    }

    realmUniforms.uTime.value = t
    realmUniforms.uGust.value = 0.5 + 0.5 * Math.sin(t * 0.13) * Math.sin(t * 0.07 + 2.0)

    // the sun sinks through the walk
    this.sunColor.copy(SUN_EARLY).lerp(SUN_LATE, p)
    this.sun.color.copy(this.sunColor)
    this.sun.intensity = 13 - p * 2.5

    this.frame.t = t
    this.frame.dt = dt
    this.frame.progress = p
    this.drawStart = performance.now()
    for (const part of this.parts) part.update(this.frame)
    this.ambience.update(dt, this.camera.position, realmUniforms.uGust.value)
    const timer = this.pipeline.timer ? null : this.frameTimer
    timer?.begin()
    for (const part of this.parts) {
      if (!hasPrerender(part)) continue
      this.pipeline.timer?.begin((part as { label?: string }).label ?? part.constructor.name)
      part.prerender(this.renderer, this.scene, this.camera)
    }

    const pp = this.post
    pp.wake = wake
    pp.exposure = 0.68 + p * 0.05
    pp.fogColor.setRGB(0.55, 0.62, 0.74).lerp(new THREE.Color(0.62, 0.56, 0.52), p * 0.6)
    pp.sunFogColor.setRGB(1.0, 0.78, 0.55).multiplyScalar(1.6)
    pp.sunColor.copy(this.sunColor).multiplyScalar(0.9)
    pp.focusDistance = this.debugView ? this.debugView.from.distanceTo(this.debugView.to) : pose.focus
    pp.focusRange = Math.max(1.5, pp.focusDistance * 0.45)
    this.pipeline.render(this.scene, this.camera, pp, SUN_DIRECTION, t)
    timer?.end()
    if (this.calibrating) {
      const cpu = performance.now() - this.drawStart
      const gl = this.renderer.getContext()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.pixel)
      const total = performance.now() - this.drawStart
      const gpu: number[] = []
      timer?.collect(gpu)
      this.calibrating.push(gpu.length ? Math.max(cpu, gpu[gpu.length - 1]!) : Math.max(cpu, total - cpu))
    }
    this.opts.onProgress?.(p)
  }

  private sampleFrame(raw: number): void {
    // a stall from a hidden tab or a background hitch says nothing about the GPU
    if (raw > 0.25) return
    this.frameTimes.push(raw * 1000)
    if (this.frameTimes.length > 240) this.frameTimes.shift()
    if (!this.ready || FIXED_SCALE || UNCAPPED) return
    const timed = !!this.frameTimer?.available && !this.pipeline.timer
    if (timed) this.frameTimer!.collect(this.costs)
    else this.costs.push(raw * 1000)
    // frame gaps at the calm rate say nothing about the full rate
    if (!timed && this.calm && this.tier !== 'phone') this.windowCalm = true
    const now = performance.now()
    if (now - this.windowStart < WINDOW_SECONDS * 1000) return
    this.windowStart = now
    const costs = this.costs
    const calm = this.windowCalm
    this.costs = []
    this.windowCalm = false
    if (costs.length < 8 || calm) return
    const budget = this.frameBudget(timed)
    const p75 = percentile(costs, 0.75)
    this.lastWindow = { p75: Math.round(p75 * 100) / 100, budget: Math.round(budget * 100) / 100, timed }
    const next = stepScale(this.quality, this.lastWindow)
    // still far too slow at the lowest resolution in the first minute
    if (next.scale <= MIN_SCALE + 1e-9 && p75 > budget * 2 && now - this.readyAt < 60000) {
      this.tooSlow++
      if (this.tooSlow >= 2) this.opts.onTooSlow?.()
    } else {
      this.tooSlow = 0
    }
    if (next.scale !== this.quality.scale) {
      this.dprScale = next.scale
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
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('popstate', this.onPopState)
    this.ambience.dispose()
    const el = this.renderer.domElement
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointerleave', this.onPointerLeave)
    el.removeEventListener('webglcontextlost', this.onContextLost)
    for (const part of this.parts) part.dispose()
    this.sky?.dispose()
    this.frameTimer?.dispose()
    this.pipeline.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    el.remove()
  }
}
