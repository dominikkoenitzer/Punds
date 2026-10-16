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

const loader = new THREE.TextureLoader()
const cache = new Map<string, Promise<THREE.Texture>>()
let maxAnisotropy = 8

export function setMaxAnisotropy(value: number): void {
  maxAnisotropy = value
}

export function getMaxAnisotropy(): number {
  return maxAnisotropy
}

function load(url: string, color: boolean): Promise<THREE.Texture> {
  let p = cache.get(url)
  if (!p) {
    p = loader.loadAsync(url).then((tex) => {
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

export function texSize(tier: Tier, name: string): '1k' | '2k' {
  return tier !== 'phone' && CLOSE_UP.has(name) ? '2k' : '1k'
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
