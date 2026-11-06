import * as THREE from 'three'
import { getMaxAnisotropy, inTurn, SCANS_RANK } from './assets'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { cascadeLocal, cascadePoint, groundHeight, pondSdf, rimScale, rng, ISLAND_RX, ISLAND_RZ, POND_LEVEL, TORII_Z, LANDING, islandSdf, CASCADE } from './layout'
import { surfaceHeight } from './surface'
import type { RealmPart, Tier } from './types'

// Scanned rocks: groups set a third into the ground at the pond's shore and
// by the landing, and boulders that break the island's rim. Each scan is one
// instanced mesh.

interface Scan {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  size: THREE.Vector3 // after baking, base at y = 0, centred in x and z
}

// a scan's shape, as far as setting it into the ground goes
export interface ScanShape {
  size: THREE.Vector3
  points: Float32Array // x y z, base at y = 0
}

export interface Placement {
  scan: string
  x: number
  y: number
  z: number
  size: number // longest horizontal extent in metres
  yaw: number
  tiltX: number
  tiltZ: number
  bury: number // share of the height below ground
  tone: number // albedo multiplier, for weathering
  top?: number // set the top here instead of burying (the cascade's steps)
  squash?: number // height scale, for flat-topped steps
  keep?: boolean // the water runs over it: it stays where it is put
  bank?: boolean // set on the cascade's bank: it may reach out over the cut
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

const files = new Map<string, ReturnType<GLTFLoader['loadAsync']>>()

function fetchScan(name: string): ReturnType<GLTFLoader['loadAsync']> {
  let p = files.get(name)
  if (!p) {
    p = inTurn(SCANS_RANK, () => loader.loadAsync(`/realm/models/${name}.glb`))
    files.set(name, p)
  }
  return p
}

function scanNames(tier: Tier): string[] {
  return tier === 'phone' ? ['rock_07', 'rock_09'] : ['rock_07', 'rock_09', 'boulder_01', 'stone_01']
}

// start the scan downloads with the textures; loadScan() takes them from here
export function prefetchScans(tier: Tier): void {
  for (const name of scanNames(tier)) void fetchScan(name).catch(() => {})
}

// the scan in metres, its base at y = 0 and centred in x and z
export function bakeScan(source: THREE.BufferGeometry, matrix: THREE.Matrix4): { geometry: THREE.BufferGeometry; size: THREE.Vector3 } {
  const geometry = source.clone()
  // the files keep positions and normals as normalized integers; moved in
  // place they would be stored back as integers and clip at one metre
  for (const name of ['position', 'normal']) {
    const a = geometry.getAttribute(name)
    if (!a?.normalized) continue
    const out = new Float32Array(a.count * 3)
    for (let i = 0; i < a.count; i++) out.set([a.getX(i), a.getY(i), a.getZ(i)], i * 3)
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(out, 3))
  }
  geometry.applyMatrix4(matrix)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const c = box.getCenter(new THREE.Vector3())
  geometry.translate(-c.x, -box.min.y, -c.z)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return { geometry, size: geometry.boundingBox!.getSize(new THREE.Vector3()) }
}

async function loadScan(name: string): Promise<Scan> {
  const gltf = await fetchScan(name)
  let found: THREE.Mesh | null = null
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh
  })
  if (!found) throw new Error(`no mesh in ${name}`)
  const mesh = found as THREE.Mesh
  const { geometry, size } = bakeScan(mesh.geometry, mesh.matrixWorld)
  const material = mesh.material as THREE.MeshStandardMaterial
  material.side = THREE.FrontSide
  // the scans' own maps come in unfiltered: seen at a slant they blur
  for (const t of [material.map, material.normalMap, material.roughnessMap, material.aoMap]) {
    if (t) t.anisotropy = getMaxAnisotropy()
  }
  return { geometry, material, size }
}

export function scanShape(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: THREE.Vector3): ScanShape {
  const points = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) points.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3)
  return { size, points }
}

