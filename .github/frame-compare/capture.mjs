// Renders one build of the site in headless Chromium on a paused fake clock
// and saves canvas frames, counted from the first frame the scene draws, plus
// page screenshots once the fonts are in.
//
//   node capture.mjs --dist <built site> --out <dir> --scenario boot|skip --viewport desktop|mobile

import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
}

// Ticks are fake milliseconds. The first frame lands on tick 0 in every run,
// because the clock does not move until that frame is up, so a tick is also
// the time since the first frame. Each frame asked for is the first one drawn
// at or after its tick. `pace: null` keeps the browser's 16 ms frame grid;
// `pace: 33` spaces frames 33 ms apart, a 30 fps device, which keeps the
// scene's quality stepper on its default tier while the boot plays out in
// fewer frames.
const SCENARIOS = {
  boot: [
    {
      until: 1000,
      pace: null,
      frames: [
        [16, 'second frame'],
        [32, ''],
        [48, ''],
        [80, ''],
        [160, ''],
        [480, 'logo fading in'],
        [992, 'logo phase'],
      ],
      shot: 'logo phase, splash caption',
    },
    {
      until: 3600,
      pace: 33,
      frames: [
        [2000, 'logo phase'],
        [3000, 'boot phase, glitch'],
        [3200, 'boot phase, glitch'],
        [3500, 'boot phase'],
      ],
      shot: 'boot log, first lines',
    },
    {
      until: 7300,
      pace: 33,
      frames: [
        [5000, 'boot log'],
        [7000, 'boot log complete'],
      ],
      shot: 'boot log complete',
    },
    {
      until: 9200,
      pace: 33,
      frames: [
        [7550, 'welcome, glitch'],
        [7800, 'welcome'],
        [9000, 'welcome'],
      ],
      shot: 'welcome',
    },
    {
      until: 11600,
      pace: 33,
      frames: [
        [10650, 'desktop, glitch'],
        [10900, 'desktop, panels fading in'],
        [11200, 'desktop, panels fading in'],
        [11600, 'desktop'],
      ],
      shot: 'desktop',
    },
  ],
  skip: [
    {
      until: 500,
      pace: null,
      frames: [
        [16, 'second frame'],
        [496, 'logo phase'],
      ],
      shot: 'logo phase, before the skip',
    },
    { click: 'centre of the canvas: skip the boot' },
    {
      until: 3500,
      pace: null,
      frames: [
        [512, 'first frame after the skip'],
        [528, 'desktop, glitch'],
        [560, 'desktop, glitch'],
        [640, 'desktop'],
        [1000, 'desktop, panels fading in'],
        [1500, 'desktop'],
        [2000, 'desktop'],
        [3000, 'desktop'],
        [3488, 'desktop'],
      ],
      shot: 'desktop after the skip',
    },
  ],
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`)
    out[argv[i].slice(2)] = argv[i + 1]
  }
  for (const key of ['dist', 'out', 'scenario', 'viewport']) {
    if (!out[key]) throw new Error(`missing --${key}`)
  }
  if (!SCENARIOS[out.scenario]) throw new Error(`unknown scenario ${out.scenario}`)
  if (!VIEWPORTS[out.viewport]) throw new Error(`unknown viewport ${out.viewport}`)
  return out
}

// A plain static server for the built site, so both builds load from the same
// origin and nothing between the page and the files can differ.
function serve(root, port) {
  const base = resolve(root)
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      let file = normalize(join(base, path === '/' ? 'index.html' : path))
      if (file !== base && !file.startsWith(base + sep)) throw new Error('outside the root')
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': MIME[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
    }
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))
const pad = (tick) => String(tick).padStart(5, '0')

async function writeCaptures(dir, captures, log) {
  for (const c of captures) {
    const name = c.label === 'first-frame' ? 'canvas-first-frame' : `canvas-${c.label}`
    await writeFile(join(dir, `${name}.png`), Buffer.from(c.png.split(',')[1], 'base64'))
    log.push({ file: `${name}.png`, kind: 'canvas', label: c.label, note: c.note, frame: c.frame, tick: c.tick, randomCalls: c.randomCalls })
  }
}

async function shoot(page, dir, tick, note, log) {
  const fontsLoaded = await page.evaluate(() =>
    document.fonts.ready.then(() => document.fonts.check('16px "TrixieCyrG"')),
  )
  const name = `t${pad(tick)}`
  await page.screenshot({ path: join(dir, `page-${name}.png`), animations: 'disabled', caret: 'hide' })
  // the same view with the canvas and the scanline, grain and vignette layers
  // hidden, which leaves the DOM text on its background
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.id = 'fc-text-only'
    style.textContent =
      '.copland-canvas, .copland-scan, .copland-grain, .copland-vignette { visibility: hidden !important; }'
    document.head.append(style)
  })
  await page.screenshot({ path: join(dir, `text-${name}.png`), animations: 'disabled', caret: 'hide' })
  await page.evaluate(() => document.getElementById('fc-text-only').remove())
  log.push({ file: `page-${name}.png`, kind: 'page', note, tick, fontsLoaded })
  log.push({ file: `text-${name}.png`, kind: 'text', note, tick, fontsLoaded })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outDir = resolve(args.out)
  await mkdir(outDir, { recursive: true })
  const harness = await readFile(join(here, 'harness.js'), 'utf8')
  const { viewport, isMobile, hasTouch } = VIEWPORTS[args.viewport]
  const scenario = SCENARIOS[args.scenario]

  const meta = {
    dist: resolve(args.dist),
    scenario: args.scenario,
    viewport,
    isMobile,
    images: [],
    segments: [],
    fontResponses: [],
    pageErrors: [],
    consoleErrors: [],
  }
  const startedAt = Date.now()
  const server = await serve(args.dist, 4173)
  const browser = await chromium.launch({
    headless: true,
    // software GL through SwiftShader (Playwright already adds
    // --enable-unsafe-swiftshader); all three runs of a job share one machine
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--ignore-gpu-blocklist',
      '--force-color-profile=srgb',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  })
  meta.browser = browser.version()
  let failure = null
  try {
    const context = await browser.newContext({
      viewport,
      isMobile,
      hasTouch,
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      locale: 'en-US',
      timezoneId: 'UTC',
      serviceWorkers: 'block',
    })
    const page = await context.newPage()
    page.on('pageerror', (err) => meta.pageErrors.push(String(err.stack || err)))
    page.on('console', (msg) => {
      if (msg.text().startsWith('[fc]')) console.log(`  ${msg.text()}`)
      else if (msg.type() === 'error') meta.consoleErrors.push(msg.text())
    })
    page.on('response', (res) => {
      if (res.url().includes('/fonts/')) meta.fontResponses.push(`${res.status()} ${new URL(res.url()).pathname}`)
    })

    // Install the fake clock paused, before any page exists. Every document
    // replays this, so the site starts with performance.now() at 0 and no
    // timer fires until run() fires it.
    await page.clock.pauseAt(new Date('2026-01-01T00:00:00Z'))
    await context.addInitScript({ content: harness })

    // The panel textures are drawn with the NAVI font as soon as the scene is
    // built. Hold the scene's chunk until that font has loaded, so both builds
    // draw them with it instead of racing the font download.
    meta.sceneChunkHeld = 0
    await context.route('**/assets/coplandScene-*.js', async (route) => {
      meta.sceneChunkHeld++
      try {
        meta.fontLoadedBeforeScene = await page.evaluate(async () => {
          await document.fonts.load('17px "TrixieCyrG"')
          await document.fonts.ready
          return document.fonts.check('17px "TrixieCyrG"')
        })
      } finally {
        await route.continue()
      }
    })

    await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' })

    const waitStart = Date.now()
    for (;;) {
      const s = await page.evaluate(() => ({
        harness: window.__fc ? window.__fc.initError : 'the harness did not run',
        frames: window.__fc ? window.__fc.frames : 0,
        fallback: !!document.querySelector('.copland-fallback'),
      }))
      if (s.harness) throw new Error(s.harness)
      if (s.fallback) throw new Error('the page showed its no-WebGL fallback')
      if (s.frames >= 1) break
      if (meta.pageErrors.length) throw new Error(`page error before the first frame: ${meta.pageErrors[0]}`)
      if (Date.now() - waitStart > 300_000) throw new Error('no first frame within 5 minutes')
      await sleep(250)
    }
    meta.firstFrameRealMs = Date.now() - waitStart
    if (meta.sceneChunkHeld !== 1) throw new Error(`the scene chunk was held ${meta.sceneChunkHeld} times, expected 1`)

    const first = await page.evaluate(() => window.__fc.state(true))
    meta.atFirstFrame = { ...first, captures: undefined }
    console.log(`first frame at tick ${first.firstFrameTick} after ${meta.firstFrameRealMs} ms real time`)
    await writeCaptures(outDir, first.captures, meta.images)

    for (const seg of scenario) {
      if (seg.click) {
        await page.mouse.click(viewport.width / 2, viewport.height / 2)
        await page.evaluate(() => window.__fc.settle())
        meta.segments.push({ click: seg.click })
        continue
      }
      const wants = seg.frames.map(([tick, note]) => ({ tick, label: `t${pad(tick)}`, note }))
      const t0 = Date.now()
      const res = await page.evaluate(([until, pace, w]) => window.__fc.run(until, pace, w), [seg.until, seg.pace, wants])
      const realMs = Date.now() - t0
      await writeCaptures(outDir, res.captures, meta.images)
      meta.segments.push({ until: seg.until, pace: seg.pace, realMs, ...res, captures: undefined })
      console.log(`segment to ${seg.until} ms: ${res.frames} frames so far, ${(realMs / 1000).toFixed(1)} s real`)
      if (seg.shot) await shoot(page, outDir, seg.until, seg.shot, meta.images)
    }

    const end = await page.evaluate(() => window.__fc.state(false))
    meta.atEnd = end
    if (end.wants.length) throw new Error(`frames never drawn for: ${end.wants.join(', ')}`)

    // asked last, so nothing here can touch the frames above
    meta.gl = await page.evaluate(() => {
      const gl = document.querySelector('.copland-canvas canvas').getContext('webgl2')
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      return {
        renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        // the browser's own extension; getExtension() would also count the
        // harness stand-in
        parallelShaderCompile: !window.__fc.parallelCompileStandIn,
      }
    })
  } catch (err) {
    failure = err
    meta.failure = String(err.stack || err)
  } finally {
    meta.realSeconds = Math.round((Date.now() - startedAt) / 1000)
    await writeFile(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
    await browser.close()
    server.close()
  }
  if (failure) throw failure
  console.log(`${meta.images.length} images in ${meta.realSeconds} s, ${meta.atEnd.frames} frames, ${meta.atEnd.randomCalls} random values`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
