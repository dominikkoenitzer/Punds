import * as THREE from 'three'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { describe, expect, it } from 'vitest'

import { pondSdf, POND_LEVEL } from './layout'
import { bakeScan, overCut, placeRock, rockPlacements, scanShape, type Placement, type ScanShape } from './rocks'
import { buildTop } from './terrain'
import type { Tier } from './types'

// Every stone against the ground as drawn: the scans are read from the same
// files the site loads, each stone is placed as the garden places it, and its
// points are dropped onto the triangles of the terrain's own top mesh.

interface Gltf {
  nodes: { mesh?: number; translation?: number[]; rotation?: number[]; scale?: number[]; children?: number[] }[]
  meshes: { primitives: { attributes: Record<string, number> }[] }[]
  accessors: { bufferView: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number }[]
  bufferViews: {
    byteOffset?: number
    byteLength: number
    byteStride?: number
    extensions?: { EXT_meshopt_compression?: { byteOffset?: number; byteLength: number; byteStride: number; count: number; mode: 'ATTRIBUTES'; filter?: 'NONE' | 'OCTAHEDRAL' | 'QUATERNION' | 'EXPONENTIAL' } }
  }[]
}

const ARRAYS: Record<number, Int8ArrayConstructor | Uint8ArrayConstructor | Int16ArrayConstructor | Uint16ArrayConstructor | Float32ArrayConstructor> = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5126: Float32Array,
}

const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(path: URL): Uint8Array }

// the scan's positions and node matrix, as the loader hands them over
async function readScan(name: string): Promise<ScanShape> {
  const bytes = fs.readFileSync(new URL(`../../public/realm/models/${name}.glb`, import.meta.url))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as Gltf
  const bin = bytes.subarray(20 + jsonLength + 8)
  const node = json.nodes.find((n) => n.mesh !== undefined)!
  expect(json.nodes.some((n) => n.children?.length)).toBe(false)
  const accessor = json.accessors[json.meshes[node.mesh!].primitives[0].attributes.POSITION]
  const bufferView = json.bufferViews[accessor.bufferView]
  const packed = bufferView.extensions?.EXT_meshopt_compression
  let data: Uint8Array
  let stride: number
  if (packed) {
    await MeshoptDecoder.ready
    stride = packed.byteStride
    data = new Uint8Array(packed.count * stride)
    const from = packed.byteOffset ?? 0
    MeshoptDecoder.decodeGltfBuffer(data, packed.count, stride, bin.subarray(from, from + packed.byteLength), packed.mode, packed.filter ?? 'NONE')
  } else {
    const from = bufferView.byteOffset ?? 0
    data = bin.slice(from, from + bufferView.byteLength)
    stride = bufferView.byteStride ?? 0
  }
  const Arr = ARRAYS[accessor.componentType]
  const width = Arr.BYTES_PER_ELEMENT
  stride ||= width * 3
  const values = new Arr(accessor.count * 3)
  const at = new DataView(data.buffer, data.byteOffset + (accessor.byteOffset ?? 0))
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < 3; c++) {
      const o = i * stride + c * width
      values[i * 3 + c] = width === 1 ? (Arr === Int8Array ? at.getInt8(o) : at.getUint8(o)) : width === 2 ? (Arr === Int16Array ? at.getInt16(o, true) : at.getUint16(o, true)) : at.getFloat32(o, true)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(values, 3, accessor.normalized ?? false))
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
  )
  const baked = bakeScan(geometry, matrix)
  return scanShape(baked.geometry.getAttribute('position'), baked.size)
}

// the drawn ground: the top mesh's triangles, binned by half metre cells
function groundOf(tier: Tier): (x: number, z: number) => number | null {
  const geometry = buildTop(tier)
  const p = geometry.getAttribute('position')
  const index = geometry.getIndex()!
  const C = 0.5
  const bins = new Map<number, number[]>()
  const key = (cx: number, cz: number) => cx * 100003 + cz
  for (let t = 0; t < index.count; t += 3) {
    const tri = [index.getX(t), index.getX(t + 1), index.getX(t + 2)]
    const xs = tri.map((i) => p.getX(i))
    const zs = tri.map((i) => p.getZ(i))
    for (let cx = Math.floor(Math.min(...xs) / C); cx <= Math.floor(Math.max(...xs) / C); cx++)
      for (let cz = Math.floor(Math.min(...zs) / C); cz <= Math.floor(Math.max(...zs) / C); cz++) {
        const list = bins.get(key(cx, cz)) ?? []
        list.push(...tri)
        bins.set(key(cx, cz), list)
      }
  }
  return (x, z) => {
    const list = bins.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []
    for (let i = 0; i < list.length; i += 3) {
      const [a, b, c] = [list[i], list[i + 1], list[i + 2]]
      const [x1, z1, x2, z2, x3, z3] = [p.getX(a), p.getZ(a), p.getX(b), p.getZ(b), p.getX(c), p.getZ(c)]
      const d = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3)
      if (Math.abs(d) < 1e-12) continue
      const w1 = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / d
      const w2 = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / d
      const w3 = 1 - w1 - w2
      if (w1 >= -1e-6 && w2 >= -1e-6 && w3 >= -1e-6) return w1 * p.getY(a) + w2 * p.getY(b) + w3 * p.getY(c)
    }
    return null
  }
}

