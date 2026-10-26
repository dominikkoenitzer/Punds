import * as THREE from 'three'
import type { Tier } from './types'

// Scanned materials live in public/realm/tex/<name>/ as diff, nor (OpenGL
// convention) and arm (ambient occlusion, roughness, metalness in r, g, b),
// at 1k, at 2k for the sets seen close up, and relief and roughness at 512
// for phones. Sources are in CREDITS.md.

export interface PbrSet {
  map: THREE.Texture
  normalMap: THREE.Texture
  arm: THREE.Texture
}

const cache = new Map<string, Promise<THREE.Texture>>()
let maxAnisotropy = 8
// hands each image to the GPU as it arrives, while the load waits anyway,
// rather than all at once in the first frames
let upload: ((texture: THREE.Texture) => void) | null = null

export function setUploader(f: ((texture: THREE.Texture) => void) | null): void {
  upload = f
}

export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = value
}

export function getMaxAnisotropy(): number {
  return maxAnisotropy
}

// Older Safari and Firefox ignore the options below and would hand the maps
// over upside down; they decode through an image element as before. Where
// this is true the decoded image is already flipped for the GPU.
export const BITMAP = (() => {
  if (typeof createImageBitmap === 'undefined') return false
  const ua = navigator.userAgent
  const safari = /^((?!chrome|android).)*safari/i.test(ua) ? /Version\/(\d+)/.exec(ua) : undefined
  const firefox = /Firefox\/(\d+)/.exec(ua)
  return !(safari !== undefined && (!safari || Number(safari[1]) < 17)) && !(firefox && Number(firefox[1]) < 98)
})()

// The downloads of the load go a few at a time, in the order the build needs
// them (lowest rank first). Over HTTP/2 they would all share the line at
// once, and the first step's ground would land together with the last tree's
// bark. A finished download hands its lane to the next in line.
const LANES = 4
let busy = 0
const line: { rank: number; go: () => void }[] = []

export async function inTurn<T>(rank: number, job: () => Promise<T>): Promise<T> {
  if (busy < LANES) busy++
  else {
    await new Promise<void>((go) => {
      const at = line.findIndex((w) => w.rank > rank)
      line.splice(at < 0 ? line.length : at, 0, { rank, go })
    })
  }
  try {
    return await job()
  } finally {
    const next = line.shift()
    if (next) next.go()
    else busy--
  }
}

// the sky's files first: every program waits for its light
export const SKY_RANK = 0

async function download(url: string, priority: 'low' | 'auto'): Promise<Blob> {
  const res = await fetch(url, { priority } as RequestInit)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.blob()
}

// Fetched at low priority, so the page goes first, in line when a rank is
// given, and decoded off the main thread: an image element is decoded on the
// main thread during the upload, which is where most of the long tasks came
// from.
export async function bitmap(url: string, priority: 'low' | 'auto' = 'low', rank?: number): Promise<ImageBitmap | HTMLImageElement> {
  const blob = await (rank === undefined ? download(url, priority) : inTurn(rank, () => download(url, priority)))
  if (BITMAP) return createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  const src = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(src)
  }
}

function load(url: string, color: boolean, rank: number): Promise<THREE.Texture> {
  let p = cache.get(url)
  if (!p) {
    p = bitmap(url, 'low', rank).then((img) => {
      const tex = new THREE.Texture(img)
      tex.flipY = !BITMAP
      tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = maxAnisotropy
      tex.needsUpdate = true
      upload?.(tex)
      return tex
    })
    cache.set(url, p)
  }
  return p
}

// sets seen at arm's length get 2k on desktops; ground cover, cliffs and far
// bark never come close enough to need it
const CLOSE_UP = new Set(['stone', 'wall', 'cedar_planks', 'painted_wood', 'wood_aged', 'plaster', 'copper', 'gravel', 'sakura_bark'])

// The first view loads every set at 1k: the 2k sets are three quarters of the
// download and the start view hardly tells them apart. upgradeTextures()
// swaps the 2k images in once the garden is showing.
let firstPass = true

export function texSize(tier: Tier, name: string): '1k' | '2k' {
  return tier !== 'phone' && CLOSE_UP.has(name) && !firstPass ? '2k' : '1k'
}

// every scanned set the island asks for, requested together at the start so
// the downloads overlap the build instead of waiting step by step, in the
// order of the build: ground, paving and walls, the shrine, then the barks
const SETS = ['soil', 'gravel', 'moss', 'pebbles', 'cliff', 'rock', 'stone', 'wall', 'painted_wood', 'plaster', 'cedar_planks', 'wood_aged', 'copper', 'maple_bark', 'sakura_bark', 'cedar_bark']

const rankOf = (name: string) => 1 + Math.max(0, SETS.indexOf(name))

// the scanned rocks come after the shrine and before the barks
export const SCANS_RANK = rankOf('copper') + 0.5

export function prefetchSets(tier: Tier): void {
  for (const name of SETS) loadPbr(name, tier).catch(() => {})
}

// the path under the start view first, then the rest
const UPGRADE_FIRST = ['gravel', 'stone']

// Replace the 1k images of the close-up sets with 2k in place. Clones share
// the source, so every material picks the new image up; one upload per call
// of between(), so each gets its own frame.
export async function upgradeTextures(tier: Tier, between: () => Promise<void>): Promise<void> {
  firstPass = false
  if (tier === 'phone') return
  const rank = (url: string) => {
    const i = UPGRADE_FIRST.findIndex((n) => url.includes(`/tex/${n}/`))
    return i < 0 ? UPGRADE_FIRST.length : i
  }
  const urls = [...cache.keys()].filter((url) => {
    const m = /\/realm\/tex\/([a-z_]+)\/(?:diff|nor|arm)_1k\.webp$/.exec(url)
    return m !== null && CLOSE_UP.has(m[1]!)
  })
  urls.sort((a, b) => rank(a) - rank(b))
  for (const url of urls) {
    const tex = await cache.get(url)!.catch(() => null)
    if (!tex) continue
    const big = await bitmap(url.replace('_1k.webp', '_2k.webp')).catch(() => null)
    if (!big) continue
    await between()
    const old = tex.source.data as { close?: () => void }
    tex.source.data = big
    tex.source.needsUpdate = true
    old.close?.()
  }
}

// The three maps of one scanned material. Textures are shared between every
// caller that asks for the same set; clone one before changing its repeat.
export async function loadPbr(name: string, tier: Tier): Promise<PbrSet> {
  const base = `/realm/tex/${name}`
  const size = texSize(tier, name)
  // a phone screen cannot show the fine relief of a 1k normal map, and the
  // download matters more there: relief and roughness come at 512
  const detail = tier === 'phone' ? '512' : size
  const rank = rankOf(name)
  const [map, normalMap, arm] = await Promise.all([
    load(`${base}/diff_${size}.webp`, true, rank),
    load(`${base}/nor_${detail}.webp`, false, rank),
    load(`${base}/arm_${detail}.webp`, false, rank),
  ])
  return { map, normalMap, arm }
}

// A standard material wired to a scanned set: the arm texture feeds ambient
// occlusion, roughness and metalness at once.
export function pbrMaterial(set: PbrSet, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    aoMap: set.arm,
    roughnessMap: set.arm,
    metalnessMap: set.arm,
    roughness: 1,
    metalness: 1,
    ...params,
  })
}
