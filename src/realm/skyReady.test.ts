import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkyResult } from './sky'

// A stand-in for the browser and the WebGL renderer, so the realm runs in node.
const fake = vi.hoisted(() => {
  const listeners = () => ({ addEventListener: () => {}, removeEventListener: () => {} })
  class FakeRenderer {
    debug = { checkShaderErrors: false }
    shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false }
    capabilities = { getMaxAnisotropy: () => 16 }
    domElement = Object.assign(listeners(), { style: {} as Record<string, string>, remove: () => {} })
    info = { programs: [] }
    dispose() {}
    setPixelRatio() {}
    setSize() {}
    getRenderTarget() {
      return null
    }
    setRenderTarget() {}
    compileAsync() {
      return Promise.resolve()
    }
    getContext() {
      return { getExtension: () => null }
    }
  }
  // how the sky loads in each test; sunKnown settles once, as bg.json does
  let sunResolve: () => void = () => {}
  const sky = {
    sunKnown: new Promise<void>((resolve) => (sunResolve = resolve)),
    sunIsKnown: () => sunResolve(),
    load: (): Promise<unknown> => Promise.reject(new Error('no sky set up')),
  }
  return { listeners, FakeRenderer, sky }
})

vi.mock('three', async (importOriginal) => ({ ...(await importOriginal<typeof import('three')>()), WebGLRenderer: fake.FakeRenderer }))
vi.mock('./sky', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sky')>()),
  sunKnown: fake.sky.sunKnown,
  buildSky: () => fake.sky.load(),
}))
vi.mock('./assets', async (importOriginal) => ({ ...(await importOriginal<typeof import('./assets')>()), prefetchSets: () => {} }))
vi.mock('./rocks', async (importOriginal) => ({ ...(await importOriginal<typeof import('./rocks')>()), prefetchScans: () => {} }))

beforeEach(() => {
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

const container = () => ({ appendChild: () => {}, clientWidth: 800, clientHeight: 600 }) as unknown as HTMLElement
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
type Listen = (event: 'unhandledRejection', fn: (reason: unknown) => void) => void
const node = globalThis as unknown as { process: { on: Listen; off: Listen } }

// what start came to within a short time: its error, 'done', or 'still loading'
async function outcome(start: Promise<void>): Promise<unknown> {
  return Promise.race([start.then(() => 'done', (e: unknown) => e), wait(200).then(() => 'still loading')])
}

async function newRealm() {
  const { Realm } = await import('./realm')
  const realm = new Realm(container(), { tier: 'high', reducedMotion: false })
  Object.assign((realm as unknown as { pipeline: object }).pipeline, { precompile: () => Promise.resolve() })
  return realm
}

// bg.json arrives, then the panorama or the light fails a moment later
function skyFailsAfterTheSun(error: Error) {
  fake.sky.load = async () => {
    fake.sky.sunIsKnown()
    await wait(5)
    throw error
  }
}

describe('the sky while the garden is built', () => {
  it('ends the start with the error when the sky fails after the sun is known', async () => {
    const error = new Error('bg_8k.webp: 404')
    skyFailsAfterTheSun(error)
    const realm = await newRealm()
    const result = await outcome(realm.start(async (r) => void (await r.skyReady)))
    expect(result).toBe(error)
  })

  it('ends the start with the error and nothing unhandled when no step waits for the sky', async () => {
    const error = new Error('env_1k.hdr: 404')
    skyFailsAfterTheSun(error)
    const unhandled: unknown[] = []
    const note = (reason: unknown) => void unhandled.push(reason)
    node.process.on('unhandledRejection', note)
    try {
      const realm = await newRealm()
      const result = await outcome(realm.start(async () => {}))
      await wait(20)
      expect(result).toBe(error)
      expect(unhandled).toEqual([])
    } finally {
      node.process.off('unhandledRejection', note)
    }
  })

  it('hands the loaded sky to the build', async () => {
    const loaded = {
      mesh: new THREE.Mesh(),
      environment: new THREE.Texture(),
      panorama: new THREE.Texture(),
      k: 1,
      shift: 0,
      relight: () => {},
      dispose: () => {},
    } satisfies SkyResult
    fake.sky.load = async () => {
      fake.sky.sunIsKnown()
      await wait(5)
      return loaded
    }
    const realm = await newRealm()
    let seen: SkyResult | null = null
    const result = await outcome(
      realm.start(async (r) => {
        seen = await r.skyReady
      }),
    )
    expect(seen).toBe(loaded)
    expect(result).not.toBeInstanceOf(Error)
  })
})
