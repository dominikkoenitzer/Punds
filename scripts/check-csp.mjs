// fails when an inline script in the built index.html is not allowed by its
// hash in vercel.json's script-src, so the page never ships with a blocked
// script; hashed as browsers hash it, after the parser turns CRLF into LF
// usage: node scripts/check-csp.mjs [dist folder]
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// the types the HTML spec runs as classic javascript, matched whole and case-insensitively
const JAVASCRIPT = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
])
// the other inline types the browser processes, each checked against script-src
const PROCESSED = new Set(['module', 'importmap', 'speculationrules'])

// attribute names as the HTML parser reads them: whole names, lowercased, the first of a repeated name wins
const attributesOf = (tag) => {
  const attributes = new Map()
  for (const [, name, double, single, bare] of tag.matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const key = name.toLowerCase()
    if (!attributes.has(key)) attributes.set(key, double ?? single ?? bare ?? '')
  }
  return attributes
}

// the script block's type string as the spec builds it, and whether that type is ever run
const isProcessed = (attributes) => {
  let type = attributes.get('type')
  if (type === undefined) {
    const language = attributes.get('language')
    type = language ? `text/${language}` : ''
  }
  type = type.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase()
  return type === '' || JAVASCRIPT.has(type) || PROCESSED.has(type)
}

const html = readFileSync(join(process.argv[2] ?? 'dist', 'index.html'), 'utf8')
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const policy = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
const allowed = policy.match(/script-src [^;]*/)?.[0] ?? ''
let blocked = 0
for (const [, tag, body] of html.matchAll(/<script(?=[\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi)) {
  // a data block never runs and a script with a src attribute ignores its body, so neither needs a hash
  const attributes = attributesOf(tag)
  if (attributes.has('src') || !isProcessed(attributes)) continue
  const hash = `'sha256-${createHash('sha256').update(body.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`
  if (!allowed.includes(hash)) {
    console.error(`inline script not allowed by vercel.json's script-src: ${hash}`)
    blocked++
  }
}
if (blocked) process.exit(1)
