import { createHash } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

// Every page check listens for the console: an error or a warning on a clean load is a defect. Two are not the page's.
// Chromium notes that a frame waited for the GPU, which the warm-up does on purpose to measure it (realm.ts). Firefox
// notes once on every system that the soft shadows' filtered depth comparison is left to the driver by the spec, which
// three.js's PCF shadows ask for; that one is matched by its exact text.
const DRIVER_NOTE = /GL Driver Message .*GPU stall due to ReadPixels/
const SHADOW_NOTES = new Set(
  ['drawArraysInstanced', 'drawElementsInstanced'].map(
    (call) =>
      `[JavaScript Warning: "WebGL warning: ${call}: Depth texture comparison requests (e.g. \`LINEAR\`) Filtering, but behavior is implementation-defined, and so on some systems will sometimes behave as \`NEAREST\`. (warns once)"]`,
  ),
)

function watchConsole(page: Page): string[] {
  const seen: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    const text = m.text()
    if ((m.type() === 'error' || m.type() === 'warning') && !DRIVER_NOTE.test(text) && !SHADOW_NOTES.has(text)) seen.push(`${m.type()}: ${text}`)
  })
  page.on('pageerror', (e) => seen.push(`pageerror: ${e.message}`))
  return seen
}

// Whether this browser gives a WebGL2 context, and whether it does to a page that refuses a software renderer, the
// way the garden asks for one. Asked from a page of its own, so a browser's note about a failed context stays out of
// the console of the page under test.
async function webgl(page: Page): Promise<{ any: boolean; hardware: boolean }> {
  const probe = await page.context().newPage()
  try {
    return await probe.evaluate(() => {
      const ask = (refuse: boolean) => document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: refuse })
      const any = ask(false) !== null
      const gl = ask(true)
      if (!gl) return { any, hardware: false }
      let name = String(gl.getParameter(gl.RENDERER))
      if (/^WebKit WebGL$/i.test(name)) {
        const info = gl.getExtension('WEBGL_debug_renderer_info')
        if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
      }
      return { any, hardware: !/SwiftShader|llvmpipe|softpipe|Basic Render|Software Adapter/i.test(name) }
    })
  } finally {
    await probe.close()
  }
}

// Waits for the garden to be ready or for the still page, whichever the page settles on, so a browser without WebGL
// is answered in seconds. Gives true for the garden. The still page is only right where the browser has no WebGL at
// all, since ?test draws on a software renderer too.
async function sceneOrStill(page: Page): Promise<boolean> {
  await page.waitForFunction(() => window.__realm?.isReady === true || document.querySelector('.sando-fallback') !== null, null, {
    timeout: 200_000,
    polling: 500,
  })
  if (await page.evaluate(() => window.__realm?.isReady === true)) return true
  expect((await webgl(page)).any, 'the still page came up in a browser that has WebGL').toBe(false)
  await expectStill(page)
  return false
}

// the still page in place of the scene: the links there, no canvas left behind
async function expectStill(page: Page) {
  await expect(page.locator('.sando-fallback')).toBeVisible()
  await expect(page.locator('.sando-fallback nav a')).toHaveCount(3)
  await expect(page.locator('.sando-canvas canvas')).toHaveCount(0)
}

// How two pictures of the canvas differ: the pixels where a channel is off by more than a rounding step, and the largest step.
// A software renderer rounds a few single pixels one level apart between equal frames; a changed scene moves thousands.
function apart(page: Page, a: Buffer, b: Buffer): Promise<{ pixels: number; total: number; most: number }> {
  return page.evaluate(
    async ([x, y]) => {
      const read = async (data: string) => {
        // built from the bytes: the page's own rules allow it no request for a data address
        const blob = new Blob([Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0))], { type: 'image/png' })
        const img = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
        const c = new OffscreenCanvas(img.width, img.height).getContext('2d')!
        c.drawImage(img, 0, 0)
        return c.getImageData(0, 0, img.width, img.height).data
      }
      const [p, q] = await Promise.all([read(x), read(y)])
      if (p.length !== q.length) return { pixels: p.length / 4, total: p.length / 4, most: 255 }
      let pixels = 0
      let most = 0
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i]! - q[i]!), Math.abs(p[i + 1]! - q[i + 1]!), Math.abs(p[i + 2]! - q[i + 2]!))
        if (d > 0) pixels++
        if (d > most) most = d
      }
      return { pixels, total: p.length / 4, most }
    },
    [a.toString('base64'), b.toString('base64')] as const,
  )
}

// the parts drawn over the canvas, hidden for the picture of the garden itself
const OVER = '.sando-cue, .sando-sound, .sando-dot, .sando-load, .sando-poster, .sando-debug, .sando-menu { visibility: hidden !important; }'

test('the page names itself, links out and passes the accessibility check', async ({ page }) => {
  const seen = watchConsole(page)
  await page.goto('/?season=none')
  await expect(page.getByRole('heading', { level: 1, name: 'Punds' })).toBeAttached()
  await expect(page.locator('nav a')).toHaveCount(3)
  const scene = (await webgl(page)).hardware
  // without a graphics chip the still page shows at once, with no error on the way
  if (!scene) await expect(page.locator('.sando-fallback')).toBeVisible()
  const axe = await new AxeBuilder({ page }).analyze()
  const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  expect(seen).toEqual([])
})