// rocks around the pond: walk the shore, drop a group of three to five every
// few metres, one dominant stone and its companions
function shoreRocks(rand: () => number, out: Placement[]): void {
  const scans = ['rock_07', 'rock_09', 'boulder_01', 'stone_01']
  const step = 0.35
  let since = 99
  for (let a = 0; a < Math.PI * 2; a += 0.02) {
    // march outward from the pond centre until the shore
    const cx = -8.4
    const cz = 2.0
    let r = 0.5
    while (pondSdf(cx + Math.cos(a) * r, cz + Math.sin(a) * r) < 0.15 && r < 12) r += step
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    if (islandSdf(x, z) < 1.5) continue
    since += 0.02 * r
    if (since < 3.2 + rand() * 2.5) continue
    since = 0
    const n = 2 + Math.floor(rand() * 3)
    for (let i = 0; i < n; i++) {
      const big = i === 0
      const ox = (rand() - 0.5) * (big ? 0.2 : 1.6)
      const oz = (rand() - 0.5) * (big ? 0.2 : 1.6)
      const px = x + ox
      const pz = z + oz
      // the cascade has stones of its own
      const [f, side] = cascadeLocal(px, pz)
      if (Math.hypot((f + 0.6) / 1.6, side / 1.9) < 1) continue
      out.push({
        scan: scans[Math.floor(rand() * scans.length)],
        x: px,
        y: Math.max(groundHeight(px, pz), POND_LEVEL - 0.1),
        z: pz,
        size: big ? 0.9 + rand() * 0.6 : 0.35 + rand() * 0.4,
        yaw: rand() * Math.PI * 2,
        tiltX: (rand() - 0.5) * 0.2,
        tiltZ: (rand() - 0.5) * 0.2,
        bury: 0.3 + rand() * 0.15,
        tone: 0.85 + rand() * 0.12,
      })
    }
  }
}

// The cascade's stones: the lip the water leaves, the ledge it lands on and
// leaves again, the stones that wall the gorge and face the bank, and those
// standing in the plunge pool. Placed in the cascade's frame (f along the
// flow, s across it): the lip, the ledge and the pool stones by their top
// above the water, the ones bedded in the bank by how far their top stands
// above the ground under them, so about half of each shows. Wet ones are
// darker.
function cascadeRocks(out: Placement[]): void {
  const { upper, ledge, lip1, lip2 } = CASCADE
  type Stone = [scan: string, f: number, s: number, top: number, size: number, squash: number, yaw: number, tone: number, water?: boolean]
  const set: Stone[] = [
    // the stone the spring wells up behind, and the run's floor
    ['boulder_01', -2.3, 0.25, upper + 0.5, 1.2, 0.9, 0.4, 0.62],
    ['rock_09', lip1 - 0.42, 0, upper - 0.02, 0.95, 0.45, 1.3, 0.5, true],
    // the ledge
    ['stone_01', lip2 - 0.38, 0.05, ledge - 0.02, 0.85, 0.5, 0.7, 0.48, true],
    // the cut's faces: tall stones either side of each fall, set just
    // clear of the sheet, so no bare earth shows beside the water
    ['rock_07', -1.08, -0.66, upper - 0.25, 0.6, 1.5, 2.2, 0.5],
    ['boulder_01', -1.08, 0.72, upper - 0.2, 0.7, 1.1, 1.0, 0.5],
    ['stone_01', -0.95, -0.55, ledge + 0.2, 0.65, 1.2, 5.3, 0.46],
    ['rock_09', -0.95, 0.56, ledge + 0.18, 0.65, 1.2, 1.9, 0.46],
    ['rock_07', -0.6, 0.76, 1.2, 0.75, 1.3, 1.2, 0.5],
    ['stone_01', -0.42, -0.72, 0.55, 0.75, 1.1, 0.8, 0.44],
    ['rock_09', -0.44, 0.72, 0.5, 0.75, 1.1, 3.6, 0.44],
    // in and around the plunge pool
    ['stone_01', 0.5, 0.75, 0.1, 0.45, 0.7, 2.6, 0.62],
    ['rock_09', 0.35, -0.6, 0.12, 0.5, 0.7, 5.6, 0.62],
  ]
  const bedded: Stone[] = [
    // the walls of the run above the upper fall
    ['rock_09', lip1 - 0.45, -0.8, 0.3, 0.8, 0.85, 0.3, 0.58],
    ['stone_01', lip1 - 0.5, 0.8, 0.3, 0.8, 0.85, 3.3, 0.58],
    // the mass of the bank behind the upper fall
    ['rock_07', lip1 - 0.15, -1.35, 0.4, 1.25, 0.95, 4.6, 0.62],
    ['boulder_01', lip1 - 0.3, 1.35, 0.35, 1.2, 0.9, 1.4, 0.62],
    // the gorge walls beside the ledge
    ['rock_09', (lip1 + lip2) / 2, -0.9, 0.35, 0.9, 0.85, 2.2, 0.55],
    ['stone_01', (lip1 + lip2) / 2, 0.9, 0.35, 0.9, 0.85, 5.1, 0.55],
    // the bank's face either side of the lower fall, down to the water
    ['rock_07', lip2 + 0.15, -1.1, 0.5, 1.1, 0.95, 3.9, 0.52],
    ['boulder_01', lip2 + 0.1, 1.1, 0.45, 1.1, 0.9, 0.9, 0.52],
    ['rock_07', lip2 + 0.1, -1.7, 0.45, 1.0, 0.85, 0.6, 0.6],
    ['rock_09', lip2 + 0.05, 1.7, 0.45, 1.0, 0.85, 2.0, 0.6],
    ['rock_09', -0.3, -1.05, 0.3, 0.85, 0.75, 1.7, 0.5],
    ['boulder_01', -0.35, 1.1, 0.3, 0.8, 0.8, 4.4, 0.5],
  ]
  const at = { x: 0, y: 0, z: 0 }
  for (const [list, onGround] of [[set, false], [bedded, true]] as const) {
    for (const [scan, f, side, top, size, squash, yaw, tone, water] of list) {
      cascadePoint(f, side, onGround ? 0 : top, at)
      const y = onGround ? groundHeight(at.x, at.z) + top : at.y
      out.push({ scan, x: at.x, y: 0, z: at.z, size, yaw, tiltX: 0, tiltZ: 0, bury: 0, tone, top: y, squash, keep: water ?? false, bank: Math.abs(side) >= 0.45 })
    }
  }
}

