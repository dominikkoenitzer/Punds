import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tier } from './types'

// A stand-in for the browser and the WebGL renderer, so the realm runs in node.
// The garden on a fast laptop was once drawn at 39% of its pixels, by a level guessed from the GPU's name and the core
// count and a cap on the density (Safari reports every Mac as "Apple GPU" with 4 or 8 cores). How sharp and how
// much garden come from the frames this device measures, never from what it says it is.
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
    constructor() {
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

describe('what a device says about itself', () => {
  it.each(['Apple GPU', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', ''])(
    'builds the whole garden on a computer reporting "%s" with 4 cores and 4 GB',
    async (name) => {
      fake.state.gpuName = name
      vi.stubGlobal('navigator', { hardwareConcurrency: 4, deviceMemory: 4 })
      const { detectTier } = await import('./realm')
      expect(detectTier(new THREE.WebGLRenderer())).toBe('ultra')
    },
  )

  it('takes some away only for a visitor saving data', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 16, connection: { saveData: true } })
    const { detectTier } = await import('./realm')
    expect(detectTier(new THREE.WebGLRenderer())).toBe('phone')
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
