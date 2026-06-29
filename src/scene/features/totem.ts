import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// Totem — the INCEPTION SPINNING TOP that never falls (is this a dream?), plus a
// few small dream artifacts drifting at the plaza edge.
//
// THE TOP: a small classic spinning-top silhouette built from primitives — a
// downward-pointing CONE body (tip planted on a tiny glowing pedestal) capped by
// a thin STEM. The solid body is DARK MeshBasic (reads metallic, sinks into the
// twilight fog); its EDGES are drawn as ADDITIVE phosphor LINES (a glowing
// wireframe rim) so the bloom pass catches it and it reflects crisply in the
// floor. It sits at radius ~9 from origin (base on the floor at y = -10) — small
// enough to read as an OBJECT you notice, not a landmark. update() spins it FAST
// and continuously about its vertical axis with a faint PRECESSION wobble whose
// axis traces a tiny cone but NEVER topples (the tip stays planted because the
// geometry's apex is the pivot origin); a subtle audio-driven rim glow.
//
// DREAM ARTIFACTS: three small, sparse, slowly-tumbling impossible objects
// floating low around the plaza edge (radius ~13-15) — a wireframe cube, a thin
// glowing ring, and a wireframe tetrahedron — all additive glowing edges in the
// cool twilight palette, gently bobbing. Kept outside the clear central plaza.
//
// All geometry/material is built ONCE; meshes total ~nine. update() does pure
// scalar math (rotation accumulation + sin/cos wobble + a couple of opacity
// scalars) — no per-frame allocation. Every rate × ctx.motion, lifted by audio.
// dispose() frees every geometry + material. COPYRIGHT-SAFE: generic primitives.
// ============================================================================

const FLOOR = -10

interface Artifact {
  obj: THREE.Object3D
  rx: number
  ry: number
  rz: number
  baseY: number
  bobAmp: number
  bobSpeed: number
  phase: number
}

export class Totem implements SceneFeature {
  readonly group: THREE.Group

  // everything that owns GPU memory, freed in dispose()
  private readonly disposables: Array<{ dispose(): void }> = []

  // the spinning top
  private readonly topPivot: THREE.Group // precesses (axis wobble); tip at its origin
  private readonly topSpin: THREE.Group // spins fast about Y
  private readonly topGlowMat: THREE.LineBasicMaterial
  private readonly topGlowBase: number
  private readonly pedestalGlowMat: THREE.MeshBasicMaterial
  private readonly pedestalGlowBase: number

  // dream artifacts
  private readonly artifacts: Artifact[] = []
  private readonly artifactMat: THREE.LineBasicMaterial // shared wireframe glow
  private readonly artifactBase: number
  private readonly ringMat: THREE.MeshBasicMaterial // additive solid glowing ring
  private readonly ringBase: number

  private anim = 0
  private spinAngle = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'Totem'

    const white = new THREE.Color(1, 1, 1)

