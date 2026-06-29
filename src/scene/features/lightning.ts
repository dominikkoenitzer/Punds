import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// BattleStorm — the inner-world rainstorm intensifying into a crackling
// BATTLE-STORM of lightning as an unseen titanic clash bleeds into the sky.
// Periodic crescent of light over the horizon: jagged branching bolts crack the
// twilight, each one strobing with a couple of stutter re-strikes while a brief
// white-blue SKY FLASH blooms behind the clouds to sell the thunderclap.
//
// COPYRIGHT-SAFE: purely generic energy/lightning FX — no characters, logos, or
// named techniques. Just procedural bolts + sky flares.
//
// IMPLEMENTATION — everything is POOLED and RECURRING; nothing allocates per
// frame:
//   • BOLTS — a small pool of THREE.LineSegments, each with a PRE-ALLOCATED
//     position buffer (a fixed main trunk + 3 branch slots). On a strike the
//     bolt's jagged path is REGENERATED in place by a pinned random-walk
//     (midpoint-style lateral displacement, envelope-pinned at both ends)
//     written straight into the reused buffer — no new arrays. Vertex COLOURS
//     are baked once (white-hot trunk -> cooler blue branch tips); the per-bolt
//     material OPACITY carries the flash + fade. Branches randomly collapse to a
//     zero-length point so each strike shows 1-3 visible forks.
//   • SKY FLASH — a pool of additive billboard quads (one shared soft radial
//     CanvasTexture) parked high at the bolt's origin; on a strike one blooms
//     white-blue and fades fast, lighting the clouds.
//
// BEHAVIOUR — strikes fire on a recurring randomized cooldown (~2.5-6s), some-
// times as a rapid double/triple BURST, at random sky bearings around the plaza
// (radius ~40-120, high y). Cadence + intensity climb with ctx.audio (bass).
//
// update(): advance the schedule, decay/strobe active bolts (regenerating the
// path on each stutter re-strike), fade the sky flares, billboard them to the
// camera. All rates × ctx.motion, intensity reduced under reduced-motion.
// ============================================================================

const TAU = Math.PI * 2

// --- bolt pool sizing (fixed buffer layout so colours bake once) -------------
const BOLT_COUNT = 5
const MAIN_SEGS = 22 // segments in the main trunk
const BRANCHES = 3 // branch slots per bolt
const BRANCH_SEGS = 6 // segments in each branch
// LineSegments: every drawn segment is a vertex PAIR
const VERTS_PER_BOLT = (MAIN_SEGS + BRANCHES * BRANCH_SEGS) * 2

// --- sky-flash pool ----------------------------------------------------------
const FLASH_COUNT = 5

interface Bolt {
  mat: THREE.LineBasicMaterial
  line: THREE.LineSegments
  posArr: Float32Array
  posAttr: THREE.BufferAttribute
  // sky endpoints (regen jitters a fresh path between them)
  sx: number
  sy: number
  sz: number
  ex: number
  ey: number
  ez: number
  jitter: number // lateral random-walk step
  active: boolean
  age: number
  life: number
  flash: number // current brightness 0..1
  peak: number // baked peak brightness
  restrikes: Float32Array // ascending stutter times (excl. the initial strike)
  restrikeCount: number
  nextRestrike: number
}

interface Flash {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  active: boolean
  age: number
  life: number
  peak: number
}

export class BattleStorm implements SceneFeature {
  readonly group: THREE.Group

  private readonly bolts: Bolt[] = []
  private readonly flashes: Flash[] = []

  // shared flash resources
  private readonly flashGeo: THREE.PlaneGeometry
  private readonly flashTex: THREE.CanvasTexture

  // reused path scratch (no per-frame / per-strike allocation)
  private readonly mainPts = new Float32Array((MAIN_SEGS + 1) * 3)
  private readonly branchPts = new Float32Array((BRANCH_SEGS + 1) * 3)

  // strike schedule
  private cooldown: number
  private burstLeft = 0
  private burstTimer = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'BattleStorm'

    // ---- baked bolt vertex colours: white-hot trunk -> cool blue branches ----
    const white = new THREE.Color(1, 1, 1)
    const core = white.clone().lerp(palette.hologram, 0.22) // bright white-blue
    const branch = palette.hologram.clone().lerp(white, 0.55)
    const colTemplate = this.buildColorTemplate(core, branch)

