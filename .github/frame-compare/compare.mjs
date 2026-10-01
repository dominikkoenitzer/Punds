// Compares capture folders image by image at threshold 0 and writes a
// Markdown report. Fails (exit 1) when a canvas frame or a DOM text shot
// differs by a single pixel, or when any image is missing on one side or was
// taken at a different frame or tick.
//
// The page-* shots, the browser's own composite of canvas, DOM and the CSS
// scanline, grain and vignette layers, are compared and reported but do not
// fail the run: on a 1280x800 viewport the compositor's output is not
// reproducible even between two runs of the same build (main against main
// differs by one level in scattered pixels of the scanline rows), while the
// layers that go into it, the canvas frames and the DOM text, match exactly.
//
//   node compare.mjs <report.md> <title> <dir a> <dir b> [<title> <dir a> <dir b> ...]

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import pngjs from 'pngjs'
import pixelmatch from 'pixelmatch'

const { PNG } = pngjs

const [reportPath, ...rest] = process.argv.slice(2)
if (!reportPath || rest.length === 0 || rest.length % 3 !== 0) {
  console.error('usage: node compare.mjs <report.md> <title> <dir a> <dir b> [...]')
  process.exit(2)
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function readMeta(dir) {
  try {
    return JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
  } catch {
    return null
  }
}

async function pngs(dir) {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.png'))
  } catch {
    return []
  }
}

async function decode(file) {
  return PNG.sync.read(await readFile(file))
}

function describe(name, meta) {
  if (!meta) return `- ${name}: no meta.json (the capture did not finish)`
  const end = meta.atEnd ?? {}
  const parts = [
    `first frame at tick ${meta.atFirstFrame?.firstFrameTick ?? '?'}`,
    `${end.frames ?? '?'} frames`,
    `${end.randomCalls ?? '?'} random values`,
    `${end.timersFired ?? '?'} timers fired`,
    `font: ${meta.fontResponses?.join(', ') || 'none fetched'}`,
    `font loaded before the scene: ${meta.fontLoadedBeforeScene ?? '?'}`,
    `GL: ${meta.gl?.renderer ?? '?'}`,
    `KHR_parallel_shader_compile: ${end.parallelCompileStandIn ? 'missing, harness stand-in used' : 'native'}`,
    `${meta.realSeconds ?? '?'} s`,
  ]
  let line = `- ${name}: ${parts.join(', ')}`
  const problems = [...(meta.pageErrors ?? []), ...(end.errors ?? [])]
  if (problems.length) line += `\n  - page errors: ${problems.map((p) => p.split('\n')[0]).join(' / ')}`
  if (meta.failure) line += `\n  - capture failed: ${meta.failure.split('\n')[0]}`
  return line
}

async function comparePair(title, dirA, dirB, diffRoot) {
  const [metaA, metaB] = await Promise.all([readMeta(dirA), readMeta(dirB)])
  const infoA = new Map((metaA?.images ?? []).map((i) => [i.file, i]))
  const infoB = new Map((metaB?.images ?? []).map((i) => [i.file, i]))
  const inA = new Set(await pngs(dirA))
  const inB = new Set(await pngs(dirB))
  const files = [...new Set([...inA, ...inB])].sort()
  const diffDir = join(diffRoot, slug(title))
  const rows = []
  let failed = !metaA || !metaB || !!metaA.failure || !!metaB.failure || files.length === 0
  let identical = 0
  let gated = 0
  let totalPixels = 0
  let composites = 0
  let compositePixels = 0

  for (const file of files) {
    const a = infoA.get(file)
    const b = infoB.get(file)
    const row = {
      file,
      frame: a?.frame ?? b?.frame,
      tick: a?.tick ?? b?.tick,
      note: a?.note ?? b?.note ?? '',
      result: '',
      pm: '',
      exact: '',
      maxDelta: '',
    }
    rows.push(row)
    if (!inA.has(file) || !inB.has(file)) {
      row.result = `missing in ${inA.has(file) ? 'b' : 'a'}`
      failed = true
      continue
    }
    if (a && b && (a.frame !== b.frame || a.tick !== b.tick)) {
      row.result = `misaligned: frame ${a.frame} at ${a.tick} ms vs frame ${b.frame} at ${b.tick} ms`
      failed = true
    }
    const [imgA, imgB] = await Promise.all([decode(join(dirA, file)), decode(join(dirB, file))])
    if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
      row.result = `size ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`
      failed = true
      continue
    }
    const { width, height } = imgA
    let exact = 0
    let maxDelta = 0
    const wa = new Uint32Array(imgA.data.buffer, imgA.data.byteOffset, width * height)
    const wb = new Uint32Array(imgB.data.buffer, imgB.data.byteOffset, width * height)
    for (let i = 0; i < wa.length; i++) {
      if (wa[i] === wb[i]) continue
      exact++
      for (let c = 0; c < 4; c++) {
        maxDelta = Math.max(maxDelta, Math.abs(imgA.data[i * 4 + c] - imgB.data[i * 4 + c]))
      }
    }
    const out = new PNG({ width, height })
    const pm = pixelmatch(imgA.data, imgB.data, out.data, width, height, { threshold: 0, includeAA: true })
    row.pm = pm
    row.exact = exact
    row.maxDelta = maxDelta
    const composite = file.startsWith('page-')
    if (composite) {
      composites++
      compositePixels += Math.max(pm, exact)
    } else {
      gated++
      totalPixels += Math.max(pm, exact)
    }
    if (pm === 0 && exact === 0) {
      if (!row.result) {
        row.result = 'identical'
        if (!composite) identical++
      }
    } else {
      if (!composite) failed = true
      row.result = row.result || (composite ? 'differs (composite, reported only)' : 'DIFFERS')
      await mkdir(diffDir, { recursive: true })
      await writeFile(join(diffDir, file), PNG.sync.write(out))
    }
    if (a && b && a.randomCalls !== undefined && a.randomCalls !== b.randomCalls) {
      row.result += ` (random values ${a.randomCalls} vs ${b.randomCalls})`
    }
  }

  const lines = [
    `### ${title}: ${failed ? 'DIFFERS' : 'identical'}`,
    '',
    `${identical} of ${gated} canvas frames and DOM text shots identical, ${totalPixels} differing pixels in them.`,
    `${composites} page composites (reported only): ${compositePixels} differing pixels.`,
    '',
    describe(`a (${dirA.split(/[\\/]/).slice(-2).join('/')})`, metaA),
    describe(`b (${dirB.split(/[\\/]/).slice(-2).join('/')})`, metaB),
    '',
    '| image | frame | fake ms | on screen | differing pixels (pixelmatch, threshold 0) | differing pixels (exact RGBA) | largest channel difference | result |',
    '| --- | ---: | ---: | --- | ---: | ---: | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r.file} | ${r.frame ?? ''} | ${r.tick ?? ''} | ${r.note} | ${r.pm} | ${r.exact} | ${r.maxDelta} | ${r.result} |`,
    ),
    '',
  ]
  return { failed, text: lines.join('\n') }
}

const diffRoot = join(dirname(reportPath), 'diff')
const sections = []
let anyFailed = false
for (let i = 0; i < rest.length; i += 3) {
  const { failed, text } = await comparePair(rest[i], rest[i + 1], rest[i + 2], diffRoot)
  anyFailed ||= failed
  sections.push(text)
  console.log(text)
}
await writeFile(reportPath, sections.join('\n'))
process.exit(anyFailed ? 1 : 0)
