import * as THREE from 'three'
import type { Realm } from './realm'
import type { Frame, RealmPart } from './types'
import { groundHeight, POND_LEVEL, pondSdf, CHERRY, MAPLES } from './layout'
import { Terrain } from './terrain'
import { Stonework } from './stonework'
import { Torii } from './torii'
import { Lanterns } from './lanterns'
import { Shrine } from './shrine'
import { EmaRack } from './ema'
import { Grass } from './grass'
import { Skyscape } from './skyscape'
import { loadPbr } from './assets'
import { Rocks } from './rocks'
import { Roots } from './roots'
import { Pond } from './pond'
import { Plants } from './plants'
import { CherryTree, MapleTree, Petals } from './trees'

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

// Parts that render the scene again before the main pass (the clouds' depth
// copy, the pond's reflection) skip what adds nothing there but cost: the sky
// dome, the lawn, and each other's screen-space layers.
interface Prerendering extends RealmPart {
  prerender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void
}

class Sheltered implements RealmPart {
  readonly object: THREE.Object3D
  private part: Prerendering
  private hidden: THREE.Object3D[]

  constructor(part: Prerendering, hidden: THREE.Object3D[]) {
    this.part = part
    this.object = part.object
    this.hidden = hidden
  }

  update(frame: Frame): void {
    this.part.update(frame)
  }

  prerender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    const was = this.hidden.map((o) => o.visible)
    for (const o of this.hidden) o.visible = false
    this.part.prerender(renderer, scene, camera)
    this.hidden.forEach((o, i) => (o.visible = was[i]))
  }

  dispose(): void {
    this.part.dispose()
  }
}

// every scanned set the parts ask for, requested at once so the downloads
// overlap instead of waiting step by step; the parts get them from the cache
const SETS = ['soil', 'gravel', 'moss', 'pebbles', 'cliff', 'rock', 'stone', 'wall', 'painted_wood', 'plaster', 'cedar_planks', 'wood_aged', 'copper', 'sakura_bark', 'maple_bark']

export async function buildIsland(realm: Realm): Promise<void> {
  const tier = realm.tier
  for (const name of SETS) loadPbr(name, tier).catch(() => {})
  const pointer = new PointerGround()
  realm.add(pointer)
  const hiddenFromClouds: THREE.Object3D[] = []
  const hiddenFromPond: THREE.Object3D[] = []
  const sky = realm.skyInfo
  if (sky) hiddenFromClouds.push(sky.mesh)
  const steps: (() => Promise<RealmPart> | RealmPart)[] = [
    () => Terrain.create(tier),
    () => Stonework.create(tier),
    () => Torii.create(tier),
    () => Lanterns.create(tier),
    () => Shrine.create(tier),
    () => EmaRack.create(tier),
    () => Rocks.create(tier),
    () => Roots.create(tier),
    () => Plants.create(tier),
    () => new CherryTree({ tier, x: CHERRY.x, z: CHERRY.z, height: CHERRY.height, spread: CHERRY.spread, lean: CHERRY.lean, seed: 11 }),
    ...MAPLES.map((m, i) => () => new MapleTree({ tier, x: m.x, z: m.z, height: m.height, spread: m.spread, seed: 21 + i })),
    () => new Petals({ tier }),
    () => {
      const grass = new Grass({ tier })
      pointer.listenGround(grass)
      hiddenFromClouds.push(grass.object)
      hiddenFromPond.push(grass.object)
      return grass
    },
    () => {
      const skyscape = new Skyscape({ tier })
      // the cloud shader reads the panorama in its own convention, a quarter
      // turn from three's equirect lookup
      if (sky) skyscape.setSky(sky.panorama, { k: sky.k, yaw: -2 * Math.PI * sky.shift - Math.PI / 2 })
      hiddenFromPond.push(skyscape.object)
      return new Sheltered(skyscape, hiddenFromClouds)
    },
    () => {
      const pond = new Pond({ tier })
      pointer.listenWater(pond)
      hiddenFromClouds.push(pond.object)
      return new Sheltered(pond, hiddenFromPond)
    },
  ]
  // ?debug&skip=2,7 leaves build steps out, to measure what each one costs
  const params = new URLSearchParams(location.search)
  const skip = params.has('debug') ? new Set((params.get('skip') ?? '').split(',').filter(Boolean).map(Number)) : new Set<number>()
  for (const [index, make] of steps.entries()) {
    if (skip.has(index)) continue
    await yieldToMain()
    const t0 = performance.now()
    const part = await make()
    realm.add(part)
    realm.buildTimes.push([part.constructor.name, Math.round(performance.now() - t0)])
  }
}
