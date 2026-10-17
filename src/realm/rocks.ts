import * as THREE from 'three'
import { getMaxAnisotropy } from './assets'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { groundHeight, pondSdf, rimScale, rng, ISLAND_RX, ISLAND_RZ, POND_LEVEL, TORII_Z, LANDING, islandSdf } from './layout'
import type { RealmPart, Tier } from './types'

// Scanned rocks: groups set a third into the ground at the pond's shore and
// by the landing, and boulders that break the island's rim. Each scan is one
// instanced mesh.

interface Scan {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  size: THREE.Vector3 // after baking, base at y = 0, centred in x and z
}

interface Placement {
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
}

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

async function loadScan(name: string): Promise<Scan> {
  const gltf = await loader.loadAsync(`/realm/models/${name}.glb`)
  let found: THREE.Mesh | null = null
  gltf.scene.updateMatrixWorld(true)
  gltf.scene.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh
  })
  if (!found) throw new Error(`no mesh in ${name}`)
  const mesh = found as THREE.Mesh
  const geometry = mesh.geometry.clone()
  geometry.applyMatrix4(mesh.matrixWorld)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!
  const c = box.getCenter(new THREE.Vector3())
  geometry.translate(-c.x, -box.min.y, -c.z)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const size = geometry.boundingBox!.getSize(new THREE.Vector3())
  const material = mesh.material as THREE.MeshStandardMaterial
  material.side = THREE.FrontSide
  // the scans' own maps come in unfiltered: seen at a slant they blur
  for (const t of [material.map, material.normalMap, material.roughnessMap, material.aoMap]) {
    if (t) t.anisotropy = getMaxAnisotropy()
  }
  return { geometry, material, size }
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

export class Rocks implements RealmPart {
  readonly object = new THREE.Group()
  private disposables: { dispose(): void }[] = []

  static async create(tier: Tier): Promise<Rocks> {
    // phones load the two lightest scans and let them stand in for the others
    const names = tier === 'phone' ? ['rock_07', 'rock_09'] : ['rock_07', 'rock_09', 'boulder_01', 'stone_01']
    const scans = await Promise.all(names.map(loadScan))
    const map = new Map<string, Scan>()
    names.forEach((n, i) => map.set(n, scans[i]))
    if (tier === 'phone') {
      map.set('boulder_01', map.get('rock_07')!)
      map.set('stone_01', map.get('rock_09')!)
    }
    return new Rocks(map)
  }

  private constructor(scans: Map<string, Scan>) {
    const rand = rng(53)
    const places: Placement[] = []
    shoreRocks(rand, places)
    gardenRocks(rand, places)
    rimRocks(rand, places)

    const byScan = new Map<string, Placement[]>()
    for (const p of places) {
      const list = byScan.get(p.scan) ?? []
      list.push(p)
      byScan.set(p.scan, list)
    }
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    const v = new THREE.Vector3()
    const tone = new THREE.Color()
    for (const [name, list] of byScan) {
      const scan = scans.get(name)!
      const mesh = new THREE.InstancedMesh(scan.geometry, scan.material, list.length)
      const extent = Math.max(scan.size.x, scan.size.z)
      list.forEach((p, i) => {
        const k = p.size / extent
        s.set(k, k * (0.85 + ((i * 37) % 10) / 30), k)
        q.setFromEuler(e.set(p.tiltX, p.yaw, p.tiltZ, 'YXZ'))
        v.set(p.x, p.y - scan.size.y * s.y * p.bury, p.z)
        mesh.setMatrixAt(i, m.compose(v, q, s))
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
