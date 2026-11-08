import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

// A season branch may change only its own two folders; anything else it
// needs (a new hook in a core part) lands on main first. This check fails
// when landing the branch on main would change anything else.
// See docs/seasons.md.
//
//   node tools/season-scope.mjs [base]   base defaults to origin/main

export const BRANCHES = JSON.parse(fs.readFileSync(new URL('./season-branches.json', import.meta.url), 'utf8'))

// a plain path segment: no `.` or `..`, nothing a checkout could read as a
// different place
const SEGMENT = /^(?!\.{1,2}$)[A-Za-z0-9._@+-]+$/
const LINK = '120000'
const SUBMODULE = '160000'

// what is wrong with one changed entry for this season, or null
export function entryProblem(entry, season) {
  const { path, status, newMode } = entry
  const segments = path.split('/')
  if (!segments.every((s) => SEGMENT.test(s))) return `${path}: only plain names (letters, digits, . _ @ + -) are allowed in a season's paths`
  const own = [`src/realm/seasons/${season}/`, `public/realm/seasons/${season}/`]
  if (!own.some((folder) => path.startsWith(folder) && path.length > folder.length)) return `${path}: outside src/realm/seasons/${season}/ and public/realm/seasons/${season}/ (${status === 'D' ? 'deleted' : 'changed'})`
  if (status !== 'D' && newMode === LINK) return `${path}: a symbolic link`
  if (status !== 'D' && newMode === SUBMODULE) return `${path}: a submodule`
  return null
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
}

// the entries `git diff --raw -z --no-renames` prints
export function parseRaw(raw) {
  const parts = raw.split('\0')
  const entries = []
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const meta = parts[i]
    if (!meta) break
    const [oldMode, newMode, , , status] = meta.slice(1).split(' ')
    entries.push({ oldMode, newMode, status: status[0], path: parts[i + 1] })
  }
  return entries
}

// every problem with what the branch at head would change on base if it
// landed there now: the two are merged in memory (crossed merges included)
// and the result is compared with base, so main's own changes never count
// and nothing the branch did, even inside a merge commit, is missed
export function checkScope({ cwd = process.cwd(), season, base = 'origin/main', head = 'HEAD' }) {
  for (const ref of [base, head]) {
    if (spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd }).status !== 0) throw new Error(`${ref} is not a commit here`)
  }
  // merge-tree's exit codes mix conflicts with errors, so the history is
  // checked first
  if (spawnSync('git', ['merge-base', base, head], { cwd }).status !== 0) {
    throw new Error(`no common history between ${base} and ${head} (a shallow checkout needs fetch-depth 0)`)
  }
  const merged = spawnSync('git', ['merge-tree', '--write-tree', '--no-messages', base, head], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })
  if (merged.error) throw merged.error
  // 0 merges cleanly, 1 with conflicts (the tree then holds both sides)
  const tree = merged.stdout.split('\n')[0].trim()
  if ((merged.status !== 0 && merged.status !== 1) || !/^[0-9a-f]{40,64}$/.test(tree)) throw new Error(`${base} and ${head} could not be merged: ${merged.stderr.trim()}`)
  const problems = []
  for (const entry of parseRaw(git(cwd, ['diff', '--raw', '-z', '--no-renames', '--no-ext-diff', base, tree]))) {
    const problem = entryProblem(entry, season)
    if (problem) problems.push(problem)
  }
  return problems
}

// the season a run checks: the branch being pushed, or for a pull request the
// branch it comes from, else the season branch it goes into
export function seasonOf(env, current) {
  const names = env.GITHUB_EVENT_NAME === 'pull_request' ? [env.GITHUB_HEAD_REF, env.GITHUB_BASE_REF] : env.GITHUB_ACTIONS ? [env.GITHUB_REF_NAME] : [current]
  return names.find((name) => name && BRANCHES.includes(name)) ?? null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const current = git(process.cwd(), ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
  const season = seasonOf(process.env, current)
  if (!season) {
    console.log('not a season branch, nothing to check')
  } else {
    const base = process.argv[2] ?? 'origin/main'
    try {
      const problems = checkScope({ season, base })
      if (problems.length) {
        console.error(`${season} reaches outside its folders since it last met ${base}; land shared changes on main first:`)
        for (const problem of problems) console.error(`  ${problem}`)
        process.exitCode = 1
      } else {
        console.log(`${season} stays inside its folders`)
      }
    } catch (err) {
      console.error(err.message)
      process.exitCode = 2
    }
  }
}