type Ground = (x: number, z: number) => number | null
type Support = (p: Placement, x: number, z: number) => number | null

// the ground, or the pond's surface over it; and what a stone can rest on:
// not a cliff (the rim's lip, the cascade's walls), which it may reach out
// over, and for a stone on the cascade's bank not the cut itself
function groundsOf(tier: Tier): { dry: Ground; support: Support } {
  const mesh = groundOf(tier)
  const ground: Ground = (x, z) => {
    const g = mesh(x, z)
    return g === null || pondSdf(x, z) >= 0 ? g : Math.max(g, POND_LEVEL)
  }
  const D = 0.05
  const support: Support = (p, x, z) => {
    if (p.bank && overCut(x, z)) return null
    const [g, e, w, n, s] = [ground(x, z), ground(x + D, z), ground(x - D, z), ground(x, z + D), ground(x, z - D)]
    if (g === null || e === null || w === null || n === null || s === null) return null
    return Math.hypot(e - w, n - s) / (2 * D) < 1 ? g : null
  }
  return { dry: mesh, support }
}

// how a stone meets the ground: over 10 cm columns, the lowest point of each
// column in the stone's bottom quarter, and how far that stands above what
// carries it; and how much of the stone shows above the ground
interface Footing {
  name: string
  at: [number, number]
  lowest: number // its foot's lowest point above what carries it, or above
  // any ground at all for a bank stone with nothing under its foot
  open: number // the widest gap at the foot of the stone
  shows: number // share of its points above the ground, under water or not
}

function footing(name: string, p: Placement, points: Float32Array, matrix: THREE.Matrix4, dry: Ground, support: Support): Footing {
  const v = new THREE.Vector3()
  const world: number[] = []
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < points.length; i += 3) {
    v.fromArray(points, i).applyMatrix4(matrix)
    world.push(v.x, v.y, v.z)
    minY = Math.min(minY, v.y)
    maxY = Math.max(maxY, v.y)
  }
  const band = minY + Math.max(0.25 * (maxY - minY), 0.03)
  const columns = new Map<number, [number, number]>()
  let lowest = Infinity
  let touch = Infinity
  let above = 0
  for (let i = 0; i < world.length; i += 3) {
    const [x, y, z] = [world[i], world[i + 1], world[i + 2]]
    const under = dry(x, z)
    if (under === null || y > under) above++
    if (under !== null) touch = Math.min(touch, y - under)
    const g = support(p, x, z)
    if (g === null || y > band) continue
    lowest = Math.min(lowest, y - g)
    const k = Math.floor(x / 0.1) * 100003 + Math.floor(z / 0.1)
    const prev = columns.get(k)
    if (!prev || y < prev[0]) columns.set(k, [y, y - g])
  }
  let open = 0
  for (const [y, gap] of columns.values()) if (y <= band) open = Math.max(open, gap)
  if (lowest === Infinity) lowest = touch
  return { name, at: [p.x, p.z], lowest, open, shows: above / (world.length / 3) }
}

const names = ['rock_07', 'rock_09', 'boulder_01', 'stone_01']
const scans = new Map<string, ScanShape>()
for (const name of names) scans.set(name, await readScan(name))

it('keeps the scans their size', async () => {
  // the boulder's file holds its positions as normalized 16 bit integers
  const raw = await readScan('boulder_01')
  expect(raw.size.y).toBeCloseTo(1.004, 2)
})

describe.each<Tier>(['high', 'phone'])('the stones on %s', (tier) => {
  const { dry, support } = groundsOf(tier)
  const index = new Map<string, number>()
  const m = new THREE.Matrix4()
  const footings: Footing[] = []
  for (const p of rockPlacements()) {
    // phones draw the two lightest scans in place of the others
    const scan = tier === 'phone' ? ({ boulder_01: 'rock_07', stone_01: 'rock_09' } as Record<string, string>)[p.scan] ?? p.scan : p.scan
    const i = index.get(p.scan) ?? 0
    index.set(p.scan, i + 1)
    const shape = scans.get(scan)!
    // the stones the water runs over are placed by the falls, not the ground
    if (!p.keep) footings.push(footing(`${p.scan}#${i}`, p, shape.points, placeRock(p, shape, i, tier, m), dry, support))
  }
  const list = (fs: Footing[]) => fs.map((f) => `${f.name} at ${f.at.map((a) => a.toFixed(2)).join(', ')}: lowest ${f.lowest.toFixed(3)}, open ${f.open.toFixed(3)}, shows ${f.shows.toFixed(2)}`)

  it('all stand on the ground', () => {
    // a stone may rest on the ground, never hang above it
    expect(list(footings.filter((f) => f.lowest > 0.02 || f.open > 0.04))).toEqual([])
  })

  it('stay in sight', () => {
    // the seat aims at 30 per cent in sight but opens no crack for it; a stone
    // sunk to a sliver would read as a stain on the grass
    expect(list(footings.filter((f) => f.shows < 0.15))).toEqual([])
  })
})
