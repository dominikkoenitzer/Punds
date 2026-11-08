// `?test`: the same picture on every run, so the browser checks can hash a frame and compare it per engine. Everything
// drawn at random comes from one fixed seed, the clock stands still, nothing moves, and the resolution stays at the
// screen's own instead of following the frames.

export const TEST = typeof location !== 'undefined' && new URLSearchParams(location.search).has('test')

/** The moment the garden's clock is held at, in seconds. */
export const TEST_TIME = 20

/** A small seeded generator (mulberry32), the same numbers in every engine. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Where the browser itself says the drawing would run without a graphics chip
// (a software renderer), it gives no context and the page shows the still
// picture. Headless checks with a forced level or `?test` draw there anyway.
// Read at each call, not once, so the tests can set the address.
export function refuseSoftware(): boolean {
  return !forcedVisit()
}

// Some browsers hand out a software context even when asked to fail without a
// graphics chip; their renderer's name gives them away. Chrome and Safari name
// only "WebKit WebGL" until asked through the debug extension, which Firefox
// warns about, and Firefox names the real renderer at once.
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|Basic Render|Software Adapter/i

export function softwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  let name = String(gl.getParameter(gl.RENDERER) ?? '')
  if (/^WebKit WebGL$/i.test(name)) {
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '')
  }
  return SOFTWARE.test(name)
}

// a visit whose level or picture the address fixes: it measures nothing for the next visit
export function forcedVisit(): boolean {
  const params = new URLSearchParams(location.search)
  return params.has('test') || params.has('tier')
}

// before any part of the garden is loaded (main.tsx imports this first)
if (TEST) Math.random = seeded(1)
