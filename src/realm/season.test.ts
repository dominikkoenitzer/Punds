import { afterEach, describe, expect, it, vi } from 'vitest'

import html from '../../index.html?raw'
import vercel from '../../vercel.json?raw'
import { pickSeason } from './season'

const day = (month: number, date: number, hour = 12) => new Date(2026, month, date, hour)

// the inline script in index.html makes the same choice before the first
// paint; run it against a stand-in page and read which poster it preloads
const inline = (() => {
  const found = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((m) => m[1].includes("get('season')"))
  if (!found) throw new Error('poster script not found in index.html')
  return found[1]
})()

function posterSeason(date: Date, search: string): 'halloween' | null {
  const links: { href: string }[] = []
  const FixedDate = class extends Date {
    constructor() {
      super(date.getTime())
    }
  }
  const document = {
    createElement: () => ({ setAttribute() {} }) as unknown as { href: string },
    head: { append: (...items: { href: string }[]) => links.push(...items) },
  }
  new Function('location', 'Date', 'document', inline)({ search }, FixedDate, document)
  return links.every((l) => l.href.startsWith('/realm/halloween/')) ? 'halloween' : null
}

describe('pickSeason', () => {
  it('wears Halloween from the 27th of October to the 11th of November', () => {
    expect(pickSeason(day(9, 27, 0), '')).toBe('halloween')
    expect(pickSeason(day(9, 31, 23), '')).toBe('halloween')
    expect(pickSeason(day(10, 1, 23), '')).toBe('halloween')
    expect(pickSeason(new Date(2026, 10, 11, 23, 59, 59), '')).toBe('halloween')
  })

  it('wears nothing on the days around it', () => {
    expect(pickSeason(day(9, 26, 23), '')).toBeNull()
    expect(pickSeason(new Date(2026, 10, 12, 0, 0, 0), '')).toBeNull()
    expect(pickSeason(day(10, 12, 0), '')).toBeNull()
    expect(pickSeason(day(0, 1), '')).toBeNull()
    expect(pickSeason(day(11, 31), '')).toBeNull()
    expect(pickSeason(day(8, 30), '')).toBeNull()
  })

  it('lets the address override the date both ways', () => {
    expect(pickSeason(day(5, 1), '?season=halloween')).toBe('halloween')
    expect(pickSeason(day(9, 30), '?season=none')).toBeNull()
    expect(pickSeason(day(9, 30), '?season=spring')).toBe('halloween')
  })
})

describe('the clock it reads', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // the visitor's own date counts: the same instant is the 12th in Zurich
  // and still the 11th in New York
  it.each([
    ['Europe/Zurich', null],
    ['America/New_York', 'halloween'],
  ])('ends at midnight of the visitor in %s', (tz, expected) => {
    vi.stubEnv('TZ', tz)
    const instant = new Date(Date.UTC(2026, 10, 11, 23, 30))
    expect(new Intl.DateTimeFormat('en', { timeZone: tz, day: 'numeric' }).format(instant)).toBe(String(instant.getDate()))
    expect(pickSeason(instant, '')).toBe(expected)
    expect(posterSeason(instant, '')).toBe(expected)
  })
})

describe('the start picture script in index.html', () => {
  it('picks the same season as pickSeason on every day of the year', () => {
    for (let t = new Date(2026, 0, 1); t.getFullYear() === 2026; t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)) {
      expect(posterSeason(t, '')).toBe(pickSeason(t, ''))
    }
  })

  it('follows the address override', () => {
    expect(posterSeason(day(5, 1), '?season=halloween')).toBe('halloween')
    expect(posterSeason(day(9, 30), '?season=none')).toBeNull()
  })

  it('is allowed by its hash in the content policy', async () => {
    // browsers hash the script after the parser turns CRLF into LF
    const body = new TextEncoder().encode(inline.replace(/\r\n?/g, '\n'))
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
    const hash = `'sha256-${btoa(String.fromCharCode(...digest))}'`
    const policy = (JSON.parse(vercel) as { headers: { headers: { key: string; value: string }[] }[] }).headers
      .flatMap((h) => h.headers)
      .find((h) => h.key === 'Content-Security-Policy')
    expect(policy?.value.match(/script-src [^;]*/)?.[0]).toContain(hash)
  })
})
