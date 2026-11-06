import { ISLAND_RX, ISLAND_RZ, groundHeight, rimScale } from './layout'
import type { Tier } from './types'

// The ground as it is drawn: layout.groundHeight sampled on the terrain's
// polar grid, the lip rounded down at the rim, and flat between the grid
// points. What stands on the ground asks here, not groundHeight: on the mound,
// in the cascade's cut and over the lip the two part by decimetres.

export const RIM_DROP = 0.4 // how far the lip rounds down before the cliff starts

const TAU = Math.PI * 2

export interface TopGrid {
  rings: number
  segs: number
  pos: Float32Array // (rings + 1) * (segs + 1) points, x y z
}

function smooth(a: number, b: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

// denser towards the rim, where the lip curves
const ringRadius = (t: number) => 1 - Math.pow(1 - t, 1.35)

const grids = new Map<Tier, TopGrid>()

export function topGrid(tier: Tier): TopGrid {
  let grid = grids.get(tier)
  if (grid) return grid
  const rings = tier === 'phone' ? 70 : 120
  const segs = tier === 'phone' ? 180 : 300
  const pos = new Float32Array((rings + 1) * (segs + 1) * 3)
  let n = 0
  for (let i = 0; i <= rings; i++) {
    const r = ringRadius(i / rings)
    const lip = smooth(0.965, 1, r)
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU
      const k = rimScale(a)
      const x = Math.cos(a) * ISLAND_RX * k * r
      const z = Math.sin(a) * ISLAND_RZ * k * r
      pos[n++] = x
      pos[n++] = groundHeight(x, z) - lip * lip * RIM_DROP
      pos[n++] = z
    }
  }
  grid = { rings, segs, pos }
  grids.set(tier, grid)
  return grid
}

// the drawn ground's height at (x, z); NaN off the island's top
export function surfaceHeight(tier: Tier, x: number, z: number): number {
  const { rings, segs, pos } = topGrid(tier)
  let a = Math.atan2(z / ISLAND_RZ, x / ISLAND_RX)
  if (a < 0) a += TAU
  const r = Math.hypot(x / ISLAND_RX, z / ISLAND_RZ) / rimScale(a)
  if (r > 1.01) return NaN
  const j0 = Math.floor((a / TAU) * segs)
  const i0 = Math.floor((1 - Math.pow(Math.max(0, 1 - r), 1 / 1.35)) * rings)
  // the quad the estimate points at first, then its neighbours
  for (const di of [0, -1, 1, -2, 2]) {
    const i = i0 + di
    if (i < 0 || i >= rings) continue
    for (const dj of [0, -1, 1]) {
      const j = (j0 + dj + segs) % segs
      const p = i * (segs + 1) + j
      const q = p + segs + 1
      const h = triangle(pos, p, p + 1, q, x, z) ?? triangle(pos, p + 1, q + 1, q, x, z)
      if (h !== null) return h
    }
  }
  return NaN
}

function triangle(pos: Float32Array, a: number, b: number, c: number, x: number, z: number): number | null {
  const [x1, z1] = [pos[a * 3], pos[a * 3 + 2]]
  const [x2, z2] = [pos[b * 3], pos[b * 3 + 2]]
  const [x3, z3] = [pos[c * 3], pos[c * 3 + 2]]
  const d = (z2 - z3) * (x1 - x3) + (x3 - x2) * (z1 - z3)
  if (Math.abs(d) < 1e-12) return null
  const w1 = ((z2 - z3) * (x - x3) + (x3 - x2) * (z - z3)) / d
  const w2 = ((z3 - z1) * (x - x3) + (x1 - x3) * (z - z3)) / d
  const w3 = 1 - w1 - w2
  const e = -1e-6
  if (w1 < e || w2 < e || w3 < e) return null
  return w1 * pos[a * 3 + 1] + w2 * pos[b * 3 + 1] + w3 * pos[c * 3 + 1]
}
