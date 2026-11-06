import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in for the browser and the WebGL renderer, so the realm runs in node.
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
  const state = { renderers: [] as FakeRenderer[] }
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
      return { getExtension: () => null }
    }
  }
  return { listeners, state, FakeRenderer }
})

vi.mock('three', async (importOriginal) => ({ ...(await importOriginal<typeof import('three')>()), WebGLRenderer: fake.FakeRenderer }))

beforeEach(() => {
  fake.state.renderers.length = 0
  vi.stubGlobal('location', { search: '' })
  vi.stubGlobal('window', Object.assign(fake.listeners(), { matchMedia: () => ({ matches: false }), innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, setTimeout, clearTimeout }))
  vi.stubGlobal('document', Object.assign(fake.listeners(), { hidden: false }))
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

describe('a GPU that comes back', () => {
  it('draws the shadows and the sky light again, which three.js cannot upload', async () => {
    const { Realm } = await import('./realm')
    const realm = new Realm(container(), { tier: 'high', reducedMotion: false })
    const [renderer] = fake.state.renderers
    const drawnLight = new THREE.Texture()
    const sky = {
      environment: new THREE.Texture(),
      relight: vi.fn(() => {
        sky.environment = drawnLight
      }),
      dispose: vi.fn(),
    }
    const scene = (realm as unknown as { scene: THREE.Scene }).scene
    Object.assign(realm, { sky })
    scene.environment = sky.environment

    renderer.domElement.dispatch('webglcontextlost')
    // three.js puts the shadow flag back as it was: the static map was drawn long ago
    renderer.shadowMap.needsUpdate = false
    renderer.domElement.dispatch('webglcontextrestored')

    expect(renderer.shadowMap.needsUpdate).toBe(true)
    expect(sky.relight).toHaveBeenCalledTimes(1)
    expect(scene.environment).toBe(drawnLight)
  })
})
