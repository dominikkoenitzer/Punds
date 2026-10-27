import { afterEach, describe, expect, it, vi } from 'vitest'

import html from '../../index.html?raw'
import vercel from '../../vercel.json?raw'
import { seasons as seasonsPlugin } from '../../tools/seasons.mjs'
import { type Calendar, type Dress, SEASONS, fetchDress, pickSeason, posterFolder, wornSeason } from './season'

const day = (month: number, date: number, hour = 12, minute = 0, second = 0, ms = 0) => new Date(2026, month, date, hour, minute, second, ms)

// a made-up set that covers what a calendar can say: a range over the new
// year, a holiday on top of it, one day long, two seasons tied
const MADE_UP: Record<string, Calendar> = {
  halloween: { from: [10, 27], to: [11, 1], priority: 0, poster: true },
  winter: { from: [12, 1], to: [2, 29], priority: 0, poster: true },
  christmas: { from: [12, 20], to: [1, 6], priority: 1, poster: false },
  eve: { from: [12, 31], to: [12, 31], priority: 2, poster: false },
  beta: { from: [6, 1], to: [6, 30], priority: 0, poster: false },
  alpha: { from: [6, 1], to: [6, 30], priority: 0, poster: false },
}

// the inline script in index.html makes the same choice before the first
// paint; run it against a stand-in page and read what it leaves behind
const inline = (() => {
  const found = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((m) => m[1].includes("get('season')"))
  if (!found) throw new Error('poster script not found in index.html')
  return found[1]
})()

// index.html as the build serves it, with the calendars written in
const built = (seasonsPlugin().transformIndexHtml as (html: string) => string)(html)

function dataBlock(page: string): string {
  const found = page.match(/<script type="application\/json" id="seasons">([\s\S]*?)<\/script>/)
  if (!found) throw new Error('seasons block not found')
  return found[1]
}

function runPoster(date: Date, search: string, block: string | null): { season: string | undefined; hrefs: string[] } {
  const links: { href: string }[] = []
  let season: string | undefined
  const FixedDate = class extends Date {
    constructor() {
      super(date.getTime())
    }
  }
  const document = {
    getElementById: (id: string) => (id === 'seasons' && block !== null ? { textContent: block } : null),
    documentElement: { setAttribute: (name: string, value: string) => name === 'data-season' && (season = value) },
    createElement: () => ({ setAttribute() {} }) as unknown as { href: string },
    head: { append: (...items: { href: string }[]) => links.push(...items) },
  }
  new Function('location', 'Date', 'document', inline)({ search }, FixedDate, document)
  return { season, hrefs: links.map((l) => l.href) }
}

const poster = (date: Date, search: string, registry: Record<string, Calendar>) => runPoster(date, search, JSON.stringify(registry))

const everyDay = function* (year: number) {
  for (let t = new Date(year, 0, 1); t.getFullYear() === year; t = new Date(year, t.getMonth(), t.getDate() + 1)) yield t
}

// what season.ts makes of the poster script's choice, as the page does it
const asPage = (date: Date, search: string, registry: Record<string, Calendar>) => wornSeason(poster(date, search, registry).season, date, search, registry)

