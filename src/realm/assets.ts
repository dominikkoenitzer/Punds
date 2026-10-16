import * as THREE from 'three'
import type { Tier } from './types'

// Scanned materials live in public/realm/tex/<name>/ as diff, nor (OpenGL
// convention) and arm (ambient occlusion, roughness, metalness in r, g, b),
// at 1k, and at 2k for the sets seen close up. Sources are in CREDITS.md.

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
  const [map, normalMap, arm] = await Promise.all([
    load(`${base}/diff_${size}.webp`, true),
    load(`${base}/nor_${size}.webp`, false),
    load(`${base}/arm_${size}.webp`, false),
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
