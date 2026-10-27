import { describe, expect, it } from 'vitest'

import { FACE, FACE_GLSL, faceDistance, triangleDistance } from './face'

const grid = (step: number, f: (x: number, y: number) => void) => {
  for (let y = -1; y <= 1; y += step) for (let x = -1; x <= 1; x += step) f(x, y)
}
const tris = [FACE.eye, FACE.nose, ...FACE.teeth]

describe('the lantern face on the moon', () => {
  it('gives every triangle counterclockwise, as the shader needs', () => {
    for (const [a, b, c] of tris) expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0)
  })

  it('measures a triangle by its true distance', () => {
    const t = FACE.nose
    const base = t[0][1]
    expect(triangleDistance(0, base - 0.1, t)).toBeCloseTo(0.1, 6)
    expect(triangleDistance(0, base + 0.01, t)).toBeCloseTo(-0.01, 6)
  })

  it('is the same on both sides', () => {
    grid(0.013, (x, y) => expect(faceDistance(x, y)).toBe(faceDistance(-x, y)))
  })

  it('keeps every cut well inside the limb', () => {
    grid(0.005, (x, y) => {
      if (faceDistance(x, y) < 0) expect(Math.hypot(x, y)).toBeLessThan(0.9)
    })
  })

  it('carves a share of the disc large enough to light it', () => {
    let cut = 0
    let all = 0
    grid(0.005, (x, y) => {
      if (Math.hypot(x, y) >= 1) return
      all++
      if (faceDistance(x, y) < 0) cut++
    })
    expect(cut / all).toBeGreaterThan(0.18)
    expect(cut / all).toBeLessThan(0.28)
  })

  it('leaves solid shell between the eyes, the nose and the grin', () => {
    // between the eye's outer corner and the grin's corner, under the nose, between the eyes
    expect(faceDistance(0.756, 0.037)).toBeGreaterThan(0.02)
    for (const [x, y] of [[0, -0.3], [0, 0.15], [0.232, -0.014]] as const) expect(faceDistance(x, y)).toBeGreaterThan(0.08)
  })

  it('cuts the grin with standing teeth that never close it', () => {
    for (const [a, b, c] of FACE.teeth) expect(faceDistance((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3)).toBeGreaterThan(0)
    // the cut runs on unbroken from corner to corner, a few pixels wide even on a phone
    for (let x = -0.6; x <= 0.6; x += 0.005) {
      let open = Infinity
      for (let y = -0.76; y < -0.12; y += 0.002) open = Math.min(open, faceDistance(x, y))
      expect(open).toBeLessThan(-0.02)
    }
  })

  it('is a true distance at its edges, so one pixel of blending is one pixel', () => {
    const h = 1e-4
    let edges = 0
    let exact = 0
    grid(0.0037, (x, y) => {
      const d = faceDistance(x, y)
      if (Math.abs(d) > 0.004) return
      const gx = (faceDistance(x + h, y) - faceDistance(x - h, y)) / (2 * h)
      const gy = (faceDistance(x, y + h) - faceDistance(x, y - h)) / (2 * h)
      const g = Math.hypot(gx, gy)
      // the mirror line has no single gradient
      if (Math.abs(x) < 0.01) return
      edges++
      if (g > 0.9 && g < 1.1) exact++
    })
    expect(edges).toBeGreaterThan(500)
    // only the sharp corners, where two edges meet, may differ
    expect(exact / edges).toBeGreaterThan(0.97)
  })

  it('writes the same shape into the shader', () => {
    for (const t of tris) for (const p of t) expect(FACE_GLSL).toContain(`vec2(${p[0].toFixed(4)}, ${p[1].toFixed(4)})`)
    for (const c of [FACE.eyeBite, FACE.mouthOuter, FACE.mouthInner]) expect(FACE_GLSL).toContain(`- ${c.r.toFixed(4)})`)
  })
})