// a few stones set into the lawn near the landing and along the path
function gardenRocks(rand: () => number, out: Placement[]): void {
  const spots = [
    { x: -4.6, z: TORII_Z + 1.2, s: 1.3 },
    { x: -5.4, z: TORII_Z + 0.2, s: 0.6 },
    { x: 4.8, z: TORII_Z - 0.6, s: 1.0 },
    { x: 5.7, z: TORII_Z + 0.5, s: 0.5 },
    { x: 7.6, z: 2.4, s: 1.1 },
    { x: 8.3, z: 1.6, s: 0.55 },
    { x: -5.2, z: -6.2, s: 0.9 },
    { x: 9.4, z: -10.5, s: 1.2 },
  ]
  for (const s of spots) {
    out.push({
      scan: rand() < 0.5 ? 'rock_09' : 'rock_07',
      x: s.x,
      y: groundHeight(s.x, s.z),
      z: s.z,
      size: s.s,
      yaw: rand() * Math.PI * 2,
      tiltX: (rand() - 0.5) * 0.15,
      tiltZ: (rand() - 0.5) * 0.15,
      bury: 0.35,
      tone: 0.8 + rand() * 0.12,
    })
  }
}

// boulders bedded along the rim, half buried, so the edge of the lawn is
// broken stone rather than a clean cut; the landing's edge stays clear for
// the opening view
function rimRocks(rand: () => number, out: Placement[]): void {
  let a = 0
  while (a < Math.PI * 2) {
    const k = rimScale(a)
    const inset = 0.9 + rand() * 0.8
    const x = Math.cos(a) * (ISLAND_RX * k - inset)
    const z = Math.sin(a) * (ISLAND_RZ * k - inset)
    const nearLanding = z > LANDING.zBack - 1 && Math.abs(x) < LANDING.halfWidth + 4
    if (!nearLanding && rand() < 0.75) {
      out.push({
        scan: rand() < 0.5 ? 'boulder_01' : 'rock_07',
        x,
        y: groundHeight(x, z),
        z,
        size: 0.8 + rand() * 1.6,
        yaw: rand() * Math.PI * 2,
        tiltX: (rand() - 0.5) * 0.4,
        tiltZ: (rand() - 0.5) * 0.4,
        bury: 0.18 + rand() * 0.12,
        tone: 0.58 + rand() * 0.14,
      })
    }
    a += (1.8 + rand() * 2.6) / ((ISLAND_RX + ISLAND_RZ) * 0.5 * k)
  }
}

