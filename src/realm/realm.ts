import * as THREE from 'three'
import { Pipeline, type PostParams } from './post'
import { buildSky, type SkyResult } from './sky'
import { realmUniforms, SUN_DIRECTION } from './atmosphere'
import { setMaxAnisotropy } from './assets'
import { Walk, heading } from './walk'
import { initialQualityState, stepQuality, type QualityState } from './qualityStepper'
import type { Frame, Interactive, RealmPart, Tier } from './types'

// The realm host: renderer, camera, sun, the parts of the island, the walk
// and the frame loop. The page owns one of these for its lifetime.

export interface RealmOptions {
  tier?: Tier
  reducedMotion: boolean
  onReady?: () => void
  onProgress?: (p: number) => void
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
  const coarse = window.matchMedia('(pointer: coarse)').matches
  if (coarse && Math.min(screen.width, screen.height) < 900) return 'phone'
  const gl = renderer.getContext()
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
  if (/RTX|RX [67]\d{3}|Radeon Pro|Apple M\d (Pro|Max|Ultra)/i.test(name)) return 'ultra'
  return 'high'
}

const DPR_CAP: Record<Tier, number> = { ultra: 2, high: 1.5, phone: 1.6 }

// light through the walk: warm afternoon gold deepening as the sun sinks
const SUN_EARLY = new THREE.Color(1.0, 0.86, 0.68)
const SUN_LATE = new THREE.Color(1.0, 0.66, 0.38)

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
  private pointerNdc = new THREE.Vector2()
  private pointerActive = false
  private ray = new THREE.Ray()
  private raycaster = new THREE.Raycaster()
  private dir = new THREE.Vector3()
  private look = new THREE.Vector3()
  private parallax = new THREE.Vector2()
  private post: PostParams
  private frameTimes: number[] = []
  private debugView: { from: THREE.Vector3; to: THREE.Vector3 } | null = null
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
      bloom: 0.02,
      shafts: 0.35,
      sunColor: new THREE.Color(),
      focusDistance: 20,
      focusRange: 8,
      blur: 0.4,
      vignette: 0.28,
      saturation: 1.04,
      wake: this.reduced ? 1 : 0,
    }

    this.walk = new Walk(this.renderer.domElement, this.reduced, () => {
      // any input skips the waking
      if (this.wakeT < 4.5) this.wakeT = Math.max(this.wakeT, 4.5)
    })

    const el = this.renderer.domElement
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointerleave', this.onPointerLeave)
    el.addEventListener('webglcontextlost', this.onContextLost)
    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
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
  }

  async start(build: (realm: Realm) => Promise<void>): Promise<void> {
    this.sunColor.copy(SUN_EARLY)
    this.sky = await buildSky(this.renderer, this.tier, this.sunColor)
    if (this.disposed) return
    this.scene.add(this.sky.mesh)
    this.scene.environment = this.sky.environment
    this.scene.environmentIntensity = 0.45
    this.placeSun()
    // the first frame can show while the island is still building
    this.raf = requestAnimationFrame(this.tick)
    await build(this)
    if (this.disposed) return
    this.renderer.compile(this.scene, this.camera)
    this.ready = true
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

  private wake(dt: number): number {
    if (this.reduced) return 1
    this.wakeT += dt
    const t = this.wakeT
    // eyes open part way, close once, then open for good
    if (t < 0.4) return 0
    if (t < 1.4) return THREE.MathUtils.smootherstep(t, 0.4, 1.4) * 0.42
    if (t < 1.75) return 0.42 - THREE.MathUtils.smoothstep(t, 1.4, 1.75) * 0.3
    if (t < 4.5) return 0.12 + THREE.MathUtils.smootherstep(t, 1.75, 4.5) * 0.88
    return 1
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    this.clock.update()
    const raw = this.clock.getDelta()
    const dt = Math.min(raw, 1 / 20)
    const t = this.clock.getElapsed()
    this.sampleFps(raw)

    const pose = this.walk.update(dt)
    const wake = this.wake(dt)
    const p = this.walk.progress

    // the first breath: lying a little lower, head tilted, rising and
    // levelling as the eyes open
    const sleep = 1 - THREE.MathUtils.smootherstep(wake, 0, 1)
    const breathe = this.reduced ? 0 : 1
    const sway = Math.sin(t * 0.55) * 0.004 + Math.sin(t * 0.31 + 1.3) * 0.003
    if (this.pointerActive && !this.reduced) this.parallax.lerp(this.pointerNdc, 1 - Math.exp(-dt * 2))
    else this.parallax.multiplyScalar(Math.exp(-dt * 1.5))

    this.camera.position.copy(pose.position)
    this.camera.position.y += -sleep * 0.55 + Math.sin(t * 0.9) * 0.006 * breathe
    const yaw = pose.yaw - this.parallax.x * 0.025 + sway * breathe
    const pitch = pose.pitch + this.parallax.y * 0.015 + sleep * 0.22 + Math.sin(t * 0.43) * 0.003 * breathe
    heading(yaw, pitch, this.dir)
    this.look.copy(this.camera.position).add(this.dir)
    this.camera.up.set(Math.sin(sleep * 0.12), 1, 0).normalize()
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
    this.sun.intensity = 10.5 - p * 2.5

    this.frame.t = t
    this.frame.dt = dt
    this.frame.progress = p
    for (const part of this.parts) part.update(this.frame)
    for (const part of this.parts) if (hasPrerender(part)) part.prerender(this.renderer, this.scene, this.camera)

    const pp = this.post
    pp.wake = wake
    pp.exposure = (0.68 + p * 0.05) * (0.35 + 0.65 * THREE.MathUtils.smoothstep(wake, 0, 0.8))
    pp.fogColor.setRGB(0.55, 0.62, 0.74).lerp(new THREE.Color(0.62, 0.56, 0.52), p * 0.6)
    pp.sunFogColor.setRGB(1.0, 0.78, 0.55).multiplyScalar(1.6)
    pp.sunColor.copy(this.sunColor).multiplyScalar(0.9)
    pp.focusDistance = this.debugView ? this.debugView.from.distanceTo(this.debugView.to) : pose.focus
    pp.focusRange = Math.max(1.5, pp.focusDistance * 0.45)
    this.pipeline.render(this.scene, this.camera, pp, SUN_DIRECTION, t)
    this.opts.onProgress?.(p)
  }

  private sampleFps(raw: number): void {
    this.frameTimes.push(raw * 1000)
    if (this.frameTimes.length > 240) this.frameTimes.shift()
    this.fpsAccum += raw
    this.fpsFrames++
    if (this.fpsAccum < 1.5) return
    const fps = this.fpsFrames / this.fpsAccum
    this.fpsAccum = 0
    this.fpsFrames = 0
    if (!this.ready) return
    const next = stepQuality(this.quality, fps)
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
    this.walk.dispose()
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
