import { createHash } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

// Every page check listens for the console: an error or a warning on a clean load is a defect. One is not the page's:
// Chromium's note that a frame waited for the GPU, which the warm-up does on purpose to measure it (realm.ts).
const DRIVER_NOTE = /GL Driver Message .*GPU stall due to ReadPixels/

function watchConsole(page: Page): string[] {
  const seen: string[] = []
  page.on('console', (m: ConsoleMessage) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !DRIVER_NOTE.test(m.text())) seen.push(`${m.type()}: ${m.text()}`)
  })
  page.on('pageerror', (e) => seen.push(`pageerror: ${e.message}`))
  return seen
}

// whether this browser gives a context to a page that refuses a software renderer, the way the garden asks for one
function drawsHere(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    if (!gl) return false
    let name = String(gl.getParameter(gl.RENDERER))
    if (/^WebKit WebGL$/i.test(name)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      if (info) name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    }
    return !/SwiftShader|llvmpipe|softpipe|Basic Render|Software Adapter/i.test(name)
  })
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
  const scene = await drawsHere(page)
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
  await page.waitForFunction(() => window.__realm?.isReady === true, null, { timeout: 200_000, polling: 500 })
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
  await expect(canvas).toHaveScreenshot('garden.png')
  expect(seen).toEqual([])
})

test('a frame that throws gives the still page, not a blank one', async ({ page }, info) => {
  test.skip(!info.project.name.endsWith('desk-1440'), 'one screen per engine is enough')
  await page.goto('/?test&debug&season=none')
  await page.waitForFunction(() => window.__realm?.isReady === true, null, { timeout: 200_000, polling: 500 })
  await page.evaluate(() => {
    const r = window.__realm!.renderer
    r.render = () => {
      throw new Error('a broken frame')
    }
    window.__realm!.redraw()
  })
  await expect(page.locator('.sando-fallback')).toBeVisible()
  await expect(page.locator('.sando-fallback nav a')).toHaveCount(3)
  await expect(page.locator('.sando-canvas canvas')).toHaveCount(0)
})
