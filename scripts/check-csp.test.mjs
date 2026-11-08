import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const script = path.join(repo, 'scripts', 'check-csp.mjs')
const folders = []

afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

const hashOf = (body) => `'sha256-${createHash('sha256').update(body.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`

// 'passed', 'blocked' when the check named a script it would not allow, or what went wrong otherwise
const outcome = (run) => {
  if (run.status === 0) return 'passed'
  if (run.status === 1 && run.stderr.includes('inline script not allowed')) return 'blocked'
  return `exit ${run.status}: ${run.stderr}`
}

// runs the check in a working folder of its own, with dist/index.html and vercel.json written there
const check = (html, hashes = []) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'punds-csp-'))
  folders.push(folder)
  fs.mkdirSync(path.join(folder, 'dist'))
  fs.writeFileSync(path.join(folder, 'dist', 'index.html'), html)
  const policy = `default-src 'self'; script-src 'self' ${hashes.join(' ')}; object-src 'none'`
  const vercel = { headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: policy }] }] }
  fs.writeFileSync(path.join(folder, 'vercel.json'), JSON.stringify(vercel))
  return outcome(spawnSync(process.execPath, [script], { cwd: folder, encoding: 'utf8' }))
}

const page = (scripts) => `<!doctype html><html><head>${scripts}</head><body></body></html>`
const body = 'console.log(1)'

describe('check-csp', () => {
  it('passes the page as it is today', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'punds-csp-'))
    folders.push(folder)
    fs.mkdirSync(path.join(folder, 'dist'))
    fs.copyFileSync(path.join(repo, 'index.html'), path.join(folder, 'dist', 'index.html'))
    fs.copyFileSync(path.join(repo, 'vercel.json'), path.join(folder, 'vercel.json'))
    expect(outcome(spawnSync(process.execPath, [script], { cwd: folder, encoding: 'utf8' }))).toBe('passed')
  })

  it('passes hashed scripts, scripts with a source and data blocks', () => {
    const crlf = 'var a = 1\r\nvar b = 2\r\n'
    expect(
      check(
        page(
          `<script>${body}</script>` +
            `<script type="module">${crlf}</script>` +
            '<script type="module" src="/main.js"></script>' +
            '<script type="application/ld+json">{"a":1}</script>' +
            '<script type="application/json" id="seasons">{}</script>' +
            "<script type=\"application/json\" data-note=it's>{}</script>" +
            '<script type="text/plain">not code</script>',
        ),
        [hashOf(body), hashOf(crlf)],
      ),
    ).toBe('passed')
  })

  it('fails an unhashed script', () => {
    expect(check(page(`<script>${body}</script>`))).toBe('blocked')
  })

  it('fails an unhashed import map', () => {
    expect(check(page('<script type="importmap">{"imports":{}}</script>'))).toBe('blocked')
  })

  it('fails unhashed speculation rules', () => {
    expect(check(page('<script type="speculationrules">{"prerender":[]}</script>'))).toBe('blocked')
  })

  it('reads a data-type attribute as no type', () => {
    expect(check(page(`<script data-type="application/json">${body}</script>`))).toBe('blocked')
  })

  it('reads a data-src attribute as no source', () => {
    expect(check(page(`<script data-src="/later.js">${body}</script>`))).toBe('blocked')
  })

  it('fails every javascript type the browser runs', () => {
    for (const type of ['text/jscript', 'text/livescript', 'text/javascript1.2', 'TEXT/JavaScript', ' text/ecmascript ', 'application/x-javascript', 'MODULE', '']) {
      expect(check(page(`<script type="${type}">${body}</script>`)), type).toBe('blocked')
    }
  })

  it('reads a quote inside an unquoted value as part of the value', () => {
    const data = (note) => `<script type="application/json" data-note=${note}>{}</script>`
    expect(check(page(`${data("it's")}<script>${body}</script>${data("isn't")}`))).toBe('blocked')
  })

  it('ends a script at a closing tag with a slash', () => {
    expect(check(page(`<script>${body}</script/>`))).toBe('blocked')
  })

  it('reads a type with a character reference as one that may run', () => {
    expect(check(page(`<script type="text&#47;javascript">${body}</script>`))).toBe('blocked')
  })

  it('reads a no-break space before the equals sign as part of the name', () => {
    expect(check(page(`<script type${String.fromCharCode(0xa0)}="application/json">${body}</script>`))).toBe('blocked')
  })
})