describe('pickSeason', () => {
  it('wears Halloween from the 27th of October to the 1st of November', () => {
    expect(pickSeason(day(9, 27, 0), '')).toBe('halloween')
    expect(pickSeason(day(9, 31, 23), '')).toBe('halloween')
    expect(pickSeason(day(10, 1, 23), '')).toBe('halloween')
  })

  it('wears nothing on the days around it', () => {
    expect(pickSeason(day(9, 26, 23), '')).toBeNull()
    expect(pickSeason(day(10, 2, 0), '')).toBeNull()
    expect(pickSeason(day(0, 1), '')).toBeNull()
    expect(pickSeason(day(11, 31), '')).toBeNull()
    expect(pickSeason(day(8, 30), '')).toBeNull()
  })

  it('turns over at the stroke of midnight', () => {
    expect(pickSeason(day(9, 26, 23, 59, 59, 999), '')).toBeNull()
    expect(pickSeason(day(9, 27, 0, 0, 0, 0), '')).toBe('halloween')
    expect(pickSeason(day(10, 1, 23, 59, 59, 999), '')).toBe('halloween')
    expect(pickSeason(day(10, 2, 0, 0, 0, 0), '')).toBeNull()
  })

  it('lets the address override the date both ways', () => {
    expect(pickSeason(day(5, 1), '?season=halloween')).toBe('halloween')
    expect(pickSeason(day(9, 30), '?season=none')).toBeNull()
    expect(pickSeason(day(9, 30), '?season=spring')).toBe('halloween')
  })

  it('goes by the date for a name it does not know, however odd', () => {
    for (const odd of ['', 'Halloween', 'constructor', '__proto__', 'hasOwnProperty', 'toString', '../halloween', 'none ']) {
      expect(pickSeason(day(9, 30), `?season=${encodeURIComponent(odd)}`)).toBe('halloween')
      expect(pickSeason(day(5, 1), `?season=${encodeURIComponent(odd)}`)).toBeNull()
    }
  })

  it('runs a range over the new year', () => {
    expect(pickSeason(new Date(2026, 11, 1), '', MADE_UP)).toBe('winter')
    expect(pickSeason(new Date(2027, 0, 15), '', MADE_UP)).toBe('winter')
    expect(pickSeason(new Date(2027, 1, 28, 23, 59), '', MADE_UP)).toBe('winter')
    expect(pickSeason(new Date(2027, 2, 1), '', MADE_UP)).toBeNull()
    expect(pickSeason(new Date(2028, 1, 29), '', MADE_UP)).toBe('winter')
    expect(pickSeason(new Date(2028, 2, 1), '', MADE_UP)).toBeNull()
  })

  it('wears the higher priority where seasons overlap, then the first name', () => {
    expect(pickSeason(new Date(2026, 11, 19), '', MADE_UP)).toBe('winter')
    expect(pickSeason(new Date(2026, 11, 20), '', MADE_UP)).toBe('christmas')
    expect(pickSeason(new Date(2026, 11, 31), '', MADE_UP)).toBe('eve')
    expect(pickSeason(new Date(2027, 0, 1), '', MADE_UP)).toBe('christmas')
    expect(pickSeason(new Date(2027, 0, 6), '', MADE_UP)).toBe('christmas')
    expect(pickSeason(new Date(2027, 0, 7), '', MADE_UP)).toBe('winter')
    expect(pickSeason(new Date(2026, 5, 10), '', MADE_UP)).toBe('alpha')
  })

  it('wears nothing without seasons', () => {
    expect(pickSeason(day(9, 30), '', {})).toBeNull()
    expect(pickSeason(day(9, 30), '?season=halloween', {})).toBeNull()
  })
})

describe("the visitor's own clock", () => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const zone = env.TZ
  afterEach(() => {
    if (zone === undefined) delete env.TZ
    else env.TZ = zone
  })

  it('decides by the local date wherever the visitor is', () => {
    // one moment, midday in London on the 26th of October
    const moment = Date.UTC(2026, 9, 26, 12)
    const expected: [string, string | null][] = [
      ['Pacific/Kiritimati', 'halloween'], // UTC+14, already the 27th
      ['Pacific/Auckland', 'halloween'], // UTC+13, the 27th
      ['Europe/Zurich', null],
      ['America/Los_Angeles', null],
      ['Pacific/Pago_Pago', null], // UTC-11, still the 26th
    ]
    for (const [tz, season] of expected) {
      env.TZ = tz
      const now = new Date(moment)
      expect(pickSeason(now, ''), tz).toBe(season)
      expect(poster(now, '', SEASONS).season, tz).toBe(season ?? 'none')
    }
  })

  it('agrees with the poster script across the daylight saving change', () => {
    env.TZ = 'Europe/Zurich'
    // the clocks go back in the night to the 25th of October 2026
    for (let hour = 0; hour < 72; hour++) {
      const now = new Date(Date.UTC(2026, 9, 24, 20) + hour * 3600_000)
      expect(asPage(now, '', SEASONS)).toBe(pickSeason(now, ''))
    }
  })
})

describe('wornSeason', () => {
  it('takes what the poster script chose', () => {
    expect(wornSeason('none', day(9, 30), '')).toBeNull()
    expect(wornSeason('halloween', day(5, 1), '')).toBe('halloween')
  })

  it('keeps the start picture and the dress together across midnight', () => {
    // the poster script ran a moment before midnight, the module a moment after
    const before = poster(day(9, 26, 23, 59, 59, 999), '', SEASONS).season
    expect(wornSeason(before, day(9, 27, 0, 0, 0, 1), '')).toBeNull()
    const lastNight = poster(day(10, 1, 23, 59, 59, 999), '', SEASONS).season
    expect(wornSeason(lastNight, day(10, 2, 0, 0, 0, 1), '')).toBe('halloween')
  })

  it('decides itself when the script left nothing it knows', () => {
    expect(wornSeason(undefined, day(9, 30), '')).toBe('halloween')
    expect(wornSeason(undefined, day(5, 1), '')).toBeNull()
    for (const odd of ['', 'spring', 'constructor', '__proto__', 'Halloween']) {
      expect(wornSeason(odd, day(9, 30), '')).toBe('halloween')
      expect(wornSeason(odd, day(5, 1), '')).toBeNull()
    }
  })
})

