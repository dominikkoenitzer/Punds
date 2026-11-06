import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The light's prefiltering, the downloads and the HDR decoder stand in, so the sky builds in node.
const fake = vi.hoisted(() => {
  const drawn: { from: unknown; pixels: number[]; target: { texture: unknown; dispose: () => void } }[] = []
  return { drawn }
})

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>()
  class FakePMREM {
    fromEquirectangular(tex: THREE.DataTexture) {
      const data = tex.image.data as Float32Array
      const target = { texture: new three.Texture(), dispose: vi.fn() }
      fake.drawn.push({ from: tex, pixels: Array.from(data.subarray(0, 4)), target })
      return target
    }
    dispose() {}
  }
  return { ...three, PMREMGenerator: FakePMREM }
})

vi.mock('three/examples/jsm/loaders/HDRLoader.js', () => ({
  HDRLoader: class {
    setDataType() {
      return this
    }
    async loadAsync() {
      const width = 64
      const height = 32
      return { image: { data: new Float32Array(width * height * 4).fill(0.5), width, height }, dispose() {} }
    }
  },
}))

vi.mock('./assets', () => ({
  BITMAP: true,
  SKY_RANK: 0,
  bitmap: async () => ({ width: 8, height: 4 }),
  inTurn: async <T>(_rank: number, job: () => Promise<T>) => job(),
}))

afterEach(() => {
  vi.unstubAllGlobals()
  fake.drawn.length = 0
})

describe('sky light', () => {
  it('is drawn again from the same panorama after the GPU came back', async () => {
    vi.stubGlobal('fetch', async () => ({ json: async () => ({ k: 1, elevationTop: 1, elevationBottom: -1, sunDirectionThreeEquirectUv: [0.5, 0.3, 0.5] }) }))
    const { buildSky } = await import('./sky')
    const renderer = { capabilities: { getMaxAnisotropy: () => 16 }, initTexture: () => {} } as unknown as THREE.WebGLRenderer
    // the files come before the start picture shows, so there is no blank warm-up pass
    const sky = await buildSky(renderer, 'high', new THREE.Color(), new Promise(() => {}))
    expect(fake.drawn).toHaveLength(1)
    const [first] = fake.drawn
    expect(sky.environment).toBe(first!.target.texture)

    sky.relight()

    expect(fake.drawn).toHaveLength(2)
    const again = fake.drawn[1]!
    expect(again.from).toBe(first!.from)
    expect(again.pixels).toEqual(first!.pixels)
    expect(again.pixels[0]).toBeGreaterThan(0)
    expect(sky.environment).toBe(again.target.texture)
    expect(first!.target.dispose).toHaveBeenCalledTimes(1)
  })
})