    // ---- bolt pool ----------------------------------------------------------
    for (let i = 0; i < BOLT_COUNT; i++) {
      const posArr = new Float32Array(VERTS_PER_BOLT * 3)
      const posAttr = new THREE.BufferAttribute(posArr, 3)
      posAttr.setUsage(THREE.DynamicDrawUsage)

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', posAttr)
      geo.setAttribute('color', new THREE.BufferAttribute(colTemplate.slice(), 3))

      const mat = new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        fog: false,
        toneMapped: false,
      })

      const line = new THREE.LineSegments(geo, mat)
      line.frustumCulled = false // path rewrites outrun the cached bounds
      line.renderOrder = 3
      line.visible = false
      this.group.add(line)

      this.bolts.push({
        mat,
        line,
        posArr,
        posAttr,
        sx: 0, sy: 0, sz: 0,
        ex: 0, ey: 0, ez: 0,
        jitter: 2.5,
        active: false,
        age: 0,
        life: 0,
        flash: 0,
        peak: 1,
        restrikes: new Float32Array(3),
        restrikeCount: 0,
        nextRestrike: 0,
      })
    }

    // ---- sky-flash pool -----------------------------------------------------
    this.flashTex = makeFlashTexture()
    this.flashGeo = new THREE.PlaneGeometry(1, 1)
    const flashColor = white.clone().lerp(palette.hologram, 0.18)
    for (let i = 0; i < FLASH_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.flashTex,
        color: flashColor,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(this.flashGeo, mat)
      mesh.frustumCulled = false
      mesh.renderOrder = 2
      mesh.visible = false
      this.group.add(mesh)
      this.flashes.push({ mesh, mat, active: false, age: 0, life: 0, peak: 1 })
    }

    // first strike a couple of seconds in
    this.cooldown = 1.5 + Math.random() * 2.2
  }

  // bake the static colour layout: a hot, slightly top-biased trunk, then dimmer
  // branches fading toward their tips. Layout matches writeSegments() ordering.
  private buildColorTemplate(core: THREE.Color, branch: THREE.Color): Float32Array {
    const arr = new Float32Array(VERTS_PER_BOLT * 3)
    let w = 0
    for (let s = 0; s < MAIN_SEGS; s++) {
      const f0 = 1 - (s / MAIN_SEGS) * 0.35
      const f1 = 1 - ((s + 1) / MAIN_SEGS) * 0.35
      arr[w++] = core.r * f0; arr[w++] = core.g * f0; arr[w++] = core.b * f0
      arr[w++] = core.r * f1; arr[w++] = core.g * f1; arr[w++] = core.b * f1
    }
    for (let b = 0; b < BRANCHES; b++) {
      for (let s = 0; s < BRANCH_SEGS; s++) {
        const g0 = 0.7 * (1 - (s / BRANCH_SEGS) * 0.7)
        const g1 = 0.7 * (1 - ((s + 1) / BRANCH_SEGS) * 0.7)
        arr[w++] = branch.r * g0; arr[w++] = branch.g * g0; arr[w++] = branch.b * g0
        arr[w++] = branch.r * g1; arr[w++] = branch.g * g1; arr[w++] = branch.b * g1
      }
    }
    return arr
  }

  // expand a polyline (nPoints points) into (nPoints-1) segment vertex pairs,
  // written into the reused position buffer starting at vertex vOff.
  private writeSegments(pos: Float32Array, vOff: number, pts: Float32Array, nPoints: number): void {
    let w = vOff * 3
    for (let s = 0; s < nPoints - 1; s++) {
      const a = s * 3
      const c = (s + 1) * 3
      pos[w++] = pts[a]; pos[w++] = pts[a + 1]; pos[w++] = pts[a + 2]
      pos[w++] = pts[c]; pos[w++] = pts[c + 1]; pos[w++] = pts[c + 2]
    }
  }

  // collapse a branch slot to a single point -> zero-length (invisible) segments
  private collapseSegments(pos: Float32Array, vOff: number, x: number, y: number, z: number): void {
    let w = vOff * 3
    for (let i = 0; i < BRANCH_SEGS * 2; i++) {
      pos[w++] = x; pos[w++] = y; pos[w++] = z
    }
  }

  // rewrite a bolt's jagged path in place (called on the initial strike and on
  // every stutter re-strike to make the bolt flicker / jump).
  private regenBolt(b: Bolt): void {
    const main = this.mainPts
    const br = this.branchPts
    const pos = b.posArr
    const sx = b.sx, sy = b.sy, sz = b.sz
    const ex = b.ex, ey = b.ey, ez = b.ez
    const step = b.jitter

    // --- main trunk: pinned random walk (envelope 0 at ends, max mid) ---
    let ox = 0
    let oz = 0
    for (let k = 0; k <= MAIN_SEGS; k++) {
      const f = k / MAIN_SEGS
      const env = Math.sin(f * Math.PI)
      ox += (Math.random() * 2 - 1) * step
      oz += (Math.random() * 2 - 1) * step
      const j = k * 3
      main[j] = sx + (ex - sx) * f + ox * env
      main[j + 1] = sy + (ey - sy) * f + (Math.random() * 2 - 1) * step * 0.5 * env
      main[j + 2] = sz + (ez - sz) * f + oz * env
    }
    this.writeSegments(pos, 0, main, MAIN_SEGS + 1)

    // --- branches forking off the trunk (some collapse -> 1-3 visible) ---
    for (let bIdx = 0; bIdx < BRANCHES; bIdx++) {
      const vOff = 2 * MAIN_SEGS + bIdx * 2 * BRANCH_SEGS
      const fk = Math.floor((0.28 + Math.random() * 0.5) * MAIN_SEGS) * 3
      const obx = main[fk], oby = main[fk + 1], obz = main[fk + 2]

      if (Math.random() < 0.28) {
        this.collapseSegments(pos, vOff, obx, oby, obz)
        continue
      }

      const a = Math.random() * TAU
      const len = 7 + Math.random() * 13
      const drop = len * (0.5 + Math.random() * 0.6)
      const tex = obx + Math.cos(a) * len
      const tez = obz + Math.sin(a) * len
      const tey = oby - drop
      const bstep = step * 0.7
      let bx = 0
      let bz = 0
      for (let k = 0; k <= BRANCH_SEGS; k++) {
        const f = k / BRANCH_SEGS
        const env = Math.sin(f * Math.PI)
        bx += (Math.random() * 2 - 1) * bstep
        bz += (Math.random() * 2 - 1) * bstep
        const j = k * 3
        br[j] = obx + (tex - obx) * f + bx * env
        br[j + 1] = oby + (tey - oby) * f + (Math.random() * 2 - 1) * bstep * 0.5 * env
        br[j + 2] = obz + (tez - obz) * f + bz * env
      }
      this.writeSegments(pos, vOff, br, BRANCH_SEGS + 1)
    }

    b.posAttr.needsUpdate = true
  }

  // claim a free bolt + sky flash and fire a strike at a random sky position
  private spawnStrike(): void {
    let bi = -1
    for (let i = 0; i < this.bolts.length; i++) {
      if (!this.bolts[i].active) { bi = i; break }
    }
    if (bi < 0) return // pool exhausted — drop this strike

    const b = this.bolts[bi]
    const ang = Math.random() * TAU
    const rad = 40 + Math.random() * 80
    const sx = Math.cos(ang) * rad
    const sz = Math.sin(ang) * rad
    const sy = 72 + Math.random() * 40

    b.sx = sx; b.sy = sy; b.sz = sz
    b.ex = sx + (Math.random() * 2 - 1) * 26
    b.ez = sz + (Math.random() * 2 - 1) * 26
    b.ey = 22 + Math.random() * 26
    b.jitter = 2.2 + Math.random() * 2.0

    // 1-2 stutter re-strikes after the initial flash
    const cnt = 1 + (Math.random() < 0.6 ? 1 : 0)
    b.restrikeCount = cnt
    let tprev = 0
    for (let k = 0; k < cnt; k++) {
      tprev += 0.05 + Math.random() * 0.06
      b.restrikes[k] = tprev
    }
    b.life = tprev + 0.16 + Math.random() * 0.12
    b.peak = 0.85 + Math.random() * 0.15
    b.age = 0
    b.flash = 1
    b.nextRestrike = 0
    b.active = true
    b.line.visible = true
    this.regenBolt(b)

    this.spawnFlash(sx, sy, sz)
  }

  private spawnFlash(x: number, y: number, z: number): void {
    let fi = -1
    for (let i = 0; i < this.flashes.length; i++) {
      if (!this.flashes[i].active) { fi = i; break }
    }
    if (fi < 0) return

    const f = this.flashes[fi]
    const size = 55 + Math.random() * 70
    f.mesh.position.set(x, y, z)
    f.mesh.scale.set(size, size, 1)
    f.life = 0.18 + Math.random() * 0.14
    f.age = 0
    f.peak = 0.7 + Math.random() * 0.3
    f.active = true
    f.mesh.visible = true
  }

  update(ctx: FeatureContext): void {
    const m = ctx.motion
    const adt = ctx.dt * m // animation dt, scaled by motion
    const audio = ctx.audio

    // ---- schedule: primary strikes on a cooldown, optional rapid burst -------
    this.cooldown -= adt
    if (this.cooldown <= 0) {
      this.spawnStrike()
      if (Math.random() < 0.22 + audio * 0.4) {
        this.burstLeft = 1 + (Math.random() < 0.4 ? 1 : 0)
        this.burstTimer = 0.09 + Math.random() * 0.16
      }
      this.cooldown = (2.5 + Math.random() * 3.5) / (1 + audio * 1.6)
    }
    if (this.burstLeft > 0) {
      this.burstTimer -= adt
      if (this.burstTimer <= 0) {
        this.spawnStrike()
        this.burstLeft--
        this.burstTimer = 0.09 + Math.random() * 0.16
      }
    }

    // overall energy gain: bass lifts it, reduced-motion calms it
    const gain = (0.55 + audio * 0.85) * (0.4 + 0.6 * m)

    // ---- bolts: strobe + fade, regen path on each stutter re-strike ----------
    for (const b of this.bolts) {
      if (!b.active) continue
      b.age += adt

      while (b.nextRestrike < b.restrikeCount && b.age >= b.restrikes[b.nextRestrike]) {
        b.flash = 1
        this.regenBolt(b)
        b.nextRestrike++
      }

      b.flash -= b.flash * Math.min(1, 12 * adt) // fast exponential-ish decay
      if (b.age >= b.life && b.flash < 0.02) {
        b.active = false
        b.line.visible = false
        b.mat.opacity = 0
        continue
      }
      b.mat.opacity = b.flash * b.peak * gain
    }

    // ---- sky flashes: bloom then fade, billboarded to the camera -------------
    const camQ = ctx.camera.quaternion
    const flashGain = (0.5 + audio * 0.6) * (0.4 + 0.6 * m)
    for (const f of this.flashes) {
      if (!f.active) continue
      f.age += adt
      const fr = f.age / f.life
      if (fr >= 1) {
        f.active = false
        f.mesh.visible = false
        f.mat.opacity = 0
        continue
      }
      f.mesh.quaternion.copy(camQ)
      f.mat.opacity = f.peak * (1 - fr) * flashGain
    }
  }

  dispose(): void {
    for (const b of this.bolts) {
      b.line.geometry.dispose()
      b.mat.dispose()
    }
    this.bolts.length = 0
    for (const f of this.flashes) f.mat.dispose()
    this.flashes.length = 0
    this.flashGeo.dispose()
    this.flashTex.dispose()
    this.group.clear()
  }
}

// One soft radial glow (white core -> transparent) for the sky-flash billboards.
function makeFlashTexture(): THREE.CanvasTexture {
  const S = 128
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace

  const ctx = canvas.getContext('2d')
  if (!ctx) return tex // stays transparent if no 2d context

  const c = S / 2
  const g = ctx.createRadialGradient(c, c, 0, c, c, c)
  g.addColorStop(0, 'rgba(232,242,255,0.95)')
  g.addColorStop(0.25, 'rgba(200,224,255,0.5)')
  g.addColorStop(0.6, 'rgba(170,205,250,0.16)')
  g.addColorStop(1, 'rgba(150,195,245,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)

  tex.needsUpdate = true
  return tex
}
