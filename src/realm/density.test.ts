import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tier } from './types'

// A stand-in for the browser and the WebGL renderer, so the realm runs in node.
// The garden on a fast laptop was once drawn at 39% of its pixels, by a level guessed from the GPU's name and the core
// count and a cap on the density (Safari reports every Mac as "Apple GPU" with 4 or 8 cores), and phones were picked by
// their pointer and screen. How sharp and how much garden come from the frames this device measures, never from what
// it says it is.
const fake = vi.hoisted(() => {
  const listeners = () => {
    const on = new Map<string, Set<(e: Event) => void>>()
    return {
      addEventListener: (type: string, fn: (e: Event) => void) => {
        if (!on.has(type)) on.set(type, new Set())
        on.get(type)!.add(fn)
      },
      removeEventListener: (type: string, fn: (e: Event) => void) => void on.get(type)?.delete(fn),
      dispatch: (type: string) => {
        for (const fn of on.get(type) ?? []) fn({ type, preventDefault: () => {} } as Event)
      },
    }
  }
  const state = { renderers: [] as FakeRenderer[], gpuName: '' }
  class FakeRenderer {
    debug = { checkShaderErrors: false }
    shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false }
    capabilities = { getMaxAnisotropy: () => 16 }
    domElement = Object.assign(listeners(), { style: {} as Record<string, string>, remove: vi.fn() })
    dispose = vi.fn()
    forceContextLoss = vi.fn()
    setPixelRatio = vi.fn()
    setSize = vi.fn()
    params: Record<string, unknown>
    constructor(params: Record<string, unknown> = {}) {
      this.params = params
      state.renderers.push(this)
    }
    getContext() {
      // the name the graphics driver reports, the way WEBGL_debug_renderer_info gives it
      return { getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 0x9246 }), getParameter: () => state.gpuName }
    }
  }
  return { listeners, state, FakeRenderer }
})

vi.mock('three', async (importOriginal) => ({ ...(await importOriginal<typeof import('three')>()), WebGLRenderer: fake.FakeRenderer }))

beforeEach(() => {
  fake.state.renderers.length = 0
  fake.state.gpuName = ''
  vi.stubGlobal('location', { search: '' })
  const kept = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, String(v)),
    removeItem: (k: string) => void kept.delete(k),
  })
  vi.stubGlobal('window', Object.assign(fake.listeners(), { matchMedia: () => ({ matches: false }), innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, setTimeout, clearTimeout }))
  vi.stubGlobal('document', Object.assign(fake.listeners(), { hidden: false, documentElement: { dataset: { season: 'none' } } }))
  vi.stubGlobal('screen', { width: 1920, height: 1080 })
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const container = () => ({ appendChild: vi.fn(), clientWidth: 800, clientHeight: 600 }) as unknown as HTMLElement

const wide = (w: number, h: number, dpr: number) => {
  vi.stubGlobal('window', Object.assign(fake.listeners(), { matchMedia: () => ({ matches: false }), innerWidth: w, innerHeight: h, devicePixelRatio: dpr, setTimeout, clearTimeout }))
  vi.stubGlobal('screen', { width: w, height: h })
  return { appendChild: vi.fn(), clientWidth: w, clientHeight: h } as unknown as HTMLElement
}

