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

// Fetched at low priority, so the sky and the page go first, and decoded off
// the main thread: an image element is decoded on the main thread during the
// upload, which is where most of the long tasks came from.
export async function bitmap(url: string, priority: 'low' | 'auto' = 'low'): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(url, { priority } as RequestInit)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const blob = await res.blob()
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

function load(url: string, color: boolean): Promise<THREE.Texture> {
  let p = cache.get(url)
  if (!p) {
    p = bitmap(url).then((img) => {
      const tex = new THREE.Texture(img)
      tex.flipY = !BITMAP
      tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      tex.anisotropy = maxAnisotropy
      tex.needsUpdate = true
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
// the downloads overlap the build instead of waiting step by step
const SETS = ['soil', 'gravel', 'moss', 'pebbles', 'cliff', 'rock', 'stone', 'wall', 'painted_wood', 'plaster', 'cedar_planks', 'wood_aged', 'copper', 'sakura_bark', 'maple_bark', 'cedar_bark']

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
  const [map, normalMap, arm] = await Promise.all([
    load(`${base}/diff_${size}.webp`, true),
    load(`${base}/nor_${detail}.webp`, false),
    load(`${base}/arm_${detail}.webp`, false),
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
