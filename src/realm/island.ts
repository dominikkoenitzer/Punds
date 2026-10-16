import * as THREE from 'three'
import type { Realm } from './realm'
import type { Frame, RealmPart } from './types'
import { groundHeight, POND_LEVEL, pondSdf } from './layout'
import { Terrain } from './terrain'
import { Stonework } from './stonework'
import { Torii } from './torii'
import { Lanterns } from './lanterns'
import { Shrine } from './shrine'
import { EmaRack } from './ema'
import { Grass } from './grass'

// What the island is made of, in the order it is built. Each step yields to
// the browser so the waking view keeps its frame rate while the rest loads.

function yieldToMain(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (s?.yield) return s.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface PointerListener {
  setPointer(point: THREE.Vector3 | null): void
}

// Finds where the pointer ray meets the ground (or the pond's surface) and
// tells the parts that react to it. The ray is marched against
// layout.groundHeight, which is exact for the lawn and close enough
// everywhere else.
class PointerGround implements RealmPart {
  readonly object = new THREE.Group()
  private ground: PointerListener[] = []
  private water: PointerListener[] = []
  private point = new THREE.Vector3()
  private probe = new THREE.Vector3()

  listenGround(l: PointerListener): void {
    this.ground.push(l)
  }

  listenWater(l: PointerListener): void {
    this.water.push(l)
  }

  update(frame: Frame): void {
    const ray = frame.pointer
    let hit: 'ground' | 'water' | null = null
    if (ray && ray.direction.y < -0.02) {
      let prev = 0
      for (let t = 0.5; t < 80; t += Math.max(0.15, t * 0.04)) {
        ray.at(t, this.probe)
        const wet = pondSdf(this.probe.x, this.probe.z) < 0
        const floor = wet ? Math.max(groundHeight(this.probe.x, this.probe.z), POND_LEVEL) : groundHeight(this.probe.x, this.probe.z)
        if (this.probe.y <= floor) {
          // settle between the last two steps
          ray.at((prev + t) / 2, this.point)
          this.point.y = floor
          hit = wet ? 'water' : 'ground'
          break
        }
        prev = t
      }
    }
    for (const l of this.ground) l.setPointer(hit === 'ground' ? this.point : null)
    for (const l of this.water) l.setPointer(hit === 'water' ? this.point : null)
  }

  dispose(): void {}
}

export async function buildIsland(realm: Realm): Promise<void> {
  const tier = realm.tier
  const pointer = new PointerGround()
  realm.add(pointer)
  const steps: (() => Promise<RealmPart> | RealmPart)[] = [
    () => Terrain.create(tier),
    () => Stonework.create(tier),
    () => Torii.create(tier),
    () => Lanterns.create(tier),
    () => Shrine.create(tier),
    () => EmaRack.create(tier),
    () => {
      const grass = new Grass({ tier })
      pointer.listenGround(grass)
      return grass
    },
  ]
  for (const make of steps) {
    await yieldToMain()
    realm.add(await make())
  }
}