// every stone, in the order they are drawn
export function rockPlacements(): Placement[] {
  const rand = rng(53)
  const places: Placement[] = []
  shoreRocks(rand, places)
  gardenRocks(rand, places)
  rimRocks(rand, places)
  cascadeRocks(places)
  return places
}

// the share of a stone's height that must be in the ground all round it,
// and how far below the drawn ground its foot goes at the least; the share
// of its surface kept in sight, and the widest crack left under it, which
// reads as its own shadow
const FOOT = 0.25
const SINK = 0.02
const SHOW = 0.3
const GAP = 0.02
// steeper than angular rock's angle of repose a stone would slide
const MAX_TILT = (45 * Math.PI) / 180
// ground steeper than 45 degrees is a cliff; slopes are read over 10 cm
const CLIFF = Math.tan((45 * Math.PI) / 180)
const D = 0.05
const UP = new THREE.Vector3(0, 1, 0)
const _q = new THREE.Quaternion()
const _tilt = new THREE.Quaternion()
const _normal = new THREE.Vector3()
const _at = new THREE.Vector3()
const _w = new THREE.Vector3()
const _slope = new THREE.Vector3()

// A stone's matrix: placed as its group asks, leant with the ground under it
// and lowered until the lower part of it is in the ground wherever it meets
// it. The groups place by groundHeight at the stone's centre; on a slope the
// downhill side would stand clear, and on the mound and in the cascade's cut
// the drawn ground sits below groundHeight's own.
export function placeRock(p: Placement, shape: ScanShape, index: number, tier: Tier, out: THREE.Matrix4): THREE.Matrix4 {
  const extent = Math.max(shape.size.x, shape.size.z)
  const k = p.size / extent
  const s = new THREE.Vector3(k, k * (p.squash ?? 0.85 + ((index * 37) % 10) / 30), k)
  _q.setFromEuler(new THREE.Euler(p.tiltX, p.yaw, p.tiltZ, 'YXZ'))
  const y = p.top === undefined ? p.y - shape.size.y * s.y * p.bury : p.top - shape.size.y * s.y
  _at.set(p.x, y, p.z)
  out.compose(_at, _q, s)
  // the stones the water runs over keep the height the falls are built on
  if (p.keep) return out
  seat(p, shape.points, new Float32Array(shape.points.length), tier, s, y, out)
  return out
}

// the stone leant with the ground under its foot and lowered into it
function seat(p: Placement, points: Float32Array, world: Float32Array, tier: Tier, s: THREE.Vector3, y: number, out: THREE.Matrix4): void {
  const { x, z } = p
  _at.set(x, y, z)
  out.compose(_at, _q, s)
  let band = toWorld(points, world, out)
  // the slope under the foot, as the mean of the ground's own slope there:
  // a stone across a step stays level instead of leaning from one tread to
  // the next
  let n = 0
  _normal.set(0, 0, 0)
  for (let i = 0; i < world.length; i += 3) {
    if (world[i + 1] > band || !footed(p, tier, world[i], world[i + 2], _slope)) continue
    _normal.x -= _slope.x
    _normal.z -= _slope.y
    n++
  }
  if (n > 0) {
    _normal.set(_normal.x / n, 1, _normal.z / n).normalize()
    _tilt.setFromUnitVectors(UP, _normal)
    const angle = Math.acos(Math.min(1, _normal.y))
    if (angle > MAX_TILT) _tilt.slerp(new THREE.Quaternion(), 1 - MAX_TILT / angle)
    out.compose(_at, _tilt.multiply(_q), s)
    band = toWorld(points, world, out)
  }
  // how far down its foot is all in the ground; a bank stone with nothing
  // under its foot comes down onto whatever it meets first
  let rest = -Infinity
  let meet = Infinity
  const heights: number[] = []
  for (let i = 0; i < world.length; i += 3) {
    const g = surfaceHeight(tier, world[i], world[i + 2])
    heights.push(Number.isNaN(g) ? Infinity : world[i + 1] - g)
    if (!Number.isNaN(g)) meet = Math.min(meet, world[i + 1] - g)
    if (world[i + 1] > band || !footed(p, tier, world[i], world[i + 2], _slope)) continue
    rest = Math.max(rest, world[i + 1] - _slope.z + SINK)
  }
  if (rest === -Infinity && meet < Infinity) rest = meet + SINK
  let drop = Math.max(0, rest)
  // on a crest or a steep bank that would bury it, it keeps SHOW of its
  // surface above the ground and stands out of the slope like an outcrop,
  // and one set under the drawn ground comes up to that; water may cover it.
  // Neither opens more than GAP under its foot.
  heights.sort((a, b) => a - b)
  drop = Math.min(drop, heights[Math.floor((1 - SHOW) * (heights.length - 1))])
  drop = Math.max(drop, rest - SINK - GAP)
  out.elements[13] -= drop
}

