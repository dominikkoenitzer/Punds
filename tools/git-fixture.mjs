import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Throwaway repositories for the tools' tests, cut off from the machine's own
// git settings (hooks, line ends, identity), so a test sees only what it made.
// The tools under test run git too, so the whole test process is cut off.

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'season-gitconfig-'))
fs.writeFileSync(path.join(home, 'config'), ['[user]', '\tname = test', '\temail = test@example.invalid', '[core]', '\tautocrlf = false', '[init]', '\tdefaultBranch = main', ''].join('\n'))
process.env.GIT_CONFIG_GLOBAL = path.join(home, 'config')
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }))

const made = []

export function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'season-git-'))
  made.push(dir)
  return dir
}

export function cleanUp() {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
}

export function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

export function write(cwd, file, body) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
  fs.writeFileSync(path.join(cwd, file), body)
}

// writes, or with null removes, each file, and commits them
export function commit(cwd, files, message) {
  for (const [file, body] of Object.entries(files)) {
    if (body === null) git(cwd, 'rm', '--quiet', file)
    else {
      write(cwd, file, body)
      git(cwd, 'add', file)
    }
  }
  git(cwd, 'commit', '--quiet', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD').trim()
}

// a bare remote and a clone of it with a first commit on main
export function remoteAndClone() {
  const remote = scratch()
  git(remote, 'init', '--quiet', '--bare', '-b', 'main')
  const clone = scratch()
  git(clone, 'init', '--quiet', '-b', 'main')
  git(clone, 'remote', 'add', 'origin', remote)
  commit(clone, { 'src/realm/season.ts': 'shared\n', 'src/realm/pond.ts': 'pond\n', 'src/realm/seasons/halloween/index.ts': 'dress\n' }, 'first')
  git(clone, 'push', '--quiet', 'origin', 'main')
  git(clone, 'fetch', '--quiet', 'origin')
  return { remote, clone }
}
