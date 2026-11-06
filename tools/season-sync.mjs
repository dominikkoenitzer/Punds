import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { BRANCHES } from './season-scope.mjs'

// Brings main's changes into every season branch, so a fix on main reaches
// each season without anyone carrying it over. Merges only, never rebases or
// forces, so published history stays as it is. A merge that conflicts is
// aborted and nothing is pushed for that branch: the conflict is reported for
// a person to resolve, never resolved here. See docs/seasons.md.
//
//   node tools/season-sync.mjs [--remote origin] [--main main] [--out results.json] [--issues dir]

function run(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })
  if (result.error) throw result.error
  return { ok: result.status === 0, out: result.stdout, err: result.stderr }
}

function must(cwd, args) {
  const result = run(cwd, args)
  if (!result.ok) throw new Error(`git ${args.join(' ')}: ${result.err.trim()}`)
  return result.out
}

// merges remote/main into each season branch that exists on the remote and
// pushes the clean ones; returns what happened to each, in list order
export function syncSeasons({ cwd = process.cwd(), remote = 'origin', main = 'main', branches = BRANCHES } = {}) {
  if (must(cwd, ['status', '--porcelain', '--untracked-files=no']).trim()) throw new Error('the checkout has changes; sync needs a clean one')
  const back = run(cwd, ['symbolic-ref', '-q', '--short', 'HEAD']).out.trim() || must(cwd, ['rev-parse', 'HEAD']).trim()
  must(cwd, ['fetch', '--quiet', '--no-tags', remote, `+refs/heads/*:refs/remotes/${remote}/*`])
  const mainRef = `refs/remotes/${remote}/${main}`
  const mainSha = must(cwd, ['rev-parse', '--verify', `${mainRef}^{commit}`]).trim()
  const results = []
  try {
    for (const branch of branches) {
      const ref = `refs/remotes/${remote}/${branch}`
      const found = run(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
      if (!found.ok) {
        results.push({ branch, status: 'missing' })
        continue
      }
      const before = found.out.trim()
      if (run(cwd, ['merge-base', '--is-ancestor', mainSha, before]).ok) {
        results.push({ branch, status: 'current' })
        continue
      }
      must(cwd, ['checkout', '--quiet', '--detach', before])
      const merge = run(cwd, ['merge', '--no-ff', '--no-edit', '-m', `merge ${main} into ${branch}`, mainSha])
      if (!merge.ok) {
        const files = run(cwd, ['diff', '--name-only', '--diff-filter=U', '-z']).out.split('\0').filter(Boolean)
        if (run(cwd, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).ok) must(cwd, ['merge', '--abort'])
        must(cwd, ['reset', '--quiet', '--hard', before])
        results.push(files.length ? { branch, status: 'conflict', files } : { branch, status: 'failed', reason: (merge.err || merge.out).trim() })
        continue
      }
      const after = must(cwd, ['rev-parse', 'HEAD']).trim()
      // only if the branch is still where it was fetched: a push in between
      // is never overwritten
      const push = run(cwd, ['push', '--quiet', '--porcelain', `--force-with-lease=refs/heads/${branch}:${before}`, remote, `${after}:refs/heads/${branch}`])
      results.push(push.ok ? { branch, status: 'merged', commit: after } : { branch, status: 'failed', reason: (push.err || push.out).trim() })
    }
  } finally {
    must(cwd, ['checkout', '--quiet', back])
  }
  return results
}

// one issue per branch that needs a person: its title, and its body
export function issueFor(result, main = 'main') {
  if (result.status === 'conflict') {
    return {
      title: `${main} does not merge into ${result.branch}`,
      body: [
        `Merging ${main} into ${result.branch} conflicts, so the sync left ${result.branch} as it was. Files in conflict:`,
        '',
        ...result.files.map((file) => `- \`${file}\``),
        '',
        `To resolve: in the ${result.branch} worktree, \`git merge ${main}\`, settle the files, then push. Changes to shared code belong on ${main} first.`,
      ].join('\n'),
    }
  }
  if (result.status === 'failed') {
    return { title: `${main} does not merge into ${result.branch}`, body: `The sync could not bring ${main} into ${result.branch}:\n\n\`\`\`\n${result.reason}\n\`\`\`` }
  }
  return null
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const option = (name, fallback) => {
    const at = args.indexOf(name)
    return at >= 0 && args[at + 1] ? args[at + 1] : fallback
  }
  const main = option('--main', 'main')
  try {
    const results = syncSeasons({ remote: option('--remote', 'origin'), main })
    for (const result of results) console.log(`${result.branch}: ${result.status}${result.files ? ` (${result.files.join(', ')})` : ''}${result.reason ? `: ${result.reason}` : ''}`)
    const out = option('--out')
    if (out) fs.writeFileSync(out, JSON.stringify(results, null, 2))
    const issues = option('--issues')
    if (issues) {
      fs.mkdirSync(issues, { recursive: true })
      for (const result of results) {
        const issue = issueFor(result, main)
        if (issue) fs.writeFileSync(path.join(issues, `${result.branch}.md`), `${issue.title}\n${issue.body}\n`)
      }
    }
    if (results.some((result) => result.status === 'conflict' || result.status === 'failed')) process.exitCode = 1
  } catch (err) {
    console.error(err.message)
    process.exitCode = 2
  }
}
