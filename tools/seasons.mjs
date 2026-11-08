import fs from 'node:fs'
import path from 'node:path'

// The seasons the garden can wear, read from their folders: every folder in
// src/realm/seasons/ is one season, named by the folder, and needs an index.ts
// (its dress) and a calendar.json (when it is worn). The build gives the
// calendars to season.ts as `virtual:seasons` and writes them into
// index.html's data block for the poster script. Anything malformed fails the
// build rather than quietly dropping a season. See docs/seasons.md.

export const SEASONS_DIR = 'src/realm/seasons'
export const POSTERS_DIR = 'public/realm/seasons'
export const POSTERS = ['poster-tall.webp', 'poster-wide.webp', 'poster-wide-4k.webp']

// lowercase, used in addresses, folders and branch names; `none` is the
// address's way to wear nothing
const NAME = /^[a-z][a-z0-9-]*$/
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function day(value) {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isInteger)) return false
  const [month, date] = value
  return month >= 1 && month <= 12 && date >= 1 && date <= DAYS[month - 1]
}

// the problems with one season's calendar, none if it is sound
export function calendarProblems(calendar) {
  if (typeof calendar !== 'object' || calendar === null || Array.isArray(calendar)) return ['is not an object']
  const problems = []
  const known = new Set(['from', 'to', 'priority', 'poster'])
  for (const key of Object.keys(calendar)) if (!known.has(key)) problems.push(`has an unknown key "${key}"`)
  if (!day(calendar.from)) problems.push('needs "from" as [month 1-12, day]')
  if (!day(calendar.to)) problems.push('needs "to" as [month 1-12, day]')
  if (!Number.isInteger(calendar.priority)) problems.push('needs a whole number "priority"')
  if (typeof calendar.poster !== 'boolean') problems.push('needs "poster" true or false')
  return problems
}

// every season under root, by name, in name order; throws on the first
// malformed folder
export function readSeasons(root) {
  const dir = path.join(root, SEASONS_DIR)
  if (!fs.existsSync(dir)) return {}
  const seasons = {}
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  for (const name of names) {
    const where = `${SEASONS_DIR}/${name}`
    if (!NAME.test(name) || name === 'none') throw new Error(`${where}: a season's folder name is lowercase letters, digits and dashes, and not "none"`)
    if (!fs.existsSync(path.join(dir, name, 'index.ts'))) throw new Error(`${where}: needs an index.ts that exports its dress`)
    const file = path.join(dir, name, 'calendar.json')
    if (!fs.existsSync(file)) throw new Error(`${where}: needs a calendar.json`)
    let calendar
    try {
      calendar = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      throw new Error(`${where}/calendar.json: ${err.message}`, { cause: err })
    }
    const problems = calendarProblems(calendar)
    if (problems.length) throw new Error(`${where}/calendar.json ${problems.join(', ')}`)
    if (calendar.poster) {
      for (const poster of POSTERS) {
        if (!fs.existsSync(path.join(root, POSTERS_DIR, name, poster))) throw new Error(`${where}: its calendar says poster, but ${POSTERS_DIR}/${name}/${poster} is missing`)
      }
    }
    seasons[name] = { from: calendar.from, to: calendar.to, priority: calendar.priority, poster: calendar.poster }
  }
  return seasons
}

// the calendars as JSON safe to put inside a <script> element
export function seasonsJson(seasons) {
  return JSON.stringify(seasons).replace(/</g, '\\u003c')
}

const MODULE = 'virtual:seasons'
const BLOCK = '<script type="application/json" id="seasons">{}</script>'

export function seasons() {
  let root = process.cwd()
  const read = () => readSeasons(root)
  return {
    name: 'punds-seasons',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      return id === MODULE ? '\0' + MODULE : null
    },
    load(id) {
      if (id !== '\0' + MODULE) return null
      const dir = path.join(root, SEASONS_DIR)
      if (fs.existsSync(dir)) {
        this.addWatchFile(dir)
        for (const name of fs.readdirSync(dir)) this.addWatchFile(path.join(dir, name, 'calendar.json'))
      }
      return `export default ${JSON.stringify(read())}`
    },
    transformIndexHtml(html) {
      if (!html.includes(BLOCK)) throw new Error(`index.html needs the empty seasons block ${BLOCK}`)
      return html.replace(BLOCK, () => BLOCK.replace('{}', seasonsJson(read())))
    },
  }
}
