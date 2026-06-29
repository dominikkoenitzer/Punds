import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// Watcher — the lone INNER-WORLD GUARDIAN: an abstract humanoid silhouette
// standing on a tall, thin antenna/pole far out in the skyline, read against
// the twilight-blue sky (the "someone is always watching over the city" motif
// where the Wired and the inner world overlap).
//
// COPYRIGHT-SAFE: the figure is a GENERIC, featureless silhouette assembled from
// primitives only — a tapered torso, an icosa head, suggested arms, and a flared
// COAT (a skirt cone + two trailing tapered flares that flutter in the wind). NO
// face, NO recognizable design.
//
// Each watcher = a dark pole rising from below the floor with a small platform +
// crossbar at the top and a couple of blinking marker lights, plus the figure.
// Bodies are DARK MeshBasic (fog:true) so they fade into the FogExp2 horizon and
// read as silhouettes; their EDGES are drawn as ADDITIVE phosphor/hologram LINES
// (fog:false) so a glowing wireframe outline punches through the haze and the
// bloom pass catches it. ONE primary watcher faces the plaza; a second, smaller
// and fainter one stands much farther off.
//
// All geometries/materials are built ONCE and SHARED across both watchers. The
// figure faces the origin (forward = local +Z). update(): a slow whole-body sway
// + a coat/flare flutter (sine), a breathing rim-glow and throbbing markers —
// every rate × ctx.motion with a slight ctx.audio lift. No per-frame allocation.
// ============================================================================

const FLOOR = -10
const POLE_BOTTOM = -14 // pole sinks below the floor

interface WatcherRec {
  figure: THREE.Group
  baseYaw: number
  baseY: number
  swayPhase: number
  swaySpeed: number
  tails: THREE.Mesh[]
  tailSpeed: number
  tailPhase: number
}

export class Watcher implements SceneFeature {
  readonly group: THREE.Group

  // shared resources (freed in dispose)
  private readonly disposables: Array<{ dispose(): void }> = []

  // animated materials
  private readonly glowMat: THREE.LineBasicMaterial
  private readonly coatGlowMat: THREE.MeshBasicMaterial
  private readonly glowBase: number
  private readonly coatBase: number

  private readonly markers: Array<{ mat: THREE.MeshBasicMaterial; base: number; phase: number; speed: number }> = []
  private readonly watchers: WatcherRec[] = []

  private anim = 0

  // shared geometries
  private readonly poleGeo: THREE.CylinderGeometry
  private readonly platGeo: THREE.BoxGeometry
  private readonly crossGeo: THREE.BoxGeometry
  private readonly markerGeo: THREE.SphereGeometry
  private readonly torsoGeo: THREE.CylinderGeometry
  private readonly headGeo: THREE.IcosahedronGeometry
  private readonly skirtGeo: THREE.CylinderGeometry
  private readonly armGeo: THREE.CylinderGeometry
  private readonly tailGeo: THREE.BufferGeometry
  private readonly torsoEdges: THREE.EdgesGeometry
  private readonly headEdges: THREE.EdgesGeometry
  private readonly skirtEdges: THREE.EdgesGeometry

  // shared body materials
  private readonly poleMat: THREE.MeshBasicMaterial
  private readonly bodyMat: THREE.MeshBasicMaterial

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'Watcher'

