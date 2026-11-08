import { describe, expect, it } from 'vitest'

import { softwareRenderer } from './testMode'

const RENDERER = 0x1f01
const UNMASKED = 0x9246

// a stand-in context that names `shown` as its renderer and `unmasked` behind the debug extension
function context(shown: string, unmasked?: string): WebGL2RenderingContext {
  const asked: string[] = []
  const gl = {
    RENDERER,
    asked,
    getParameter: (p: number) => (p === RENDERER ? shown : p === UNMASKED ? unmasked : null),
    getExtension: (name: string) => {
      asked.push(name)
      return unmasked === undefined ? null : { UNMASKED_RENDERER_WEBGL: UNMASKED }
    },
  }
  return gl as unknown as WebGL2RenderingContext
}

describe('softwareRenderer', () => {
  it('knows the software renderers by name', () => {
    for (const name of ['llvmpipe (LLVM 19.1.7, 256 bits)', 'softpipe', 'Microsoft Basic Render Driver', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', 'Software Adapter']) {
      expect(softwareRenderer(context(name)), name).toBe(true)
    }
  })

  it('lets a graphics chip through', () => {
    for (const name of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'Apple M2', 'Mali-G78', 'Adreno (TM) 740']) {
      expect(softwareRenderer(context(name)), name).toBe(false)
    }
  })

  it('asks behind a masked name only', () => {
    expect(softwareRenderer(context('WebKit WebGL', 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'))).toBe(true)
    expect(softwareRenderer(context('WebKit WebGL', 'Apple GPU'))).toBe(false)
    const named = context('llvmpipe')
    softwareRenderer(named)
    expect((named as unknown as { asked: string[] }).asked).toEqual([])
  })

  it('counts a masked name with no extension as a graphics chip', () => {
    expect(softwareRenderer(context('WebKit WebGL'))).toBe(false)
  })
})
