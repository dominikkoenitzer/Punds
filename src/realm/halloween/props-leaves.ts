import * as THREE from 'three'
import { lawnWeight, MAPLES, pondSdf, rng, STEPS } from '../layout'
import type { RealmPart, Tier } from '../types'
import { surfaceY, tread } from './props-place'

// A few maple leaves fallen on the path, the gravel and the steps: blown
// mostly from the maple by the rack, some as far as the graves. One instanced
// mesh; each leaf lies cupped, turned and tinted on its own.

// a seven-lobed leaf, about 1 across, its stalk to -z, lying in xz
function leafGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = []
  const lobes = 7
  const N = 7 * 12
  for (let i = 0; i < N; i++) {
    // the lobes fan over the upper 300 degrees, the stalk's notch below
    const a = -Math.PI / 2 + Math.PI / 6 + (i / N) * (Math.PI * 2 - Math.PI / 3)
    const f = (i / N) * lobes
    const lobe = Math.abs(Math.sin(f * Math.PI))
    // pointed tips, deep narrow cuts between them, the side lobes shorter
    const side = Math.abs(Math.cos(a - Math.PI / 2))
    const r = (0.16 + 0.34 * Math.pow(lobe, 0.45) * (1 + 0.15 * Math.pow(lobe, 8))) * (1 - 0.35 * side * side)
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r))
  }
  pts.push(new THREE.Vector2(0.008, -0.08), new THREE.Vector2(0.004, -0.3), new THREE.Vector2(-0.004, -0.3), new THREE.Vector2(-0.008, -0.08))
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts))
  // lay it down and cup it: the lobes curl up, the middle rib stays low
  g.rotateX(-Math.PI / 2)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    p.setY(i, 0.12 * (x * x + z * z) + 0.05 * Math.abs(x))
  }
  g.computeVertexNormals()
  return g
}

const COLOURS = [
  new THREE.Color(0.42, 0.035, 0.018),
  new THREE.Color(0.5, 0.09, 0.02),
  new THREE.Color(0.55, 0.2, 0.03),
  new THREE.Color(0.3, 0.12, 0.04),
]

export class Leaves implements RealmPart {
  readonly object: THREE.InstancedMesh
  readonly kind = 'Leaves'

  constructor(tier: Tier) {
    const rand = rng(9031)
    const spots: { x: number; z: number; y: number }[] = []
    const tryAt = (x: number, z: number) => {
      if (pondSdf(x, z) < 0.4) return
      // over grass a leaf rests on the blades, not under them
      const lift = lawnWeight(x, z) > 0.5 ? 0.035 : 0.006
      spots.push({ x, z, y: surfaceY(x, z) + lift })
    }
    // under the maple by the rack and drifting toward the path
    const m = MAPLES[0]!
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2
      const r = Math.sqrt(rand()) * m.spread * 1.1
      tryAt(m.x + Math.cos(a) * r - rand() * 2.5, m.z + Math.sin(a) * r * 0.8 + rand() * 1.5)
    }
    // along the path toward the start, thinning out
    for (let i = 0; i < 10; i++) tryAt((rand() - 0.5) * 2.2, -6 + rand() * rand() * 12)
    // on the steps, near their ends
    for (let i = 0; i < 4; i++) {
      const t = tread(Math.floor(rand() * STEPS.count))
      tryAt((rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 0.8), t.z + (rand() - 0.5) * 0.12)
    }
    // a few on the graves' lawn
    for (let i = 0; i < 4; i++) tryAt(-3.6 - rand() * 2.4, -2.6 - rand() * 2)
    const count = tier === 'phone' ? Math.ceil(spots.length * 0.6) : spots.length

    const geo = leafGeometry()
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.62, side: THREE.DoubleSide })
    this.object = new THREE.InstancedMesh(geo, mat, count)
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const mtx = new THREE.Matrix4()
    const c = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const at = spots[i]!
      const size = 0.075 + rand() * 0.035
      // some lie on their backs, all tilted a little by what they rest on
      e.set((rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3 + (rand() < 0.3 ? Math.PI : 0), 'YXZ')
      q.setFromEuler(e)
      mtx.compose(p.set(at.x, at.y + (e.z > 1 ? size * 0.12 : 0), at.z), q, s.set(size, size, size))
      this.object.setMatrixAt(i, mtx)
      c.copy(COLOURS[Math.floor(rand() * COLOURS.length)]!).multiplyScalar(0.8 + rand() * 0.35)
      this.object.setColorAt(i, c)
    }
    this.object.instanceMatrix.needsUpdate = true
    this.object.computeBoundingSphere()
    this.object.receiveShadow = true
    this.object.castShadow = false
  }

  update(): void {}

  dispose(): void {
    this.object.geometry.dispose()
    ;(this.object.material as THREE.Material).dispose()
  }
}