    // ---- shared materials --------------------------------------------------
    // dark "metallic" body that fades into the twilight fog
    const bodyMat = new THREE.MeshBasicMaterial({
      color: palette.voidColor.clone().lerp(palette.hologram, 0.16),
      fog: true,
    })
    // bright additive phosphor wireframe rim — the bloom-catching highlight
    this.topGlowBase = 0.85
    this.topGlowMat = new THREE.LineBasicMaterial({
      color: palette.phosphor.clone().lerp(white, 0.2),
      transparent: true,
      opacity: this.topGlowBase,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    // dark pedestal body + a faint additive glow ring seated on top
    const pedestalMat = new THREE.MeshBasicMaterial({
      color: palette.voidColor.clone().lerp(palette.hologram, 0.1),
      fog: true,
    })
    this.pedestalGlowBase = 0.55
    this.pedestalGlowMat = new THREE.MeshBasicMaterial({
      color: palette.phosphor.clone().lerp(palette.hologram, 0.35),
      transparent: true,
      opacity: this.pedestalGlowBase,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    this.disposables.push(bodyMat, this.topGlowMat, pedestalMat, this.pedestalGlowMat)

    // ---- the spinning top --------------------------------------------------
    // placed forward-right of the default view, near enough to notice
    const angle = -Math.PI / 2 + 0.62
    const radius = 9
    const dais = new THREE.Group()
    dais.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    this.group.add(dais)

    // pedestal: short tapered cylinder, bottom on the floor
    const pedH = 0.16
    const pedestalGeo = new THREE.CylinderGeometry(0.6, 0.72, pedH, 16)
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat)
    pedestal.position.y = FLOOR + pedH / 2
    dais.add(pedestal)
    this.disposables.push(pedestalGeo)

    // glowing rim ring lying flat on the pedestal top
    const pedTop = FLOOR + pedH
    const rimGeo = new THREE.TorusGeometry(0.58, 0.035, 8, 24)
    rimGeo.rotateX(Math.PI / 2)
    const rim = new THREE.Mesh(rimGeo, this.pedestalGlowMat)
    rim.position.y = pedTop + 0.005
    dais.add(rim)
    this.disposables.push(rimGeo)

    // top body: cone with the APEX pointing DOWN (the planted tip at local y = 0)
    const coneH = 0.8
    const coneGeo = new THREE.ConeGeometry(0.5, coneH, 14)
    coneGeo.rotateX(Math.PI) // apex now at the bottom
    coneGeo.translate(0, coneH / 2, 0) // apex at y = 0, wide base at y = coneH
    const coneEdges = new THREE.EdgesGeometry(coneGeo)
    // thin stem rising from the cone base
    const stemH = 0.5
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, stemH, 8)
    stemGeo.translate(0, coneH + stemH / 2, 0)
    const stemEdges = new THREE.EdgesGeometry(stemGeo)
    this.disposables.push(coneGeo, coneEdges, stemGeo, stemEdges)

    // pivot (precesses) -> spin group (fast spin) -> body meshes
    this.topPivot = new THREE.Group()
    this.topPivot.position.set(0, pedTop, 0) // tip rests on the pedestal rim
    dais.add(this.topPivot)
    this.topSpin = new THREE.Group()
    this.topPivot.add(this.topSpin)

    this.topSpin.add(new THREE.Mesh(coneGeo, bodyMat))
    this.topSpin.add(new THREE.LineSegments(coneEdges, this.topGlowMat))
    this.topSpin.add(new THREE.Mesh(stemGeo, bodyMat))
    this.topSpin.add(new THREE.LineSegments(stemEdges, this.topGlowMat))

    // ---- dream artifacts ---------------------------------------------------
    this.artifactBase = 0.62
    this.artifactMat = new THREE.LineBasicMaterial({
      color: palette.hologram.clone().lerp(palette.phosphor, 0.45),
      transparent: true,
      opacity: this.artifactBase,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    })
    this.ringBase = 0.5
    this.ringMat = new THREE.MeshBasicMaterial({
      color: palette.hologram.clone().lerp(palette.tachibana, 0.12),
      transparent: true,
      opacity: this.ringBase,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    this.disposables.push(this.artifactMat, this.ringMat)

    // wireframe cube
    const cubeSrc = new THREE.BoxGeometry(0.95, 0.95, 0.95)
    const cubeEdges = new THREE.EdgesGeometry(cubeSrc)
    this.disposables.push(cubeSrc, cubeEdges)
    this.addArtifact(new THREE.LineSegments(cubeEdges, this.artifactMat), {
      angle: -Math.PI / 2 - 1.7,
      radius: 14,
      baseY: 1.2,
      rx: 0.18,
      ry: 0.26,
      rz: 0.0,
      bobAmp: 0.55,
      bobSpeed: 0.5,
      phase: 0.3,
    })

    // thin glowing ring (additive solid)
    const ringGeo = new THREE.TorusGeometry(0.55, 0.045, 8, 28)
    this.disposables.push(ringGeo)
    this.addArtifact(new THREE.Mesh(ringGeo, this.ringMat), {
      angle: -Math.PI / 2 + 2.4,
      radius: 15,
      baseY: -1.0,
      rx: 0.35,
      ry: 0.12,
      rz: 0.2,
      bobAmp: 0.7,
      bobSpeed: 0.4,
      phase: 1.9,
    })

    // wireframe tetrahedron
    const tetraSrc = new THREE.TetrahedronGeometry(0.62, 0)
    const tetraEdges = new THREE.EdgesGeometry(tetraSrc)
    this.disposables.push(tetraSrc, tetraEdges)
    this.addArtifact(new THREE.LineSegments(tetraEdges, this.artifactMat), {
      angle: -Math.PI / 2 + 0.05 + Math.PI,
      radius: 13.5,
      baseY: 2.4,
      rx: 0.22,
      ry: -0.3,
      rz: 0.14,
      bobAmp: 0.6,
      bobSpeed: 0.55,
      phase: 3.4,
    })
  }

  private addArtifact(
    obj: THREE.Object3D,
    o: {
      angle: number
      radius: number
      baseY: number
      rx: number
      ry: number
      rz: number
      bobAmp: number
      bobSpeed: number
      phase: number
    },
  ): void {
    obj.position.set(Math.cos(o.angle) * o.radius, o.baseY, Math.sin(o.angle) * o.radius)
    obj.rotation.set(o.phase * 0.7, o.phase, o.phase * 0.4)
    this.group.add(obj)
    this.artifacts.push({
      obj,
      rx: o.rx,
      ry: o.ry,
      rz: o.rz,
      baseY: o.baseY,
      bobAmp: o.bobAmp,
      bobSpeed: o.bobSpeed,
      phase: o.phase,
    })
  }

  update(ctx: FeatureContext): void {
    const motion = ctx.motion
    const step = ctx.dt * motion
    this.anim += step
    const t = this.anim
    const lift = 1 + ctx.audio * 0.5

    // THE TOP: fast continuous spin (faintly lifted by audio)
    this.spinAngle += step * (9.0 + ctx.audio * 3.0)
    this.topSpin.rotation.y = this.spinAngle

    // faint precession: the spin axis traces a tiny cone but never topples.
    // Tip stays planted because the cone apex is the pivot origin.
    const wob = 0.05 + ctx.audio * 0.015
    const slow = t * 0.8
    this.topPivot.rotation.x = wob * Math.sin(slow) + 0.01 * Math.sin(t * 2.3)
    this.topPivot.rotation.z = wob * Math.cos(slow) + 0.01 * Math.cos(t * 1.9)

    // breathing rim glow on the top + its pedestal halo
    this.topGlowMat.opacity = this.topGlowBase * (0.62 + 0.38 * Math.sin(t * 1.5)) * lift
    this.pedestalGlowMat.opacity =
      this.pedestalGlowBase * (0.6 + 0.4 * Math.sin(t * 1.1 + 0.7)) * lift

    // DREAM ARTIFACTS: slow tumble + gentle bob
    for (let i = 0; i < this.artifacts.length; i++) {
      const a = this.artifacts[i]
      a.obj.rotation.x += step * a.rx
      a.obj.rotation.y += step * a.ry
      a.obj.rotation.z += step * a.rz
      a.obj.position.y = a.baseY + Math.sin(t * a.bobSpeed + a.phase) * a.bobAmp
    }
    this.artifactMat.opacity = this.artifactBase * (0.62 + 0.38 * Math.sin(t * 0.9 + 1.2)) * lift
    this.ringMat.opacity = this.ringBase * (0.6 + 0.4 * Math.sin(t * 0.7 + 2.5)) * lift
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.artifacts.length = 0
    this.group.clear()
  }
}
