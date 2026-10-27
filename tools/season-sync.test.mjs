import { afterEach, describe, expect, it } from 'vitest'

import { cleanUp, commit, git, remoteAndClone, scratch, write } from './git-fixture.mjs'
import { issueFor, syncSeasons } from './season-sync.mjs'

afterEach(cleanUp)

const tip = (repo, ref) => git(repo, 'rev-parse', ref).trim()
const parents = (repo, ref) => git(repo, 'rev-list', '--parents', '-n', '1', ref).trim().split(' ').slice(1)

// a remote with main and the halloween and christmas branches, and a clean
// clone of it standing on main, as CI has it
function setUp() {
  const { remote, clone } = remoteAndClone()
  git(clone, 'checkout', '--quiet', '-b', 'halloween')
  commit(clone, { 'src/realm/seasons/halloween/index.ts': 'dress, worked on\n' }, 'dress')
  git(clone, 'push', '--quiet', 'origin', 'halloween')
  git(clone, 'checkout', '--quiet', '-b', 'christmas', 'main')
  commit(clone, { 'src/realm/seasons/christmas/index.ts': 'snow\n' }, 'snow')
  git(clone, 'push', '--quiet', 'origin', 'christmas')
  git(clone, 'checkout', '--quiet', 'main')
  return { remote, clone }
}

// someone else's checkout of the same remote
function other(remote) {
  const dir = scratch()
  git(dir, 'clone', '--quiet', remote, '.')
  return dir
}

describe('syncSeasons', () => {
  it('merges a fix on main into every season and pushes it', () => {
    const { remote, clone } = setUp()
    const fix = commit(clone, { 'src/realm/pond.ts': 'pond, fixed\n' }, 'fix')
    git(clone, 'push', '--quiet', 'origin', 'main')
    const before = tip(remote, 'halloween')
    const results = syncSeasons({ cwd: clone, branches: ['halloween', 'christmas'] })
    expect(results.map((r) => r.status)).toEqual(['merged', 'merged'])
    for (const branch of ['halloween', 'christmas']) {
      expect(tip(remote, branch)).toBe(results.find((r) => r.branch === branch).commit)
      expect(parents(remote, branch)[1]).toBe(fix)
      expect(git(remote, 'log', '-1', '--format=%s', branch).trim()).toBe(`merge main into ${branch}`)
      expect(git(remote, 'show', `${branch}:src/realm/pond.ts`)).toBe('pond, fixed\n')
    }
    expect(parents(remote, 'halloween')[0]).toBe(before)
    // the checkout is left as it was found
    expect(git(clone, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main')
    expect(git(clone, 'status', '--porcelain')).toBe('')
  })

  it('leaves a season that already has main alone', () => {
    const { remote, clone } = setUp()
    const before = tip(remote, 'halloween')
    expect(syncSeasons({ cwd: clone, branches: ['halloween'] })).toEqual([{ branch: 'halloween', status: 'current' }])
    expect(tip(remote, 'halloween')).toBe(before)
  })

  it('skips a season branch that does not exist yet', () => {
    const { clone } = setUp()
    expect(syncSeasons({ cwd: clone, branches: ['spring'] })).toEqual([{ branch: 'spring', status: 'missing' }])
  })

  it('aborts on a conflict, pushes nothing and names the files', () => {
    const { remote, clone } = setUp()
    const theirs = other(remote)
    git(theirs, 'checkout', '--quiet', 'halloween')
    commit(theirs, { 'src/realm/pond.ts': 'pond, the season way\n' }, 'reach out')
    git(theirs, 'push', '--quiet', 'origin', 'halloween')
    commit(clone, { 'src/realm/pond.ts': 'pond, the main way\n', 'src/realm/season.ts': 'shared, fine\n' }, 'fix')
    git(clone, 'push', '--quiet', 'origin', 'main')
    const before = { halloween: tip(remote, 'halloween'), christmas: tip(remote, 'christmas') }
    const results = syncSeasons({ cwd: clone, branches: ['halloween', 'christmas'] })
    expect(results[0]).toEqual({ branch: 'halloween', status: 'conflict', files: ['src/realm/pond.ts'] })
    expect(tip(remote, 'halloween')).toBe(before.halloween)
    // the next season still gets main
    expect(results[1].status).toBe('merged')
    expect(tip(remote, 'christmas')).not.toBe(before.christmas)
    expect(git(clone, 'symbolic-ref', '--short', 'HEAD').trim()).toBe('main')
    expect(git(clone, 'status', '--porcelain')).toBe('')
    expect(() => git(clone, 'rev-parse', '--verify', '--quiet', 'MERGE_HEAD')).toThrow()
  })

  it('never overwrites a push that came in after the fetch', () => {
    const { remote, clone } = setUp()
    commit(clone, { 'src/realm/pond.ts': 'pond, fixed\n' }, 'fix')
    git(clone, 'push', '--quiet', 'origin', 'main')
    const theirs = other(remote)
    git(theirs, 'checkout', '--quiet', 'halloween')
    const raced = commit(theirs, { 'src/realm/seasons/halloween/late.ts': 'late\n' }, 'late')
    // someone pushes to the season while the sync is merging: a pre-push hook
    // in the sync's checkout stands in for that moment
    const to = theirs.replace(/\\/g, '/')
    write(clone, '.git/hooks/pre-push', `#!/bin/sh\nunset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE\ngit -C "${to}" push --quiet origin halloween\n`)
    const results = syncSeasons({ cwd: clone, branches: ['halloween'] })
    expect(results[0].status).toBe('failed')
    expect(tip(remote, 'halloween')).toBe(raced)
  })

  it('refuses a checkout with changes', () => {
    const { clone } = setUp()
    write(clone, 'src/realm/pond.ts', 'pond, local\n')
    expect(() => syncSeasons({ cwd: clone, branches: ['halloween'] })).toThrow(/clean/)
  })
})

describe('issueFor', () => {
  it('writes one issue per branch that needs a person', () => {
    const issue = issueFor({ branch: 'halloween', status: 'conflict', files: ['src/realm/pond.ts'] })
    expect(issue.title).toBe('main does not merge into halloween')
    expect(issue.body).toContain('`src/realm/pond.ts`')
    expect(issueFor({ branch: 'halloween', status: 'failed', reason: 'rejected' }).body).toContain('rejected')
    for (const status of ['merged', 'current', 'missing']) expect(issueFor({ branch: 'halloween', status })).toBeNull()
  })
})
