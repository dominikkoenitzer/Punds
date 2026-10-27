// fails when an inline script in the built index.html is not allowed by its
// hash in vercel.json's script-src, so the page never ships with a blocked
// script (a checkout with CRLF line ends changes the hash)
// usage: node scripts/check-csp.mjs [dist folder]
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(process.argv[2] ?? 'dist', 'index.html'), 'utf8')
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const policy = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
const allowed = policy.match(/script-src [^;]*/)?.[0] ?? ''
let blocked = 0
for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc=/.test(attrs) || /type="application\/ld\+json"/.test(attrs)) continue
  const hash = `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`
  if (!allowed.includes(hash)) {
    console.error(`inline script not allowed by vercel.json's script-src: ${hash}${body.includes('\r') ? ' (it has CRLF line ends)' : ''}`)
    blocked++
  }
}
if (blocked) process.exit(1)