    // ---- shared geometries -------------------------------------------------
    this.poleGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6) // unit height, scaled per pole
    this.platGeo = new THREE.BoxGeometry(2.1, 0.18, 2.1)
    this.crossGeo = new THREE.BoxGeometry(3.1, 0.14, 0.14)
    this.markerGeo = new THREE.SphereGeometry(0.16, 6, 6)
    this.torsoGeo = new THREE.CylinderGeometry(0.55, 0.32, 2.0, 7)
    this.headGeo = new THREE.IcosahedronGeometry(0.4, 0)
    this.skirtGeo = new THREE.CylinderGeometry(0.42, 0.95, 2.4, 9, 1, true)
    this.armGeo = new THREE.CylinderGeometry(0.1, 0.15, 1.5, 5)
    this.tailGeo = this.makeTailGeo()
    this.torsoEdges = new THREE.EdgesGeometry(this.torsoGeo)
    this.headEdges = new THREE.EdgesGeometry(this.headGeo)
    this.skirtEdges = new THREE.EdgesGeometry(this.skirtGeo)
    this.disposables.push(
      this.poleGeo, this.platGeo, this.crossGeo, this.markerGeo,
      this.torsoGeo, this.headGeo, this.skirtGeo, this.armGeo, this.tailGeo,
      this.torsoEdges, this.headEdges, this.skirtEdges,
    )

    // ---- shared materials --------------------------------------------------
    // dark silhouette bodies: just above the void, fade into the twilight fog
    this.poleMat = new THREE.MeshBasicMaterial({
      color: palette.voidColor.clone().lerp(palette.hologram, 0.18),
      fog: true,
    })
    this.bodyMat = new THREE.MeshBasicMaterial({
      color: palette.voidColor.clone().lerp(palette.hologram, 0.1),
      fog: true,
      side: THREE.DoubleSide,
    })

    // glowing wireframe rim: additive phosphor edges that punch through the fog
    this.glowBase = 0.55
    this.glowMat = new THREE.LineBasicMaterial({
      color: palette.phosphor.clone().lerp(new THREE.Color(1, 1, 1), 0.15),
      transparent: true,
      opacity: this.glowBase,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    // coat flare glow: a softer hologram-blue additive sheet
    this.coatBase = 0.3
    this.coatGlowMat = new THREE.MeshBasicMaterial({
      color: palette.hologram.clone().lerp(palette.phosphor, 0.25),
      transparent: true,
      opacity: this.coatBase,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    })
    this.disposables.push(this.poleMat, this.bodyMat, this.glowMat, this.coatGlowMat)

    // ---- build the watchers ------------------------------------------------
    // primary: closer-ish, in front of the default view, full detail
    this.buildWatcher(palette, {
      angle: -Math.PI / 2 + 0.36,
      radius: 58,
      topY: 33,
      scale: 1,
      arms: true,
      markerCount: 3,
      swaySpeed: 0.32,
      tailSpeed: 0.85,
    })
    // distant companion: much farther, smaller, fewer accents
    this.buildWatcher(palette, {
      angle: -Math.PI / 2 - 1.45,
      radius: 71,
      topY: 26,
      scale: 0.82,
      arms: false,
      markerCount: 1,
      swaySpeed: 0.27,
      tailSpeed: 0.7,
    })
  }

  // a single tapered coat-flare quad: narrow at the top (attachment), widening
  // toward the trailing bottom. Pivots about its top edge (y = 0).
  private makeTailGeo(): THREE.BufferGeometry {
    const tw = 0.18 // half-width at top
    const bw = 0.6 // half-width at bottom
    const h = 2.3
    const geo = new THREE.BufferGeometry()
    const verts = new Float32Array([
      -tw, 0, 0,
      tw, 0, 0,
      bw, -h, 0,
      -bw, -h, 0,
    ])
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.setIndex([0, 1, 2, 0, 2, 3])
    return geo
  }

  private buildWatcher(
    palette: ScenePalette,
    o: {
      angle: number
      radius: number
      topY: number
      scale: number
      arms: boolean
      markerCount: number
      swaySpeed: number
      tailSpeed: number
    },
  ): void {
    const px = Math.cos(o.angle) * o.radius
    const pz = Math.sin(o.angle) * o.radius

    // base sub-group at the pole's ground location
    const base = new THREE.Group()
    base.position.set(px, 0, pz)
    this.group.add(base)

    // ---- pole ----
    const poleH = o.topY - POLE_BOTTOM
    const pole = new THREE.Mesh(this.poleGeo, this.poleMat)
    pole.scale.set(1, poleH, 1)
    pole.position.y = (o.topY + POLE_BOTTOM) / 2
    base.add(pole)

    // ---- platform + crossbar ----
    const plat = new THREE.Mesh(this.platGeo, this.poleMat)
    plat.position.y = o.topY
    base.add(plat)
    const cross = new THREE.Mesh(this.crossGeo, this.poleMat)
    cross.position.y = o.topY - 1.3
    cross.rotation.y = Math.PI * 0.25
    base.add(cross)

    // ---- marker lights along the pole (additive, blinking) ----
    for (let m = 0; m < o.markerCount; m++) {
      const warn = m % 2 === 0
      const mat = new THREE.MeshBasicMaterial({
        color: (warn ? palette.warning : palette.tachibana).clone(),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      })
      const marker = new THREE.Mesh(this.markerGeo, mat)
      const f = o.markerCount === 1 ? 0.7 : 0.32 + (m / Math.max(1, o.markerCount - 1)) * 0.5
      marker.position.set(0.22, FLOOR + (o.topY - FLOOR) * f, 0)
      base.add(marker)
      this.markers.push({ mat, base: 0.9, phase: m * 1.7, speed: warn ? 1.6 : 0.9 })
      this.disposables.push(mat)
    }

    // ---- the figure -------------------------------------------------------
    const figure = new THREE.Group()
    const baseY = o.topY + 0.18
    figure.position.set(px, baseY, pz) // sits in this.group space, above the platform
    const baseYaw = Math.atan2(-px, -pz) // face the plaza origin (forward = +Z)
    figure.rotation.y = baseYaw
    figure.scale.setScalar(o.scale)
    this.group.add(figure)

    const addBody = (geo: THREE.BufferGeometry, edges: THREE.EdgesGeometry | null, y: number): void => {
      const mesh = new THREE.Mesh(geo, this.bodyMat)
      mesh.position.y = y
      figure.add(mesh)
      if (edges) {
        const line = new THREE.LineSegments(edges, this.glowMat)
        line.position.y = y
        figure.add(line)
      }
    }

    // coat skirt (hides legs), tapered torso, head
    addBody(this.skirtGeo, this.skirtEdges, 1.2)
    addBody(this.torsoGeo, this.torsoEdges, 2.55)
    addBody(this.headGeo, this.headEdges, 4.0)

    // suggested arms (solid only, hanging at the sides)
    if (o.arms) {
      for (const side of [-1, 1]) {
        const arm = new THREE.Mesh(this.armGeo, this.bodyMat)
        arm.position.set(side * 0.6, 2.7, 0.05)
        arm.rotation.z = side * 0.18
        figure.add(arm)
      }
    }

    // ---- wind-blown coat flares (additive glow sheets, fluttering) --------
    const tails: THREE.Mesh[] = []
    for (const side of [-1, 1]) {
      const tail = new THREE.Mesh(this.tailGeo, this.coatGlowMat)
      tail.position.set(side * 0.28, 2.7, -0.3) // trailing behind the figure
      tail.rotation.x = 0.24
      tail.rotation.z = side * 0.12
      figure.add(tail)
      tails.push(tail)
    }

    this.watchers.push({
      figure,
      baseYaw,
      baseY,
      swayPhase: o.angle,
      swaySpeed: o.swaySpeed,
      tails,
      tailSpeed: o.tailSpeed,
      tailPhase: o.angle * 1.3,
    })
  }

  update(ctx: FeatureContext): void {
    this.anim += ctx.dt * ctx.motion
    const t = this.anim
    const lift = 1 + ctx.audio * 0.4

    // breathing rim-glow
    this.glowMat.opacity = this.glowBase * (0.62 + 0.38 * Math.sin(t * 0.5)) * lift
    this.coatGlowMat.opacity = this.coatBase * (0.55 + 0.45 * Math.sin(t * 0.6 + 0.8)) * lift

    // throbbing / blinking pole markers
    for (let i = 0; i < this.markers.length; i++) {
      const mk = this.markers[i]
      const s = Math.abs(Math.sin(t * mk.speed + mk.phase))
      mk.mat.opacity = mk.base * (0.22 + 0.78 * s) * (1 + ctx.audio * 0.3)
    }

    // slow body sway + coat flutter
    for (let w = 0; w < this.watchers.length; w++) {
      const rec = this.watchers[w]
      const sway = Math.sin(t * rec.swaySpeed + rec.swayPhase)
      const sway2 = Math.sin(t * rec.swaySpeed * 0.6 + rec.swayPhase * 1.3)
      rec.figure.rotation.set(sway2 * 0.012, rec.baseYaw + sway * 0.02, sway * 0.03)
      rec.figure.position.y = rec.baseY + sway * 0.05

      for (let k = 0; k < rec.tails.length; k++) {
        const tl = rec.tails[k]
        const sign = k % 2 === 0 ? -1 : 1
        const fl = Math.sin(t * rec.tailSpeed + rec.tailPhase + k * 0.7)
        const fl2 = Math.sin(t * rec.tailSpeed * 1.7 + rec.tailPhase + k)
        tl.rotation.x = 0.24 + fl * 0.28 + ctx.audio * 0.1
        tl.rotation.z = sign * 0.12 + fl2 * 0.16
      }
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.markers.length = 0
    this.watchers.length = 0
    this.group.clear()
  }
}
