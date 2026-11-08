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

// whitespace and case as the HTML tokenizer knows them: a no-break space is not whitespace, only A to Z fold
const isSpace = (c) => c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === ' '
const asciiLower = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase())

// reads a start tag from just past its name the way the tokenizer does; undefined when the page ends inside it
const readTag = (html, from) => {
  const attributes = new Map()
  let i = from
  while (i < html.length) {
    if (isSpace(html[i]) || html[i] === '/') {
      i++
      continue
    }
    if (html[i] === '>') return { attributes, end: i + 1 }
    // the first character is always part of the name, even a quote or an equals sign
    let name = html[i++]
    while (i < html.length && !isSpace(html[i]) && !'/>='.includes(html[i])) name += html[i++]
    while (i < html.length && isSpace(html[i])) i++
    let value = ''
    if (html[i] === '=') {
      i++
      while (i < html.length && isSpace(html[i])) i++
      // a quote opens a value only here; anywhere else it is an ordinary character
      if (html[i] === '"' || html[i] === "'") {
        const close = html.indexOf(html[i], i + 1)
        if (close === -1) return undefined
        value = html.slice(i + 1, close)
        i = close + 1
      } else {
        while (i < html.length && !isSpace(html[i]) && html[i] !== '>') value += html[i++]
      }
    }
    // the first of a repeated name wins
    const key = asciiLower(name)
    if (!attributes.has(key)) attributes.set(key, value)
  }
  return undefined
}

// the script block's type string as the spec builds it, and whether that type is ever run
const isProcessed = (attributes) => {
  let type = attributes.get('type')
  if (type === undefined) {
    const language = attributes.get('language')
    type = language ? `text/${language}` : ''
  }
  // the parser decodes character references in values, so a type holding one is taken as one that may run
  if (type.includes('&')) return true
  type = asciiLower(type.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''))
  return type === '' || JAVASCRIPT.has(type) || PROCESSED.has(type)
}

const html = readFileSync(join(process.argv[2] ?? 'dist', 'index.html'), 'utf8')
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'))
const policy = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
const allowed = policy.match(/script-src [^;]*/)?.[0] ?? ''
// a tag name ends at whitespace, a slash or the closing bracket, so </script/> and </script x> both end a script
const opening = /<script(?=[\t\n\f\r />])/gi
const closing = /<\/script(?=[\t\n\f\r />])/gi
let blocked = 0
for (let open = opening.exec(html); open; open = opening.exec(html)) {
  const tag = readTag(html, opening.lastIndex)
  if (!tag) break
  closing.lastIndex = tag.end
  const close = closing.exec(html)
  // a script still open when the page ends is never run
  if (!close) break
  opening.lastIndex = closing.lastIndex
  const body = html.slice(tag.end, close.index)
  // a data block never runs and a script with a src attribute ignores its body, so neither needs a hash
  const { attributes } = tag
  if (attributes.has('src') || !isProcessed(attributes)) continue
  const hash = `'sha256-${createHash('sha256').update(body.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`
  if (!allowed.includes(hash)) {
    console.error(`inline script not allowed by vercel.json's script-src: ${hash}`)
    blocked++
  }
}
if (blocked) process.exit(1)
