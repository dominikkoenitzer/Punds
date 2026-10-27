// The lantern face carved into the blood moon, in the disc's own frame
// (radius 1, x to the right, y up). The shape is kept as data so the shader
// and the tests read the same face; the shader is the one that draws it.
//
// The face is mirrored about x = 0: only its right half is given.

type P = readonly [number, number]
// a triangle, its corners counterclockwise
type Tri = readonly [P, P, P]

export const FACE = {
  // the right eye, a slanted triangle with its lower edge bitten out by a
  // circle, so the eye narrows into a squint
  eye: [
    [0.171, 0.171],
    [0.781, 0.122],
    [0.537, 0.708],
  ] as Tri,
  eyeBite: { c: [0.488, -0.3] as P, r: 0.464 },
  // the nose, a small triangle on the middle line
  nose: [
    [-0.128, -0.207],
    [0.128, -0.207],
    [0, 0.049],
  ] as Tri,
  // the grin: the band below one circle and outside a higher, larger one
  mouthOuter: { c: [0, 0] as P, r: 0.732 },
  mouthInner: { c: [0, 0.47] as P, r: 0.854 },
  // teeth left standing in the grin: from the upper lip down and from the
  // lower lip up, staggered so the cut zigzags
  teeth: [
    [
      [-0.11, -0.366],
      [0, -0.598],
      [0.11, -0.366],
    ],
    [
      [0.329, -0.29],
      [0.451, -0.476],
      [0.573, -0.14],
    ],
    [
      [0.122, -0.781],
      [0.342, -0.756],
      [0.232, -0.537],
    ],
  ] as readonly Tri[],
  // where the hidden flame sits; the cuts nearest it burn hottest
  flame: [0, -0.146] as P,
} as const

const segment = (px: number, py: number, a: P, b: P) => {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const wx = px - a[0]
  const wy = py - a[1]
  const h = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)))
  return Math.hypot(wx - ex * h, wy - ey * h)
}
const left = (px: number, py: number, a: P, b: P) => (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0])
export function triangleDistance(x: number, y: number, t: Tri): number {
  const d = Math.min(segment(x, y, t[0], t[1]), segment(x, y, t[1], t[2]), segment(x, y, t[2], t[0]))
  const inside = left(x, y, t[0], t[1]) > 0 && left(x, y, t[1], t[2]) > 0 && left(x, y, t[2], t[0]) > 0
  return inside ? -d : d
}
const circle = (x: number, y: number, c: { c: P; r: number }) => Math.hypot(x - c.c[0], y - c.c[1]) - c.r

// signed distance to the cut-out parts: negative inside a cut
export function faceDistance(px: number, y: number): number {
  const x = Math.abs(px)
  const eye = Math.max(triangleDistance(x, y, FACE.eye), -circle(x, y, FACE.eyeBite))
  const nose = triangleDistance(x, y, FACE.nose)
  let teeth = Infinity
  for (const t of FACE.teeth) teeth = Math.min(teeth, triangleDistance(x, y, t))
  const mouth = Math.max(circle(x, y, FACE.mouthOuter), -circle(x, y, FACE.mouthInner), -teeth)
  return Math.min(eye, nose, mouth)
}

const v = (p: P) => `vec2(${p[0].toFixed(4)}, ${p[1].toFixed(4)})`
const tri = (q: string, t: Tri) => `moonTri(${q}, ${v(t[0])}, ${v(t[1])}, ${v(t[2])})`
const ring = (q: string, c: { c: P; r: number }) => `(length(${q} - ${v(c.c)}) - ${c.r.toFixed(4)})`

// the same shape in GLSL: float moonFace(vec2 p)
export const FACE_GLSL = /* glsl */ `
float moonSegment(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a;
  vec2 w = p - a;
  return length(w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0));
}
float moonLeft(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a;
  return e.x * (p.y - a.y) - e.y * (p.x - a.x);
}
float moonTri(vec2 p, vec2 a, vec2 b, vec2 c) {
  float d = min(min(moonSegment(p, a, b), moonSegment(p, b, c)), moonSegment(p, c, a));
  bool inside = moonLeft(p, a, b) > 0.0 && moonLeft(p, b, c) > 0.0 && moonLeft(p, c, a) > 0.0;
  return inside ? -d : d;
}
float moonFace(vec2 p) {
  vec2 q = vec2(abs(p.x), p.y);
  float eye = max(${tri('q', FACE.eye)}, -${ring('q', FACE.eyeBite)});
  float nose = ${tri('q', FACE.nose)};
  float teeth = min(min(${tri('q', FACE.teeth[0]!)}, ${tri('q', FACE.teeth[1]!)}), ${tri('q', FACE.teeth[2]!)});
  float mouth = max(max(${ring('q', FACE.mouthOuter)}, -${ring('q', FACE.mouthInner)}), -teeth);
  return min(min(eye, nose), mouth);
}
`