test('under ?test the garden draws the same frame every time', async ({ page }, info) => {
  const seen = watchConsole(page)
  await page.goto('/?test&debug&season=none')
  if (!(await sceneOrStill(page))) {
    info.annotations.push({ type: 'level', description: 'still, no WebGL in this browser' })
    expect(seen).toEqual([])
    return
  }
  const overlay = page.getByTestId('quality')
  await expect(overlay).toContainText('scale 1.00')
  // ?test starts at the screen's own density and stays there
  const dpr = await page.evaluate(() => window.devicePixelRatio)
  await expect(overlay).toContainText(`at ${dpr.toFixed(2)}x`)
  const level = (await overlay.textContent())?.split(' ')[0]
  info.annotations.push({ type: 'level', description: `${level} at ${dpr}x` })

  await page.addStyleTag({ content: OVER })
  const canvas = page.locator('.sando-canvas canvas')
  const shot = () => canvas.screenshot({ animations: 'disabled' })
  await page.waitForFunction(() => window.__realm!.framesDrawn >= 2, null, { timeout: 120_000, polling: 500 })
  const first = await shot()
  // a frame drawn anew from the held clock
  const drawn = await page.evaluate(() => {
    window.__realm!.redraw()
    return window.__realm!.framesDrawn
  })
  await page.waitForFunction((n) => window.__realm!.framesDrawn > n, drawn, { timeout: 120_000, polling: 500 })
  const off = await apart(page, first, await shot())
  info.annotations.push({ type: 'frame', description: createHash('sha256').update(first).digest('hex') })
  info.annotations.push({ type: 'redraw', description: `${off.pixels} of ${off.total} pixels off, by at most ${off.most}` })
  expect(off.most, 'a pixel of the redrawn frame moved more than a rounding step').toBeLessThanOrEqual(2)
  expect(off.pixels / off.total, 'more pixels of the redrawn frame moved than rounding explains').toBeLessThan(1e-5)
  // kept at page size so fifteen baselines stay small; the density is checked above
  await expect(canvas).toHaveScreenshot('garden.png', { scale: 'css' })
  expect(seen).toEqual([])
})

test('a frame that throws gives the still page, not a blank one', async ({ page }, info) => {
  test.skip(!info.project.name.endsWith('desk-1440'), 'one screen per engine is enough')
  await page.goto('/?test&debug&season=none')
  // without WebGL there is no frame to break, and the still page is already there
  if (!(await sceneOrStill(page))) return
  await page.evaluate(() => {
    const r = window.__realm!.renderer
    r.render = () => {
      throw new Error('a broken frame')
    }
    window.__realm!.redraw()
  })
  await expectStill(page)
})

// A browser with WebGL turned off, as on a computer without any GL: the still page within seconds, quietly, also
// under ?test. Chromium and Firefox use their own switch; WebKit has none, so there the page is given no context.
for (const at of ['/?season=none', '/?test&debug&season=none']) {
  test(`with WebGL off the still page comes at once and quietly (${at})`, async ({ playwright, browserName, viewport, deviceScaleFactor, baseURL, reducedMotion, locale, timezoneId }, info) => {
    test.skip(!info.project.name.endsWith('desk-1440'), 'one screen per engine is enough')
    const browser = await playwright[browserName].launch({
      ...(browserName === 'chromium' ? { args: ['--disable-3d-apis'] } : {}),
      ...(browserName === 'firefox' ? { firefoxUserPrefs: { 'webgl.disabled': true }, headless: process.platform !== 'linux' } : {}),
    })
    try {
      const context = await browser.newContext({ viewport, deviceScaleFactor, baseURL, reducedMotion, locale, timezoneId })
      if (browserName === 'webkit') {
        await context.addInitScript(() => {
          const own = HTMLCanvasElement.prototype.getContext
          HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
            return /webgl/i.test(kind) ? null : own.call(this, kind as '2d', ...(rest as []))
          } as typeof own
        })
      }
      const page = await context.newPage()
      const seen = watchConsole(page)
      const start = Date.now()
      await page.goto(at)
      await expect(page.locator('.sando-fallback')).toBeVisible({ timeout: 10_000 })
      info.annotations.push({ type: 'still', description: `${Date.now() - start} ms` })
      expect((await webgl(page)).any).toBe(false)
      await expectStill(page)
      expect(await page.evaluate(() => window.__realm)).toBeUndefined()
      // Firefox writes its own note for each context it refuses: the page's one ask, and nothing else
      const asked = browserName === 'firefox' ? [/^warning: \[JavaScript Warning: "Failed to create WebGL context: WebGL is currently disabled\."/] : []
      expect(seen.length, seen.join(' | ')).toBe(asked.length)
      asked.forEach((note, i) => expect(seen[i]).toMatch(note))
    } finally {
      await browser.close()
    }
  })
}
