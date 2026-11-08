// The built site (dist) as Vercel serves it: the headers from vercel.json, the content policy included, so a script
// or request the policy blocks fails here the same way. The one difference is upgrade-insecure-requests, left out
// because this server speaks plain http on 127.0.0.1.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = new URL('../../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PORT = Number(process.env.PORT) || 4620
const vercel = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'))

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.ktx2': 'image/ktx2',
  '.hdr': 'image/vnd.radiance',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
}

// vercel.json sources are path patterns like /(.*) and /assets/(.*)
const rules = vercel.headers.map((h) => ({ re: new RegExp(`^${h.source}$`), headers: h.headers }))

function headersFor(path) {
  const out = {}
  for (const r of rules) {
    if (!r.re.test(path)) continue
    for (const { key, value } of r.headers) out[key] = key === 'Content-Security-Policy' ? value.replace(/;\s*upgrade-insecure-requests/, '') : value
  }
  return out
}

async function file(path) {
  const full = normalize(join(ROOT, path))
  if (!full.startsWith(normalize(ROOT))) return null
  try {
    const s = await stat(full)
    return s.isDirectory() ? file(join(path, 'index.html')) : { full, body: await readFile(full) }
  } catch {
    return null
  }
}

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let found = await file(path)
  let status = 200
  if (!found) {
    found = await file('/404.html')
    status = 404
  }
  res.writeHead(status, { 'Content-Type': TYPES[extname(found.full)] ?? 'application/octet-stream', ...headersFor(path) })
  res.end(found.body)
}).listen(PORT, '127.0.0.1', () => console.log(`listening on http://127.0.0.1:${PORT}/`))
