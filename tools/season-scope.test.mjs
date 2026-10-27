import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanUp, commit, git, remoteAndClone } from './git-fixture.mjs'
import { BRANCHES, checkScope, entryProblem, parseRaw, seasonOf } from './season-scope.mjs'

afterEach(cleanUp)

const file = (path, status = 'M', newMode = '100644') => ({ path, status, oldMode: '100644', newMode })

describe('entryProblem', () => {
  it('lets a season change its own two folders', () => {
    for (const path of ['src/realm/seasons/halloween/index.ts', 'src/realm/seasons/halloween/deep/er/x.glsl', 'public/realm/seasons/halloween/poster-tall.webp', 'src/realm/seasons/halloween/.gitkeep']) {
      expect(entryProblem(file(path), 'halloween'), path).toBeNull()
      expect(entryProblem(file(path, 'D'), 'halloween'), path).toBeNull()
    }
  })

  it('stops it everywhere else, however the path is dressed up', () => {
    for (const path of [
      'src/realm/season.ts',
      'src/realm/seasons/christmas/index.ts',
      'src/realm/seasons/halloween-evil/index.ts',
      'src/realm/seasons/halloweenx/index.ts',
      'src/realm/seasons/Halloween/index.ts',
      'src/realm/Seasons/halloween/index.ts',
      'SRC/realm/seasons/halloween/index.ts',
      'src/realm/seasons/halloween',
      'src/realm/seasons/halloween/',
      'public/realm/seasons/halloween',
      'public/realm/halloween/poster-tall.webp',
      'src/realm/seasons/halloween/../season.ts',
      'src/realm/seasons/halloween/./index.ts',
      'src/realm/seasons/halloween//index.ts',
      'src/realm/seasons/halloween/..\\..\\season.ts',
      'src/realm/seasons/halloween/a b.ts',
      'src/realm/seasons/halloween/İndex.ts',
      'src/realm/seasons/halloween/x\nsrc/realm/season.ts',
      './src/realm/seasons/halloween/index.ts',
      '/src/realm/seasons/halloween/index.ts',
      'x/src/realm/seasons/halloween/index.ts',
      '.github/workflows/ci.yml',
      'tools/season-branches.json',
      'vercel.json',
    ]) {
      expect(entryProblem(file(path), 'halloween'), path).not.toBeNull()
    }
  })

  it('counts a deletion outside as reaching outside', () => {
    expect(entryProblem(file('src/realm/pond.ts', 'D'), 'halloween')).toMatch(/deleted/)
  })

  it('stops links and submodules inside the folder', () => {
    expect(entryProblem(file('src/realm/seasons/halloween/season.ts', 'A', '120000'), 'halloween')).toMatch(/symbolic link/)
    expect(entryProblem(file('src/realm/seasons/halloween/index.ts', 'T', '120000'), 'halloween')).toMatch(/symbolic link/)
    expect(entryProblem(file('src/realm/seasons/halloween/vendor', 'A', '160000'), 'halloween')).toMatch(/submodule/)
  })
})

describe('parseRaw', () => {
  it('reads paths exactly, with no quoting', () => {
    const raw = ':100644 100644 aaaa bbbb M\0src/a "b".ts\0:000000 120000 0000 cccc A\0src/l\0:100644 000000 dddd 0000 D\0src/ä\0'
    expect(parseRaw(raw)).toEqual([
      { oldMode: '100644', newMode: '100644', status: 'M', path: 'src/a "b".ts' },
      { oldMode: '000000', newMode: '120000', status: 'A', path: 'src/l' },
      { oldMode: '100644', newMode: '000000', status: 'D', path: 'src/ä' },
    ])
    expect(parseRaw('')).toEqual([])
  })
})