// the ground as drawn, or the pond's surface over it
function drawn(tier: Tier, x: number, z: number): number {
  const g = surfaceHeight(tier, x, z)
  return pondSdf(x, z) < 0 ? Math.max(g, POND_LEVEL) : g
}

// over the cascade's bed or its walls (layout.groundHeight's cut)
export function overCut(x: number, z: number): boolean {
  const [f, side] = cascadeLocal(x, z)
  return f > -2.6 && f < 0.6 && Math.abs(side) < 0.75
}

// world positions of a stone's points; returns the top of its foot band
function toWorld(points: Float32Array, world: Float32Array, m: THREE.Matrix4): number {
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < points.length; i += 3) {
    _w.fromArray(points, i).applyMatrix4(m).toArray(world, i)
    low = Math.min(low, _w.y)
    high = Math.max(high, _w.y)
  }
  return low + FOOT * (high - low)
}

// whether a stone can stand at (x, z), and if so the ground there and its
// slope (in out's z, x and y). A cliff, such as the rim's lip or the cascade's walls, carries nothing:
// a stone reaching over one overhangs it. Over the cascade's cut and its
// walls a bank stone stands on nothing.
function footed(p: Placement, tier: Tier, x: number, z: number, out: THREE.Vector3): boolean {
  if (p.bank && overCut(x, z)) return false
  out.set((drawn(tier, x + D, z) - drawn(tier, x - D, z)) / (2 * D), (drawn(tier, x, z + D) - drawn(tier, x, z - D)) / (2 * D), drawn(tier, x, z))
  return Math.hypot(out.x, out.y) < CLIFF
}

export class Rocks implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Rocks> {
    // phones load the two lightest scans and let them stand in for the others
    const names = scanNames(tier)
    const scans = await Promise.all(names.map(loadScan))
    const map = new Map<string, Scan>()
    names.forEach((n, i) => map.set(n, scans[i]))
    if (tier === 'phone') {
      map.set('boulder_01', map.get('rock_07')!)
      map.set('stone_01', map.get('rock_09')!)
    }
    return new Rocks(map, tier)
  }

  private constructor(scans: Map<string, Scan>, tier: Tier) {
    const places = rockPlacements()
    const shapes = new Map<Scan, ScanShape>()
    for (const scan of scans.values()) if (!shapes.has(scan)) shapes.set(scan, scanShape(scan.geometry.getAttribute('position'), scan.size))

    const byScan = new Map<string, Placement[]>()
    for (const p of places) {
      const list = byScan.get(p.scan) ?? []
      list.push(p)
      byScan.set(p.scan, list)
    }
    const m = new THREE.Matrix4()
    const tone = new THREE.Color()
    for (const [name, list] of byScan) {
      const scan = scans.get(name)!
      const mesh = new THREE.InstancedMesh(scan.geometry, scan.material, list.length)
      const shape = shapes.get(scan)!
      list.forEach((p, i) => {
        mesh.setMatrixAt(i, placeRock(p, shape, i, tier, m))
        // a touch of lichen green in the weathered ones
        mesh.setColorAt(i, tone.setRGB(p.tone * 0.97, p.tone, p.tone * 0.93))
      })
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.object.add(mesh)
      this.disposables.push(mesh)
    }
    for (const scan of new Set(scans.values())) this.disposables.push(scan.geometry, scan.material)
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}
