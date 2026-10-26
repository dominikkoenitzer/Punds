import * as THREE from 'three'
import type { Tier } from './types'
import { CHERRY, MAPLES } from './layout'
import { cherryShape, groveShape, mapleShape, paintAtlasFor, type AtlasData, type CherryOpts, type MapleOpts } from './trees'
import { grassTiles, type GrassTile } from './grass'
import { farGeometry, noiseVolume } from './skyscape'

// The pure, heavy part of the build: atlases painted in code, the trees' and
// the lawn's geometry, the far islands and the clouds' noise. Each job gives
// plain data (typed arrays), so it can run in a worker and cross over without
// a copy; the page turns it back into geometry and textures.

type Typed = Float32Array | Uint32Array | Uint16Array | Uint8Array | Int32Array | Int16Array | Int8Array

export interface PackedGeometry {
  attributes: Record<string, { array: Typed; itemSize: number; normalized: boolean }>
  index: Typed | null
  sphere: [number, number, number, number] | null
  box: [number, number, number, number, number, number] | null
  groups: { start: number; count: number; materialIndex: number }[]
}

export function packGeometry(g: THREE.BufferGeometry): PackedGeometry {
  const attributes: PackedGeometry['attributes'] = {}
  for (const [name, a] of Object.entries(g.attributes)) {
    const attr = a as THREE.BufferAttribute
    attributes[name] = { array: attr.array as Typed, itemSize: attr.itemSize, normalized: attr.normalized }
  }
  const s = g.boundingSphere
  const b = g.boundingBox
  return {
    attributes,
    index: g.index ? (g.index.array as Typed) : null,
    sphere: s ? [s.center.x, s.center.y, s.center.z, s.radius] : null,
    box: b ? [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z] : null,
    groups: g.groups.map((x) => ({ start: x.start, count: x.count, materialIndex: x.materialIndex ?? 0 })),
  }
}

export function unpackGeometry(p: PackedGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  for (const [name, a] of Object.entries(p.attributes)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize, a.normalized))
  if (p.index) g.setIndex(new THREE.BufferAttribute(p.index, 1))
  if (p.sphere) g.boundingSphere = new THREE.Sphere(new THREE.Vector3(p.sphere[0], p.sphere[1], p.sphere[2]), p.sphere[3])
  if (p.box) g.boundingBox = new THREE.Box3(new THREE.Vector3(p.box[0], p.box[1], p.box[2]), new THREE.Vector3(p.box[3], p.box[4], p.box[5]))
  for (const x of p.groups) g.addGroup(x.start, x.count, x.materialIndex)
  return g
}

export function cherryOpts(tier: Tier): CherryOpts {
  return { tier, x: CHERRY.x, z: CHERRY.z, height: CHERRY.height, spread: CHERRY.spread, lean: CHERRY.lean, seed: 11 }
}

export function mapleOpts(tier: Tier): MapleOpts[] {
  return MAPLES.map((m, i) => ({ tier, x: m.x, z: m.z, height: m.height, spread: m.spread, seed: 21 + i }))
}

export interface PackedTree {
  bark: PackedGeometry
  cards: PackedGeometry
  swayNorm: number
}

export interface PackedGrove {
  bark: PackedGeometry
  cards: PackedGeometry
  rope: PackedGeometry | null
}

export interface PackedFar {
  cliff: PackedGeometry
  ranges: PackedGeometry
  plain: PackedGeometry
}

const packTree = (t: { bark: THREE.BufferGeometry; cards: THREE.BufferGeometry; swayNorm: number }): PackedTree => ({
  bark: packGeometry(t.bark),
  cards: packGeometry(t.cards),
  swayNorm: t.swayNorm,
})

export const JOBS = {
  'atlas-blossom': (tier: Tier): AtlasData => paintAtlasFor('blossom', tier),
  cherry: (tier: Tier): PackedTree => packTree(cherryShape(cherryOpts(tier))),
  'atlas-maple': (tier: Tier): AtlasData => paintAtlasFor('maple', tier),
  maples: (tier: Tier): PackedTree[] => mapleOpts(tier).map((o) => packTree(mapleShape(o))),
  'atlas-cedar': (tier: Tier): AtlasData => paintAtlasFor('cedar', tier),
  grove: (tier: Tier): PackedGrove => {
    const g = groveShape(tier)
    return { bark: packGeometry(g.bark), cards: packGeometry(g.cards), rope: g.rope ? packGeometry(g.rope) : null }
  },
  grass: (tier: Tier): GrassTile[] => grassTiles(tier),
  far: (tier: Tier): PackedFar => {
    const f = farGeometry(tier)
    return { cliff: packGeometry(f.cliff), ranges: packGeometry(f.ranges), plain: packGeometry(f.plain) }
  },
  noise: (): Uint8Array => noiseVolume(),
} satisfies Record<string, (tier: Tier) => unknown>

export type JobName = keyof typeof JOBS
export type JobResult<K extends JobName> = ReturnType<(typeof JOBS)[K]>

// the buffers under every typed array in a result, each once
export function transferables(value: unknown, out = new Set<ArrayBuffer>()): ArrayBuffer[] {
  if (ArrayBuffer.isView(value)) {
    if (value.buffer instanceof ArrayBuffer) out.add(value.buffer)
  } else if (Array.isArray(value)) {
    for (const v of value) transferables(v, out)
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) transferables(v, out)
  }
  return [...out]
}

export const unpackTree = (t: PackedTree) => ({ bark: unpackGeometry(t.bark), cards: unpackGeometry(t.cards), swayNorm: t.swayNorm })

export const unpackGrove = (g: PackedGrove) => ({ bark: unpackGeometry(g.bark), cards: unpackGeometry(g.cards), rope: g.rope ? unpackGeometry(g.rope) : null })

export const unpackFar = (f: PackedFar) => ({ cliff: unpackGeometry(f.cliff), ranges: unpackGeometry(f.ranges), plain: unpackGeometry(f.plain) })