describe('checkScope', () => {
  function seasonBranch() {
    const { clone } = remoteAndClone()
    git(clone, 'checkout', '--quiet', '-b', 'halloween')
    return clone
  }

  it('passes a branch that stays in its folders', () => {
    const clone = seasonBranch()
    commit(clone, { 'src/realm/seasons/halloween/index.ts': 'more dress\n', 'public/realm/seasons/halloween/poster-tall.webp': 'p' }, 'dress')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([])
  })

  it('fails a branch that changes shared code, even in an older commit', () => {
    const clone = seasonBranch()
    commit(clone, { 'src/realm/pond.ts': 'pond, changed\n' }, 'reach out')
    commit(clone, { 'src/realm/seasons/halloween/index.ts': 'more dress\n' }, 'dress')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([expect.stringMatching(/^src\/realm\/pond.ts: outside/)])
  })

  it('passes a change to shared code that the branch took back again', () => {
    const clone = seasonBranch()
    commit(clone, { 'src/realm/pond.ts': 'pond, changed\n' }, 'reach out')
    commit(clone, { 'src/realm/pond.ts': 'pond\n' }, 'take it back')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([])
  })

  it('fails a move out of shared code into the folder', () => {
    const clone = seasonBranch()
    git(clone, 'mv', 'src/realm/pond.ts', 'src/realm/seasons/halloween/pond.ts')
    git(clone, 'commit', '--quiet', '-m', 'move')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([expect.stringMatching(/^src\/realm\/pond.ts: .*deleted/)])
  })

  it('fails a link in the folder that points at shared code', () => {
    const clone = seasonBranch()
    const blob = git(clone, 'hash-object', '-w', '--stdin').trim()
    git(clone, 'update-index', '--add', '--cacheinfo', `120000,${blob},src/realm/seasons/halloween/season.ts`)
    git(clone, 'commit', '--quiet', '-m', 'link')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([expect.stringMatching(/symbolic link/)])
  })

  it('fails a submodule in the folder', () => {
    const clone = seasonBranch()
    const head = git(clone, 'rev-parse', 'HEAD').trim()
    git(clone, 'update-index', '--add', '--cacheinfo', `160000,${head},src/realm/seasons/halloween/vendor`)
    git(clone, 'commit', '--quiet', '-m', 'submodule')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([expect.stringMatching(/submodule/)])
  })

  it('ignores what main brought in through a merge, and sees what the merge itself changed', () => {
    const clone = seasonBranch()
    commit(clone, { 'src/realm/seasons/halloween/index.ts': 'more dress\n' }, 'dress')
    git(clone, 'checkout', '--quiet', 'main')
    commit(clone, { 'src/realm/pond.ts': 'pond, fixed on main\n' }, 'fix')
    git(clone, 'push', '--quiet', 'origin', 'main')
    git(clone, 'fetch', '--quiet', 'origin')
    git(clone, 'checkout', '--quiet', 'halloween')
    git(clone, 'merge', '--quiet', '--no-ff', '--no-edit', 'origin/main')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([])
    // an evil merge: shared code changed inside the merge commit
    git(clone, 'reset', '--quiet', '--hard', 'HEAD~1')
    git(clone, 'merge', '--quiet', '--no-ff', '--no-commit', 'origin/main')
    fs.writeFileSync(`${clone}/src/realm/season.ts`, 'shared, changed in the merge\n')
    git(clone, 'add', 'src/realm/season.ts')
    git(clone, 'commit', '--quiet', '--no-edit')
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([expect.stringMatching(/^src\/realm\/season.ts: outside/)])
  })

  it('checks against every merge base after crossed merges', () => {
    const { clone } = remoteAndClone()
    git(clone, 'checkout', '--quiet', '-b', 'halloween')
    commit(clone, { 'src/realm/pond.ts': 'pond, from halloween\n' }, 'reach out')
    const h1 = git(clone, 'rev-parse', 'HEAD').trim()
    git(clone, 'checkout', '--quiet', 'main')
    const m1 = commit(clone, { 'README.md': 'main\n' }, 'main moves')
    // main takes h1, the season takes m1, each without the other's merge
    git(clone, 'merge', '--quiet', '--no-ff', '--no-edit', h1)
    git(clone, 'push', '--quiet', 'origin', 'main')
    git(clone, 'fetch', '--quiet', 'origin')
    git(clone, 'checkout', '--quiet', 'halloween')
    git(clone, 'merge', '--quiet', '--no-ff', '--no-edit', m1)
    commit(clone, { 'src/realm/season.ts': 'shared, from halloween\n' }, 'reach out again')
    expect(git(clone, 'merge-base', '--all', 'origin/main', 'HEAD').trim().split('\n').length).toBe(2)
    // pond.ts is on main already and README.md came from main: only the
    // second reach counts
    expect(checkScope({ cwd: clone, season: 'halloween' })).toEqual([expect.stringMatching(/^src\/realm\/season.ts: outside/)])
  })

  it('says so when the base or the history is missing', () => {
    const clone = seasonBranch()
    expect(() => checkScope({ cwd: clone, season: 'halloween', base: 'origin/nothing' })).toThrow(/origin\/nothing is not a commit/)
    // a branch with no history in common with main, as a shallow checkout
    // would look
    git(clone, 'checkout', '--quiet', '--orphan', 'stray')
    commit(clone, { 'src/realm/seasons/halloween/index.ts': 'alone\n' }, 'alone')
    expect(() => checkScope({ cwd: clone, season: 'halloween' })).toThrow(/no common history/)
  })
})

describe('seasonOf', () => {
  it('finds the season of a push, a pull request and a local run', () => {
    expect(seasonOf({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'halloween', GITHUB_HEAD_REF: '' }, 'x')).toBe('halloween')
    expect(seasonOf({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'main', GITHUB_HEAD_REF: '' }, 'halloween')).toBeNull()
    expect(seasonOf({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: '3/merge', GITHUB_HEAD_REF: 'christmas', GITHUB_BASE_REF: 'main' }, 'x')).toBe('christmas')
    expect(seasonOf({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: '3/merge', GITHUB_HEAD_REF: 'fix', GITHUB_BASE_REF: 'halloween' }, 'x')).toBe('halloween')
    expect(seasonOf({ GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF_NAME: '3/merge', GITHUB_HEAD_REF: 'fix', GITHUB_BASE_REF: 'main' }, 'x')).toBeNull()
    expect(seasonOf({}, 'spring')).toBe('spring')
    expect(seasonOf({}, 'main')).toBeNull()
  })
})

describe('the season branch list', () => {
  const ci = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

  it('holds lowercase names that are also season folder names', () => {
    for (const name of BRANCHES) expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(new Set(BRANCHES).size).toBe(BRANCHES.length)
  })

  it('is what CI runs on, beside main', () => {
    const push = ci.match(/\non:\n {2}push:\n {4}branches:\n((?: {6}- .+\n)+)/)
    expect(push, 'push branches in ci.yml').not.toBeNull()
    const listed = push[1].trim().split('\n').map((line) => line.replace(/^\s*- /, '').replace(/^'|'$/g, ''))
    expect(listed).toEqual(['main', ...BRANCHES])
  })

  it('is checked for scope in CI', () => {
    expect(ci).toMatch(/node tools\/season-scope\.mjs/)
    expect(ci).toMatch(/fetch-depth: 0/)
  })
})
