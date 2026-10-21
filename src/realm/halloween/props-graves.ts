import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { loadPbr } from '../assets'
import { weatheredStone } from '../materials'
import { bevelBox, merge, transformed, worldUv } from '../geo'
import { rng } from '../layout'
import type { Frame, RealmPart, Tier } from '../types'
import { CANDLE_GLSL, candleUniforms } from './props-pumpkins'
import { GRAVE_PUMPKIN, GRAVES, surfaceY } from './props-place'
import { hallow } from './state'

// Three old stones on the lawn, leaning and sunk into the grass with moss on
// their tops and creeping up from the ground, and between them a bony hand
// that rises slowly out of the turned earth, holds, and sinks back. The
// pumpkin beside them lights their near faces a little.

// where its candle burns, for the warm light on the stones and the bones
const candleAt = new THREE.Vector3(GRAVE_PUMPKIN.x, surfaceY(GRAVE_PUMPKIN.x, GRAVE_PUMPKIN.z) + 0.13, GRAVE_PUMPKIN.z)
const CANDLE_SEED = 0.07 + 3 * 0.131

// the candle's light on a surface: world position and normal in, light out
const CANDLE_LIGHT_GLSL = /* glsl */ `
uniform vec3 uCandleAt;
uniform float uCandleGain;
vec3 candleLight(vec3 world, vec3 n, vec3 albedo) {
  vec3 l = uCandleAt - world;
  float d2 = dot(l, l);
  float ndl = max(dot(n, l * inversesqrt(d2)), 0.0);
  return CANDLE * candle(${CANDLE_SEED.toFixed(3)}) * albedo * ndl * uCandleGain / (d2 + 0.04);
}
`
const candleLightUniforms = {
  uCandleAt: { value: candleAt },
  uCandleGain: { value: 0.1 },
}
// pale bone takes the candle more than moss and stone do
const boneLightUniforms = {
  uCandleAt: { value: candleAt },
  uCandleGain: { value: 0.4 },
}

// --- the stones ----------------------------------------------------------------------

// a small chip in every arris: each vertex moves by a noise of its own
// position, so pieces that share a corner stay closed
function chip(geo: THREE.BufferGeometry, amount: number, freq: number, seed: number): THREE.BufferGeometry {
  const p = geo.getAttribute('position')
  const n = (x: number, y: number, z: number, s: number) =>
    Math.sin(x * freq + s) * Math.sin(y * freq * 1.3 + s * 1.7) * Math.sin(z * freq * 0.9 - s) * 0.6 +
    Math.sin(x * freq * 2.7 - s) * Math.sin(z * freq * 2.3 + y * freq * 1.9) * 0.4
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    p.setXYZ(i, x + n(x, y, z, seed) * amount, y + n(x, y, z, seed + 11) * amount, z + n(x, y, z, seed + 23) * amount)
  }
  return geo
}

type P2 = [number, number]

// the outline of a headstone, bottom left round to bottom right, its edge
// worn uneven; `top` gives the height of the crown at x
function outline(w: number, top: (x: number) => number, seed: number, rough: number): P2[] {
  const rand = rng(seed)
  const pts: P2[] = []
  const side = 14
  const across = 40
  const wob = () => (rand() - 0.5) * rough
  for (let i = 0; i <= side; i++) pts.push([-w / 2 + wob(), -0.2 + ((top(-w / 2) + 0.2) * i) / side])
  for (let i = 1; i < across; i++) {
    const x = -w / 2 + (w * i) / across
    pts.push([x, top(x) + wob()])
  }
  for (let i = side; i >= 0; i--) pts.push([w / 2 + wob(), -0.2 + ((top(w / 2) + 0.2) * i) / side])
  return pts
}

function slabGeometry(pts: P2[], thick: number, seed: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const bevel = 0.018
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thick - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 1,
  })
  g.translate(0, 0, -(thick - bevel * 2) / 2)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  const welded = mergeVertices(g, 1e-5)
  g.dispose()
  chip(welded, 0.004, 31, seed)
  welded.computeVertexNormals()
  return welded
}

