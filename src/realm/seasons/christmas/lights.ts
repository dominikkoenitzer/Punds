import * as THREE from 'three'
import { EMA_RACK, TORII_SPAN, TORII_Z, groundHeight } from '../../layout'
import type { RealmPart, Tier } from '../../types'

// A string of small warm bulbs, the plain kind a caretaker puts up for the
// holidays: along the front eave of the plaque rack in three short loops, and
// in one long loop under the torii's lower beam. The bulbs burn steady; the
// glow around them comes from the bloom alone, so they cost three draws.

const BULB_RADIUS = 0.012
const BULB_STEP = 0.1 // metres of wire between bulbs
// the bulbs' warm white, linear, bright enough for the bloom to take it up
const BULB = new THREE.Color(1.0, 0.64, 0.32).multiplyScalar(5.5)

// a wire hung between hooks: each span sags in a shallow arc
function hang(hooks: readonly THREE.Vector3[], sag: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (let i = 0; i + 1 < hooks.length; i++) {
    const a = hooks[i]!
    const b = hooks[i + 1]!
    const n = 24
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const t = k / n
      out.push(new THREE.Vector3().lerpVectors(a, b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)))
    }
  }
  return out
}

// points every `step` metres along a polyline
function along(points: readonly THREE.Vector3[], step: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  let carry = step / 2
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!
    const b = points[i + 1]!
    const len = a.distanceTo(b)
    let s = carry
    while (s <= len) {
      out.push(new THREE.Vector3().lerpVectors(a, b, s / len))
      s += step
    }
    carry = s - len
  }
  return out
}

// the rack's front eave in its own frame, as built in ema.ts: the roof board
// ends 0.46 m out from the posts and 1.87 m up, and runs 1.18 m either way
function rackString(): THREE.Vector3[] {
  const y = 1.84
  const z = 0.47
  const hooks = [-1.12, -0.37, 0.37, 1.12].map((x) => new THREE.Vector3(x, y, z))
  const local = hang(hooks, 0.07)
  const m = new THREE.Matrix4().makeRotationY(EMA_RACK.rotation)
  m.setPosition(EMA_RACK.x, groundHeight(EMA_RACK.x, EMA_RACK.z), EMA_RACK.z)
  return local.map((p) => p.applyMatrix4(m))
}

// under the torii's lower beam, from one pillar's inner face to the other
function toriiString(): THREE.Vector3[] {
  const y = 3.45
  const x = TORII_SPAN / 2 - 0.3
  return hang([new THREE.Vector3(-x, y, TORII_Z), new THREE.Vector3(x, y, TORII_Z)], 0.3)
}

class Lights implements RealmPart {
  readonly object = new THREE.Group()
  readonly kind = 'Lights'
  private readonly disposables: { dispose(): void }[] = []

  constructor(tier: Tier) {
    const strings = [rackString(), toriiString()]
    const wireMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.03, 0.04, 0.035), roughness: 0.55, metalness: 0 })
    const bulbMat = new THREE.MeshBasicMaterial({ color: BULB })
    const bulbGeo = new THREE.SphereGeometry(BULB_RADIUS, tier === 'phone' ? 6 : 10, tier === 'phone' ? 4 : 6)
    this.disposables.push(wireMat, bulbMat, bulbGeo)

    const bulbs = strings.flatMap((s) => along(s, BULB_STEP))
    const mesh = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbs.length)
    const m = new THREE.Matrix4()
    bulbs.forEach((p, i) => mesh.setMatrixAt(i, m.makeTranslation(p.x, p.y - BULB_RADIUS, p.z)))
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    this.object.add(mesh)

    for (const s of strings) {
      const wireGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(s), s.length * 2, 0.0035, 4, false)
      this.disposables.push(wireGeo)
      const wire = new THREE.Mesh(wireGeo, wireMat)
      wire.castShadow = false
      this.object.add(wire)
    }
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose()
  }
}

export const lightParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = [(tier) => new Lights(tier)]
