import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

// Small geometry helpers shared by the built parts. Everything here works in
// world metres; texture coordinates are laid from world position so scanned
// materials keep their real scale across pieces of any size.

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _s = new THREE.Vector3()
const _p = new THREE.Vector3()

export function transformed(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): THREE.BufferGeometry {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'))
  _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))
  return geo.applyMatrix4(_m)
}

// a box with rounded arrises, so edges catch a line of light like cut stone
// or planed timber
export function bevelBox(w: number, h: number, d: number, bevel: number, segments = 2): THREE.BufferGeometry {
  const r = Math.min(bevel, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)
  return new RoundedBoxGeometry(w, h, d, segments, Math.max(r, 1e-4))
}

// Lay texture coordinates by projecting each vertex along its dominant
// normal axis, scaled to `scale` metres per texture repeat.
export function worldUv(geo: THREE.BufferGeometry, scale: number, ox = 0, oz = 0): THREE.BufferGeometry {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + ox
    const y = pos.getY(i)
    const z = pos.getZ(i) + oz
    const ax = Math.abs(nor.getX(i))
    const ay = Math.abs(nor.getY(i))
    const az = Math.abs(nor.getZ(i))
    let u: number
    let v: number
    if (ay >= ax && ay >= az) {
      u = x
      v = z
    } else if (ax >= az) {
      u = z
      v = y
    } else {
      u = x
      v = y
    }
    uv[i * 2] = u / scale
    uv[i * 2 + 1] = v / scale
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geo
}

// a flat per-piece tint in the colour attribute, so a merged run of slabs
// still varies stone to stone
export function tint(geo: THREE.BufferGeometry, r: number, g: number, b: number): THREE.BufferGeometry {
  const n = geo.getAttribute('position').count
  const c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    c[i * 3] = r
    c[i * 3 + 1] = g
    c[i * 3 + 2] = b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return geo
}

// Merge pieces that share one material. Drops attributes not every piece
// has, so callers can mix sources.
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const prepared = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const names = Object.keys(prepared[0].attributes).filter((n) => prepared.every((g) => g.getAttribute(n)))
  for (const g of prepared) {
    for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n)
  }
  const out = mergeGeometries(prepared, false)
  if (!out) throw new Error('merge failed')
  for (const g of parts) g.dispose()
  for (const g of prepared) g.dispose()
  return out
}

// A lathe around y from a profile of [radius, height] pairs; `sides` 6 gives
// the hexagonal stone of a lantern, 32 a turned round part.
export function lathe(profile: [number, number][], sides: number, phase = 0): THREE.BufferGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y))
  const geo = new THREE.LatheGeometry(pts, sides, phase, Math.PI * 2)
  return geo
}

// Displace a geometry's vertices along their normals by a smooth 3D noise,
// for the softened, chipped arrises of weathered stone.
export function weather(geo: THREE.BufferGeometry, amount: number, freq: number, seed = 0): THREE.BufferGeometry {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const n =
      Math.sin(x * freq + seed) * Math.sin(y * freq * 1.3 + seed * 1.7) * Math.sin(z * freq * 0.9 - seed) * 0.6 +
      Math.sin(x * freq * 2.7 - seed) * Math.sin(z * freq * 2.3 + y * freq * 1.9) * 0.4
    pos.setXYZ(i, x + nor.getX(i) * n * amount, y + nor.getY(i) * n * amount, z + nor.getZ(i) * n * amount)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}