function stoneGeometries(): THREE.BufferGeometry[] {
  const parts: THREE.BufferGeometry[] = []
  const place = (g: THREE.BufferGeometry, spot: { x: number; z: number; yaw: number; lean: readonly [number, number] }, sink: number) => {
    transformed(g, spot.x, surfaceY(spot.x, spot.z) - sink, spot.z, spot.lean[0], spot.yaw, spot.lean[1])
    worldUv(g, 0.7, spot.x * 3.1, spot.z * 2.3)
    parts.push(g)
  }

  // a broad slab with a rounded crown and shoulders
  {
    const w = 0.54
    const h = 0.74
    const top = (x: number) => h - 0.1 + 0.1 * Math.sqrt(Math.max(0, 1 - (x / (w / 2)) ** 2)) - 0.03 * (Math.abs(x) / (w / 2)) ** 6
    place(slabGeometry(outline(w, top, 11, 0.006), 0.11, 1.3), GRAVES.slab, 0.04)
  }

  // an old pillar stone: a square shaft with a low pointed cap on two
  // stepped bases
  {
    const s = GRAVES.pointed
    const pillar = [
      chip(transformed(bevelBox(0.5, 0.2, 0.44, 0.025, 3), 0, 0.02, 0), 0.006, 23, 2),
      chip(transformed(bevelBox(0.38, 0.13, 0.32, 0.02, 3), 0, 0.185, 0), 0.005, 27, 3),
      chip(transformed(bevelBox(0.21, 0.6, 0.19, 0.016, 3), 0, 0.55, 0), 0.004, 29, 4),
      // flat faces: an indexed cone would shade its four sides round
      chip(transformed(new THREE.ConeGeometry(0.17, 0.1, 4, 1).toNonIndexed(), 0, 0.9, 0, 0, Math.PI / 4, 0), 0.004, 33, 5),
    ]
    for (const g of pillar) {
      g.deleteAttribute('uv')
      g.computeVertexNormals()
    }
    place(merge(pillar), s, 0.07)
  }

  // a slab broken across, its crown lying in the grass in front
  {
    const w = 0.5
    const h = 0.7
    const rand = rng(77)
    // the break runs down to the right, jagged
    const jag: number[] = Array.from({ length: 41 }, () => (rand() - 0.5) * 0.035)
    const breakAt = (x: number) => 0.5 - 0.16 * (x / w) + jag[Math.round(((x + w / 2) / w) * 40)]!
    place(slabGeometry(outline(w, breakAt, 13, 0.006), 0.12, 2.1), GRAVES.broken, 0.03)
    const crown = (x: number) => h - 0.08 + 0.08 * Math.sqrt(Math.max(0, 1 - (x / (w / 2)) ** 2))
    const piece: P2[] = []
    for (let i = 0; i <= 40; i++) {
      const x = w / 2 - (w * i) / 40
      piece.push([x, crown(x)])
    }
    for (let i = 0; i <= 40; i++) {
      const x = -w / 2 + (w * i) / 40
      piece.push([x, breakAt(x) + 0.012])
    }
    const g = slabGeometry(piece, 0.12, 2.7)
    // laid on its back in front of the stump, half sunk in the turf
    g.translate(0, -0.58, 0)
    const b = GRAVES.broken
    const fx = b.x + Math.sin(b.yaw) * 0.42 - Math.cos(b.yaw) * 0.1
    const fz = b.z + Math.cos(b.yaw) * 0.42 + Math.sin(b.yaw) * 0.1
    transformed(g, fx, surfaceY(fx, fz) + 0.02, fz, -Math.PI / 2 + 0.08, b.yaw + 0.5, 0.06)
    worldUv(g, 0.7, 1.7, 4.1)
    parts.push(g)
  }
  return parts
}

// the stones' own look on top of the garden's weathered stone: moss creeping
// up from the turf, and the candle's warmth on the near faces
function graveStone(mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const base = mat.onBeforeCompile.bind(mat)
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer)
    Object.assign(shader.uniforms, candleUniforms, candleLightUniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('float stoneMoss;', `float stoneMoss;\n${CANDLE_GLSL}\n${CANDLE_LIGHT_GLSL}`)
      .replace(
        'diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.65 + n * 0.5), stoneMoss);',
        `{
          float rise = vStoneWorld.y - ${surfaceY(GRAVES.slab.x, GRAVES.slab.z).toFixed(3)};
          float creep = (1.0 - smoothstep(0.0, 0.16 + 0.2 * n, rise)) * smoothstep(0.35, 0.7, sNoise(vStoneWorld * 5.3) * 0.5 + n * 0.6);
          stoneMoss = max(stoneMoss, creep * 0.9);
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.65 + n * 0.5), stoneMoss);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += candleLight(vStoneWorld, normalize(vStoneNormal), diffuseColor.rgb);`,
      )
  }
  mat.customProgramCacheKey = () => 'hallow-grave-stone'
  return mat
}