// what devices report about themselves, none of which may change the level
const DEVICES = {
  'a desktop reporting an RTX card': { gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0, D3D11)', cores: 16, memory: 8, coarse: false, screen: [2560, 1440] },
  'a MacBook in Safari': { gpu: 'Apple GPU', cores: 8, memory: undefined, coarse: false, screen: [1512, 982] },
  'a laptop reporting 4 cores and 4 GB': { gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', cores: 4, memory: 4, coarse: false, screen: [1536, 864] },
  'a phone': { gpu: 'Apple GPU', cores: 4, memory: undefined, coarse: true, screen: [393, 852] },
  'a computer without a graphics chip': { gpu: 'Google SwiftShader', cores: 8, memory: 8, coarse: false, screen: [1440, 900] },
} as const
type Device = keyof typeof DEVICES
const NAMES = Object.keys(DEVICES) as Device[]

function be(device: Device) {
  const d = DEVICES[device]
  fake.state.gpuName = d.gpu
  vi.stubGlobal('navigator', { hardwareConcurrency: d.cores, deviceMemory: d.memory })
  vi.stubGlobal('window', Object.assign(fake.listeners(), { matchMedia: (q: string) => ({ matches: d.coarse && q.includes('coarse') }), innerWidth: d.screen[0], innerHeight: d.screen[1], devicePixelRatio: 2, setTimeout, clearTimeout }))
  vi.stubGlobal('screen', { width: d.screen[0], height: d.screen[1] })
}

// one window of frames at full resolution, timed, with plenty of room under a 60 a second budget
const ROOMY = { p75: 4, budget: 1000 / 60, timed: true }

describe('how much garden a visit builds', () => {
  it.each(NAMES)('builds the base level on the first visit of %s', async (device) => {
    be(device)
    const { detectTier } = await import('./realm')
    expect(detectTier()).toBe('phone')
  })

  it.each(NAMES)('builds one level more after a visit of %s had room at full resolution', async (device) => {
    be(device)
    const { detectTier } = await import('./realm')
    const { levelAfter, rememberLevel } = await import('./quality')
    // a visit runs its windows; the level for the next one is kept once there was room long enough
    const visit = (tier: Tier) => {
      let roomy = 0
      for (let i = 0; i < 4; i++) {
        const up = levelAfter(tier, roomy, 1, ROOMY)
        roomy = up.roomy
        if (up.next) rememberLevel(up.next)
      }
    }
    expect(detectTier()).toBe('phone')
    visit('phone')
    expect(detectTier()).toBe('high')
    visit('high')
    expect(detectTier()).toBe('ultra')
  })

  it('does not build more after windows below full resolution or without room', async () => {
    const { levelAfter } = await import('./quality')
    let roomy = 0
    for (let i = 0; i < 6; i++) {
      const sharp = levelAfter('phone', roomy, 0.9, ROOMY)
      expect(sharp.next).toBeNull()
      roomy = sharp.roomy
    }
    const tight = levelAfter('phone', 2, 1, { ...ROOMY, p75: 15 })
    expect(tight).toEqual({ roomy: 0, next: null })
  })

  it.each(NAMES)('builds one level less after %s measured too slow', async (device) => {
    be(device)
    const { detectTier } = await import('./realm')
    const { lighterLevel, rememberLevel } = await import('./quality')
    rememberLevel('ultra')
    expect(detectTier()).toBe('ultra')
    // what the page does when the realm says the lowest resolution is still far too slow (Sando.tsx onTooSlow)
    rememberLevel(lighterLevel('ultra')!)
    expect(detectTier()).toBe('high')
  })

  it.each(NAMES)('builds one level less on %s after a build that took the tab down', async (device) => {
    be(device)
    const { detectTier } = await import('./realm')
    const { markBuild, rememberLevel } = await import('./quality')
    rememberLevel('ultra')
    markBuild('ultra')
    // the tab is gone before the first frame; the next visit finds the mark
    expect(detectTier()).toBe('high')
    // and keeps the lighter level, also on the visit after
    expect(detectTier()).toBe('high')
  })

  it('keeps the level when the visitor left during the build', async () => {
    be('a desktop reporting an RTX card')
    const { detectTier } = await import('./realm')
    const { clearBuild, markBuild, rememberLevel } = await import('./quality')
    rememberLevel('ultra')
    markBuild('ultra')
    clearBuild()
    expect(detectTier()).toBe('ultra')
  })

  it('takes the base level for a visitor saving data, whatever was measured', async () => {
    be('a desktop reporting an RTX card')
    vi.stubGlobal('navigator', { hardwareConcurrency: 16, connection: { saveData: true } })
    const { detectTier } = await import('./realm')
    const { rememberLevel } = await import('./quality')
    rememberLevel('ultra')
    expect(detectTier()).toBe('phone')
  })

  it('runs at the calm rate only where the full rate is out of reach at the lowest resolution', async () => {
    const { calmOnly } = await import('./quality')
    const full = 1000 / 60
    expect(calmOnly(12, full)).toBe(false)
    expect(calmOnly(30, full)).toBe(false)
    expect(calmOnly(80, full)).toBe(true)
    // the base level alone does not hold a device to the calm rate
    const { Realm } = await import('./realm')
    const realm = new Realm(container(), { tier: 'phone', reducedMotion: false })
    expect((realm as unknown as { frameBudget(timed: boolean): number }).frameBudget(true)).toBeCloseTo(full)
    realm.dispose()
  })
})

describe('a computer without a graphics chip', () => {
  it('is left to the browser, which gives no context where the drawing would run on the processor', async () => {
    const { Realm } = await import('./realm')
    new Realm(container(), { tier: 'ultra', reducedMotion: false }).dispose()
    expect(fake.state.renderers[0]!.params.failIfMajorPerformanceCaveat).toBe(true)
  })

  it.each(['?test', '?tier=high'])('draws anyway under %s, for the headless checks', async (search) => {
    vi.stubGlobal('location', { search })
    const { Realm } = await import('./realm')
    new Realm(container(), { reducedMotion: false }).dispose()
    expect(fake.state.renderers[0]!.params.failIfMajorPerformanceCaveat).toBe(false)
  })
})

describe('the density the garden is drawn at', () => {
  it.each<[number, number, number, Tier]>([
    [1512, 982, 2, 'ultra'],
    [1512, 982, 2, 'high'],
    [1536, 864, 1.25, 'high'],
    [3840, 2160, 1, 'high'],
    [393, 852, 3, 'phone'],
  ])('is the screen density at %ix%i and %fx on the %s level until frames say otherwise', async (w, h, dpr, tier) => {
    const { Realm } = await import('./realm')
    const realm = new Realm(wide(w, h, dpr), { tier, reducedMotion: false })
    const [renderer] = fake.state.renderers
    expect(realm.qualityInfo.dpr).toBe(dpr)
    expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(dpr)
    realm.dispose()
  })
})