describe('posterFolder', () => {
  it("uses the season's own pictures only when its calendar says so", () => {
    expect(posterFolder('halloween', MADE_UP)).toBe('/realm/seasons/halloween')
    expect(posterFolder('christmas', MADE_UP)).toBe('/realm')
    expect(posterFolder(null, MADE_UP)).toBe('/realm')
    expect(posterFolder('spring', MADE_UP)).toBe('/realm')
    expect(posterFolder('constructor', MADE_UP)).toBe('/realm')
  })
})

describe('fetchDress', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('hands over the dress', async () => {
    const worn = { name: 'halloween' } as Dress
    expect(await fetchDress('halloween', () => Promise.resolve(worn))).toBe(worn)
  })

  it('leaves the garden undressed when the code fails to load', async () => {
    const warn = quiet()
    expect(await fetchDress('halloween', () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')))).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('leaves the garden undressed when a season has no dress', async () => {
    const warn = quiet()
    expect(await fetchDress('halloween', undefined)).toBeNull()
    expect(await fetchDress('halloween', () => Promise.resolve(undefined))).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('leaves the garden undressed when the loader itself throws', async () => {
    quiet()
    expect(
      await fetchDress('halloween', () => {
        throw new Error('no chunk')
      }),
    ).toBeNull()
  })
})

describe('the start picture script in index.html', () => {
  it('picks the same season as season.ts on every day, with the real calendars', () => {
    for (const year of [2026, 2028]) {
      for (const t of everyDay(year)) {
        for (const hour of [0, 12, 23]) {
          const now = new Date(year, t.getMonth(), t.getDate(), hour, hour === 23 ? 59 : 0, hour === 23 ? 59 : 0)
          const page = runPoster(now, '', dataBlock(built))
          const season = pickSeason(now, '')
          expect(page.season).toBe(season ?? 'none')
          for (const href of page.hrefs) expect(href.startsWith(`${posterFolder(season)}/`), href).toBe(true)
        }
      }
    }
  })

  it('picks the same season as season.ts on every day, with made-up calendars', () => {
    for (const year of [2026, 2027, 2028]) {
      for (const t of everyDay(year)) {
        for (const search of ['', '?season=none', '?season=christmas', '?season=eve', '?season=spring', '?season=__proto__', '?season=']) {
          const page = poster(t, search, MADE_UP)
          const season = pickSeason(t, search, MADE_UP)
          expect(page.season, `${t.toDateString()} ${search}`).toBe(season ?? 'none')
          for (const href of page.hrefs) expect(href.startsWith(`${posterFolder(season, MADE_UP)}/`), href).toBe(true)
          expect(wornSeason(page.season, t, search, MADE_UP)).toBe(season)
        }
      }
    }
  })

  it('follows the address override', () => {
    expect(runPoster(day(5, 1), '?season=halloween', dataBlock(built)).season).toBe('halloween')
    expect(runPoster(day(9, 30), '?season=none', dataBlock(built))).toEqual({ season: 'none', hrefs: ['/realm/poster-wide.webp', '/realm/poster-tall.webp'] })
  })

  it('wears nothing, and shows the plain pictures, without the calendars', () => {
    for (const block of [null, '', '{', dataBlock(html)]) {
      expect(runPoster(day(9, 30), '', block)).toEqual({ season: 'none', hrefs: ['/realm/poster-wide.webp', '/realm/poster-tall.webp'] })
    }
  })

  it('is given every season by the build, safe inside the page', () => {
    expect(JSON.parse(dataBlock(built))).toEqual(SEASONS)
    expect(SEASONS.halloween).toEqual({ from: [10, 27], to: [11, 1], priority: 0, poster: true })
    expect(built.match(/id="seasons"/g)).toHaveLength(1)
  })

  it('is allowed by its hash in the content policy', async () => {
    // the site is built from a checkout with plain line ends
    const body = new TextEncoder().encode(inline.replace(/\r\n/g, '\n'))
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
    const hash = `'sha256-${btoa(String.fromCharCode(...digest))}'`
    const policy = (JSON.parse(vercel) as { headers: { headers: { key: string; value: string }[] }[] }).headers
      .flatMap((h) => h.headers)
      .find((h) => h.key === 'Content-Security-Policy')
    expect(policy?.value.match(/script-src [^;]*/)?.[0]).toContain(hash)
  })
})