// --- the hand ------------------------------------------------------------------------

// a bone along y from 0 to len: a shaft that swells to rounded knobs at both
// ends
function bone(len: number, r: number, sides: number): THREE.BufferGeometry {
  const prof: THREE.Vector2[] = []
  const n = 12
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const end = Math.min(t, 1 - t) * 2
    const knob = 1 + 0.55 * Math.exp(-((end / 0.22) ** 2))
    // closed round at both ends
    const cap = Math.sqrt(Math.max(0, Math.min(t, 1 - t) * len) / (r * 1.2))
    prof.push(new THREE.Vector2(Math.max(r * knob * Math.min(1, cap), 1e-4), t * len))
  }
  return new THREE.LatheGeometry(prof, sides)
}

const _u = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _d = new THREE.Vector3()

// a bone from a to b
function boneAt(a: THREE.Vector3, b: THREE.Vector3, r: number, sides: number): THREE.BufferGeometry {
  _d.subVectors(b, a)
  const g = bone(_d.length(), r, sides)
  _q.setFromUnitVectors(_u, _d.normalize())
  _m.compose(a, _q, new THREE.Vector3(1, 1, 1))
  return g.applyMatrix4(_m)
}

// the hand at one pose; curl 0 reaches open, 1 claws. The same topology at
// every curl, so two poses blend as a morph. Palm to +z, fingers up, wrist at
// the origin, the forearm running down into the earth.
function handGeometry(curl: number, fine: boolean): THREE.BufferGeometry {
  const sides = fine ? 8 : 6
  const parts: THREE.BufferGeometry[] = []
  // the forearm's two bones, a little apart, the arm leaning back
  const lean = new THREE.Vector3(0, -1, -0.18).normalize()
  for (const [dx, r] of [[-0.012, 0.0085], [0.013, 0.0075]] as const) {
    const top = new THREE.Vector3(dx, -0.01, 0)
    parts.push(boneAt(top.clone().addScaledVector(lean, 0.72), top, r, sides))
  }
  // the wrist's small bones, two rows of knobs
  const wrist = new THREE.IcosahedronGeometry(1, fine ? 1 : 0)
  for (let i = 0; i < 8; i++) {
    const row = i < 4 ? 0 : 1
    const x = -0.021 + (i % 4) * 0.014
    const g = wrist.clone()
    g.scale(0.0085, 0.008, 0.0075)
    g.translate(x, 0.008 + row * 0.014, (row ? 0.002 : 0) - 0.001 * (i % 2))
    parts.push(g)
  }
  wrist.dispose()
  // the fingers: the long bones in the palm, then the joints
  const fingers = [
    // knuckle x, palm length, splay, joints [len], curl weights
    { x: -0.024, len: 0.062, splay: -0.12, joints: [0.04, 0.025, 0.019], r: 0.0052 },
    { x: -0.008, len: 0.068, splay: -0.03, joints: [0.045, 0.028, 0.02], r: 0.0055 },
    { x: 0.008, len: 0.064, splay: 0.05, joints: [0.042, 0.026, 0.019], r: 0.0052 },
    { x: 0.022, len: 0.058, splay: 0.14, joints: [0.034, 0.02, 0.017], r: 0.0047 },
  ]
  const p = new THREE.Vector3()
  const q = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const X = new THREE.Vector3(1, 0, 0)
  fingers.forEach((f, i) => {
    const spread = f.splay * (1.6 - curl * 0.8)
    p.set(f.x * 0.6, 0.03, 0.002)
    dir.set(Math.sin(spread), Math.cos(spread), 0).applyAxisAngle(X, 0.1 + curl * 0.15)
    q.copy(p).addScaledVector(dir, f.len)
    parts.push(boneAt(p, q, f.r * 1.05, sides))
    // each finger curls a little differently, the little one most
    const bend = [0.25 + curl * 0.75, 0.3 + curl * 0.95, 0.2 + curl * 0.75].map((b) => b * (0.85 + i * 0.08))
    f.joints.forEach((jl, j) => {
      p.copy(q)
      dir.applyAxisAngle(X, bend[j]!)
      q.copy(p).addScaledVector(dir, jl)
      parts.push(boneAt(p, q, f.r * (0.95 - j * 0.12), sides))
    })
  })
  // the thumb, from the wrist's side, turned toward the palm
  {
    p.set(-0.028, 0.02, 0.006)
    dir.set(-0.62, 0.72, 0.3).normalize()
    q.copy(p).addScaledVector(dir, 0.04)
    parts.push(boneAt(p, q, 0.0058, sides))
    const T = new THREE.Vector3(0.3, 0.2, -1).normalize()
    for (const [jl, b] of [[0.032, 0.25 + curl * 0.6], [0.024, 0.2 + curl * 0.7]] as const) {
      p.copy(q)
      dir.applyAxisAngle(T, -b)
      q.copy(p).addScaledVector(dir, jl)
      parts.push(boneAt(p, q, 0.0052, sides))
    }
  }
  // each piece smooth on its own and indexed, so every pose keeps the same
  // vertices in the same order
  const pieces = parts.map((g) => {
    g.deleteAttribute('uv')
    g.deleteAttribute('normal')
    const w = g.index ? g : mergeVertices(g, 1e-6)
    w.computeVertexNormals()
    return w
  })
  const out = mergeGeometries(pieces, false)
  for (const g of new Set([...parts, ...pieces])) g.dispose()
  if (!out) throw new Error('hand merge failed')
  return out
}

function boneMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.6, 0.36), roughness: 0.7 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, candleUniforms, boneLightUniforms, { uGround: hand.ground })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBoneWorld;\nvarying vec3 vBoneNormal;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vBoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBoneNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uGround;
        varying vec3 vBoneWorld;
        varying vec3 vBoneNormal;
        ${CANDLE_GLSL}
        ${CANDLE_LIGHT_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // old bone: stained in the hollows, the earth still clinging low
          float h = vBoneWorld.y - uGround;
          float s = fract(sin(dot(floor(vBoneWorld * 260.0), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          diffuseColor.rgb *= 0.86 + 0.2 * s;
          diffuseColor.rgb = mix(vec3(0.09, 0.06, 0.04), diffuseColor.rgb, smoothstep(-0.01, 0.12, h));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += candleLight(vBoneWorld, normalize(vBoneNormal), diffuseColor.rgb);`,
      )
  }
  mat.customProgramCacheKey = () => 'hallow-bone'
  return mat
}

// the earth the hand broke through: a low ring of dark soil with clods
function soilGeometry(seed: number): THREE.BufferGeometry {
  const rand = rng(seed)
  const prof: [number, number][] = [
    [0.03, 0.0],
    [0.05, 0.03],
    [0.09, 0.045],
    [0.15, 0.03],
    [0.21, 0.012],
    [0.27, 0.0],
    [0.3, -0.02],
  ]
  const g = new THREE.LatheGeometry(
    prof.map(([r, y]) => new THREE.Vector2(r, y)),
    40,
  )
  const pos = g.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const k = 1 + 0.18 * Math.sin(a * 3 + 1.3) + 0.1 * Math.sin(a * 7 + 0.4)
    pos.setXYZ(i, x * k, pos.getY(i) * (0.7 + 0.6 * (0.5 + 0.5 * Math.sin(a * 5 + 2.0))), z * k)
  }
  const parts: THREE.BufferGeometry[] = [g]
  for (let i = 0; i < 9; i++) {
    const c = new THREE.IcosahedronGeometry(0.018 + rand() * 0.02, 0)
    const a = rand() * Math.PI * 2
    const r = 0.1 + rand() * 0.22
    c.scale(1, 0.6, 1)
    transformed(c, Math.cos(a) * r, 0.01, Math.sin(a) * r, rand(), rand() * 3, rand())
    parts.push(c)
  }
  for (const p of parts) p.deleteAttribute('uv')
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p))
  const out = mergeGeometries(flat, false)
  for (const p of new Set([...parts, ...flat])) p.dispose()
  if (!out) throw new Error('soil merge failed')
  out.deleteAttribute('normal')
  const soft = mergeVertices(out, 1e-5)
  out.dispose()
  soft.computeVertexNormals()
  return soft
}

// the hand's timing: hidden below, a slow rise, a hold with the fingers
// working, a slower sink
const REST = 8
const RISE = 20
const HOLD = 9
const SINK = 12
const CYCLE = REST + RISE + HOLD + SINK
// how far it rises: the wrist ends a hand's length above the turf
const DEPTH = 0.5
const HAND_SCALE = 1.4
const hand = { ground: { value: 0 } }

const ease = (t: number) => t * t * (3 - 2 * t)

export class Graves implements RealmPart {
  readonly object = new THREE.Group()
  readonly kind = 'Graves'
  private hand: THREE.Mesh
  private arm = new THREE.Group()
  private disposables: { dispose(): void }[] = []
  private clock = REST * 0.5

  static async create(tier: Tier): Promise<Graves> {
    return new Graves(await loadPbr('stone', tier), tier)
  }

  private constructor(stone: Awaited<ReturnType<typeof loadPbr>>, tier: Tier) {
    const stoneMat = graveStone(weatheredStone(stone, new THREE.Color(0.1, 0.15, 0.045), { color: new THREE.Color(0.66, 0.65, 0.62) }))
    const stoneGeo = merge(stoneGeometries())
    stoneGeo.computeBoundingSphere()
    const stones = new THREE.Mesh(stoneGeo, stoneMat)
    stones.castShadow = true
    stones.receiveShadow = true
    this.object.add(stones)

    const h = GRAVES.hand
    const ground = surfaceY(h.x, h.z)
    hand.ground.value = ground
    const soil = new THREE.Mesh(soilGeometry(5), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.06, 0.04, 0.03), roughness: 0.95 }))
    soil.position.set(h.x, ground - 0.012, h.z)
    soil.scale.setScalar(1.2)
    soil.receiveShadow = true
    this.object.add(soil)

    const fine = tier !== 'phone'
    const geo = handGeometry(0.85, fine)
    const open = handGeometry(0.3, fine)
    geo.morphAttributes.position = [open.getAttribute('position')]
    geo.morphAttributes.normal = [open.getAttribute('normal')]
    geo.computeBoundingSphere()
    const mat = boneMaterial()
    this.hand = new THREE.Mesh(geo, mat)
    this.hand.updateMorphTargets()
    // it moves, and the shadow map is drawn once: it casts none
    this.hand.castShadow = false
    this.hand.receiveShadow = true
    this.hand.frustumCulled = false
    this.arm.add(this.hand)
    this.arm.position.set(h.x, ground, h.z)
    // a big hand, so it reads from the path
    this.arm.scale.setScalar(HAND_SCALE)
    // the palm turned to the path, the arm leaning a little out of the grave
    this.arm.rotation.set(0.12, 0.6, -0.08, 'YXZ')
    this.object.add(this.arm)
    this.disposables.push(stoneGeo, stoneMat, soil.geometry, soil.material as THREE.Material, geo, open, mat)
    if (new URLSearchParams(location.search).has('debug')) {
      // for shots: the hand's cycle set to a moment, in seconds
      ;(hallow as typeof hallow & { handAt?: (s: number) => void }).handAt = (s) => {
        this.clock = s % CYCLE
      }
    }
  }

  update(frame: Frame): void {
    candleUniforms.uMotion.value = frame.motion
    // under reduced motion it stays risen to the wrist, still
    let rise = 0.8
    let curl = 0.4
    if (frame.motion > 0) {
      this.clock = (this.clock + frame.dt) % CYCLE
      const c = this.clock
      if (c < REST) rise = 0
      else if (c < REST + RISE) rise = ease((c - REST) / RISE)
      else if (c < REST + RISE + HOLD) rise = 1
      else rise = 1 - ease((c - REST - RISE - HOLD) / SINK)
      // the fingers close slowly as it comes up and open toward the sky in the hold
      const hold = c > REST + RISE ? Math.min(1, (c - REST - RISE) / 3) : 0
      curl = 0.15 + 0.5 * rise - 0.45 * hold * (rise > 0.99 ? 1 : rise) + 0.08 * Math.sin(frame.t * 0.7)
    }
    this.hand.visible = rise > 0.001
    this.hand.position.y = -DEPTH * (1 - rise) + 0.2
    this.hand.rotation.z = (1 - rise) * 0.15
    this.hand.morphTargetInfluences![0] = Math.min(1, Math.max(0, 1 - curl))
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
