import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { POSTERS, calendarProblems, readSeasons, seasons, seasonsJson } from './seasons.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HALLOWEEN = { from: [10, 27], to: [11, 1], priority: 0, poster: false }

const made = []
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seasons-'))
  made.push(root)
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), typeof body === 'string' ? body : JSON.stringify(body))
  }
  return root
}
afterEach(() => {
  for (const root of made.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('the seasons in the repo', () => {
  it('are all sound', () => {
    const found = readSeasons(ROOT)
    expect(Object.keys(found)).toContain('halloween')
    for (const name of fs.readdirSync(path.join(ROOT, 'src/realm/seasons'))) expect(found).toHaveProperty(name)
  })
})

describe('readSeasons', () => {
  it('reads each folder with a dress and a calendar', () => {
    const root = tree({
      'src/realm/seasons/halloween/index.ts': 'export const dress = {}',
      'src/realm/seasons/halloween/calendar.json': HALLOWEEN,
      'src/realm/seasons/christmas/index.ts': 'export const dress = {}',
      'src/realm/seasons/christmas/calendar.json': { from: [12, 20], to: [1, 6], priority: 1, poster: false },
      'src/realm/seasons/readme.md': 'not a season',
    })
    expect(readSeasons(root)).toEqual({ christmas: { from: [12, 20], to: [1, 6], priority: 1, poster: false }, halloween: HALLOWEEN })
  })

  it('is empty without the folder', () => {
    expect(readSeasons(tree({}))).toEqual({})
  })

  it('fails a season with no dress', () => {
    const root = tree({ 'src/realm/seasons/halloween/calendar.json': HALLOWEEN })
    expect(() => readSeasons(root)).toThrow(/halloween: needs an index.ts/)
  })

  it('fails a season with no calendar', () => {
    const root = tree({ 'src/realm/seasons/halloween/index.ts': '' })
    expect(() => readSeasons(root)).toThrow(/halloween: needs a calendar.json/)
  })

  it('fails a calendar that is not JSON', () => {
    const root = tree({ 'src/realm/seasons/halloween/index.ts': '', 'src/realm/seasons/halloween/calendar.json': '{ from: [10, 27] }' })
    expect(() => readSeasons(root)).toThrow(/halloween\/calendar.json/)
  })

  it('fails a folder name that is no season name', () => {
    for (const name of ['Halloween', 'none', 'new year', '-x', 'x.y']) {
      const root = tree({ [`src/realm/seasons/${name}/index.ts`]: '', [`src/realm/seasons/${name}/calendar.json`]: HALLOWEEN })
      expect(() => readSeasons(root), name).toThrow(/folder name/)
    }
  })

  it('fails a season that promises pictures it does not have', () => {
    const files = { 'src/realm/seasons/halloween/index.ts': '', 'src/realm/seasons/halloween/calendar.json': { ...HALLOWEEN, poster: true } }
    expect(() => readSeasons(tree(files))).toThrow(/poster-tall.webp is missing/)
    const all = Object.fromEntries(POSTERS.map((p) => [`public/realm/seasons/halloween/${p}`, 'x']))
    expect(readSeasons(tree({ ...files, ...all })).halloween.poster).toBe(true)
  })
})

describe('calendarProblems', () => {
  it('passes a sound calendar', () => {
    expect(calendarProblems(HALLOWEEN)).toEqual([])
    expect(calendarProblems({ from: [2, 29], to: [12, 31], priority: -1, poster: true })).toEqual([])
  })

  it('names what is wrong', () => {
    expect(calendarProblems(null)).toEqual(['is not an object'])
    expect(calendarProblems([])).toEqual(['is not an object'])
    expect(calendarProblems({ ...HALLOWEEN, from: [9, 31] })).toEqual(['needs "from" as [month 1-12, day]'])
    expect(calendarProblems({ ...HALLOWEEN, from: [2, 30] })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, to: [13, 1] })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, to: [0, 1] })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, to: [11, 0] })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, to: ['11', 1] })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, to: [11, 1.5] })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, to: [11, 1, 2] })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, priority: '1' })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, poster: 'yes' })).toHaveLength(1)
    expect(calendarProblems({ ...HALLOWEEN, until: [11, 2] })).toEqual(['has an unknown key "until"'])
    const noPoster = { ...HALLOWEEN }
    delete noPoster.poster
    expect(calendarProblems(noPoster)).toHaveLength(1)
  })
})

describe('the build plugin', () => {
  it('keeps a closing tag in the data from ending the block', () => {
    expect(seasonsJson({ '</script><script>alert(1)</script>': HALLOWEEN })).not.toContain('<')
  })

  it('fails a page without the seasons block', () => {
    expect(() => seasons().transformIndexHtml('<html><head></head></html>')).toThrow(/seasons block/)
  })

  it('serves the calendars as a module', () => {
    const plugin = seasons()
    plugin.configResolved({ root: ROOT })
    const id = plugin.resolveId('virtual:seasons')
    const code = plugin.load.call({ addWatchFile() {} }, id)
    expect(JSON.parse(code.replace(/^export default /, ''))).toEqual(readSeasons(ROOT))
  })
})
