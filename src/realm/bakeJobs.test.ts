import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { JOBS, cherryOpts, packGeometry, transferables, unpackGeometry, unpackTree, type JobName } from './bakeJobs'
import { cherryShape } from './trees'

// the jobs that need no canvas; the painted atlases are checked in a browser
const PLAIN: JobName[] = ['cherry', 'maples', 'grove', 'grass', 'far', 'noise']

function bytes(a: ArrayBufferView): number[] {
  return Array.from(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
}

// the first place two results differ, or null; typed arrays byte for byte
function difference(a: unknown, b: unknown, path = ''): string | null {
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor) return `${path}: kind`
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
    if (x.length !== y.length) return `${path}: length`
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return `${path}: byte ${i}`
    return null
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    if (ka.join() !== Object.keys(b).join()) return `${path}: keys`
    for (const k of ka) {
      const d = difference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
      if (d) return d
    }
    return null
  }
  return Object.is(a, b) ? null : `${path}: ${String(a)} vs ${String(b)}`
}

describe('background jobs', () => {
  it.each(PLAIN)('%s crosses to another thread whole and comes out the same every time', (job) => {
    const first = JOBS[job]('phone')
    const again = JOBS[job]('phone')
    const moved = structuredClone(first, { transfer: transferables(first) })
    expect(difference(moved, again)).toBeNull()
  })

  it('lists each buffer once, even when two arrays share it', () => {
    const buffer = new ArrayBuffer(16)
    const list = transferables({ a: new Uint8Array(buffer), b: [new Float32Array(buffer, 4, 2)], c: 3 })
    expect(list).toEqual([buffer])
  })

  it('rebuilds a geometry with the same arrays, index, bounds and groups', () => {
    const g = new THREE.BoxGeometry(1, 2, 3, 2, 2, 2)
    g.computeBoundingSphere()
    g.computeBoundingBox()
    const back = unpackGeometry(structuredClone(packGeometry(g)))
    for (const name of Object.keys(g.attributes)) {
      const a = g.getAttribute(name) as THREE.BufferAttribute
      const b = back.getAttribute(name) as THREE.BufferAttribute
      expect(b.itemSize).toBe(a.itemSize)
      expect(b.array.constructor).toBe(a.array.constructor)
      expect(bytes(b.array as ArrayBufferView)).toEqual(bytes(a.array as ArrayBufferView))
    }
    expect(bytes(back.index!.array as ArrayBufferView)).toEqual(bytes(g.index!.array as ArrayBufferView))
    expect(back.boundingSphere).toEqual(g.boundingSphere)
    expect(back.boundingBox).toEqual(g.boundingBox)
    expect(back.groups).toEqual(g.groups)
  })

  it('grows the cherry from a worker result exactly as in the page', () => {
    const here = cherryShape(cherryOpts('phone'))
    const there = unpackTree(structuredClone(JOBS.cherry('phone')))
    expect(there.swayNorm).toBe(here.swayNorm)
    for (const part of ['bark', 'cards'] as const) {
      for (const name of Object.keys(here[part].attributes)) {
        expect(bytes(there[part].getAttribute(name).array as ArrayBufferView)).toEqual(bytes(here[part].getAttribute(name).array as ArrayBufferView))
      }
      expect(there[part].boundingSphere).toEqual(here[part].boundingSphere)
    }
  })
})
