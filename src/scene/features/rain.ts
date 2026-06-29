import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// InnerRain — the constant, melancholy rain of the BLEACH inner world ("it
// always rains in my inner world") bleeding into the Wired. A tall COLUMN of
// thin falling streaks that always surrounds the viewer: the whole field is
// anchored to the live camera in X/Z each frame, so no matter where you dolly
// or look, soft cool-blue rain is falling around you and dissolving into the
// twilight-blue fog horizon.
//
// IMPLEMENTATION — one single THREE.LineSegments draws every drop. Each drop is
// two vertices (a faint trailing TOP + a bright leading BOTTOM) so the line is a
// short slanted streak with a comet fade baked into a static vertex-COLOUR
// attribute (additive blending turns the dim top vertex into a fade, the bright
// bottom into the head). Per frame we only march each drop's Y down, drift it
// sideways with a gentle wind, wrap it within the column, and rewrite the two
// vertex positions in place — no per-frame allocation, no texture, one draw call.
//
// RIPPLES — a tiny pool of additive expanding rings sit just above the reflective
// floor where rain "lands", growing + fading then recycling. They share one ring
// geometry; the pool is small so per-ripple materials stay cheap.
//
// update(): fall + drift + recycle (x ctx.motion), follow the camera in X/Z,
// and let ctx.audio lift the fall speed / brightness / ripple cadence subtly.
// ============================================================================

const COUNT = 1400 // falling streaks (one LineSegments, two verts each)
const R = 45 // horizontal half-extent of the rain column around the camera
const TOP_Y = 30 // streaks respawn at the top of the column here…
const FLOOR_Y = -10 // …and recycle once their head dips below the world floor
const SPAN_Y = TOP_Y - FLOOR_Y

const SPEED_MIN = 24 // fall speed, world units / second
const SPEED_VAR = 18
const LEN_MIN = 1.2 // streak length
const LEN_VAR = 1.4

const DRIFT_X = 1.1 // gentle sideways wind, units / second
const DRIFT_Z = 0.35

const BASE_OPACITY = 0.5

// ripples ---------------------------------------------------------------------
const RIPPLE_COUNT = 10
const RIPPLE_Y = -9.9 // a hair above the mirror so they read on the wet floor
const RIPPLE_LIFE = 1.5 // seconds for a ripple to grow + fade
const RIPPLE_R0 = 0.4 // start radius
const RIPPLE_SPAWN = 0.16 // base seconds between landings
const RIPPLE_FIELD = 34 // ripples land within this radius of the camera

interface Ripple {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  age: number
  active: boolean
  max: number // this ripple's final radius
}

export class InnerRain implements SceneFeature {
  readonly group: THREE.Group

  // --- streaks ---
  private readonly geo: THREE.BufferGeometry
  private readonly mat: THREE.LineBasicMaterial
  private readonly positions: Float32Array
  private readonly posAttr: THREE.BufferAttribute

  // per-drop state (parallel arrays — no per-drop objects)
  private readonly ox = new Float32Array(COUNT) // X offset relative to camera
  private readonly oz = new Float32Array(COUNT) // Z offset relative to camera
  private readonly dy = new Float32Array(COUNT) // current Y of the streak top
  private readonly len = new Float32Array(COUNT)
  private readonly spd = new Float32Array(COUNT)

  // unit slant of a streak (wind-tilted, mostly down)
  private readonly wdx: number
  private readonly wdy: number
  private readonly wdz: number

  // --- ripples ---
  private readonly rippleGeo: THREE.RingGeometry
  private readonly ripples: Ripple[] = []
  private spawnTimer = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'InnerRain'

    // streak slant: a slight wind tilt baked into the unit fall direction
    const wx = 0.16
    const wy = -1
    const wz = 0.06
    const inv = 1 / Math.sqrt(wx * wx + wy * wy + wz * wz)
    this.wdx = wx * inv
    this.wdy = wy * inv
    this.wdz = wz * inv

    this.positions = new Float32Array(COUNT * 2 * 3)
    const colors = new Float32Array(COUNT * 2 * 3)

    // cool blue-white: phosphor cyan leaned toward hologram blue, then bleached
    const white = new THREE.Color(1, 1, 1)
    const base = palette.phosphor.clone().lerp(palette.hologram, 0.4).lerp(white, 0.5)

    for (let i = 0; i < COUNT; i++) {
      this.ox[i] = (Math.random() * 2 - 1) * R
      this.oz[i] = (Math.random() * 2 - 1) * R
      this.dy[i] = FLOOR_Y + Math.random() * SPAN_Y
      this.len[i] = LEN_MIN + Math.random() * LEN_VAR
      this.spd[i] = SPEED_MIN + Math.random() * SPEED_VAR

      // static comet fade: dim trailing top vertex -> bright leading bottom
      const b = 0.55 + Math.random() * 0.45
      const ci = i * 6
      colors[ci + 0] = base.r * b * 0.12
      colors[ci + 1] = base.g * b * 0.12
      colors[ci + 2] = base.b * b * 0.12
      colors[ci + 3] = base.r * b
      colors[ci + 4] = base.g * b
      colors[ci + 5] = base.b * b
    }

    this.posAttr = new THREE.BufferAttribute(this.positions, 3)
    this.posAttr.setUsage(THREE.DynamicDrawUsage)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', this.posAttr)
    this.geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    // seed vertex positions (camera assumed at origin for frame 0; the first
    // update() re-anchors them to the live camera before the first real render)
    for (let i = 0; i < COUNT; i++) this.writeDrop(i, 0, 0)

    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: BASE_OPACITY,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: true,
      toneMapped: false,
    })

    const lines = new THREE.LineSegments(this.geo, this.mat)
    lines.frustumCulled = false // the column always wraps the camera
    lines.renderOrder = 2
    this.group.add(lines)

    // ----- ripple pool -----------------------------------------------------
    this.rippleGeo = new THREE.RingGeometry(0.82, 1.0, 28)
    this.rippleGeo.rotateX(-Math.PI / 2) // lay flat on the floor
    const rippleColor = base.clone()
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: rippleColor, // setValues copies into each material's own Color
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        fog: true,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(this.rippleGeo, mat)
      mesh.position.y = RIPPLE_Y
      mesh.scale.set(RIPPLE_R0, 1, RIPPLE_R0)
      mesh.visible = false
      mesh.frustumCulled = false
      mesh.renderOrder = 2
      this.group.add(mesh)
      this.ripples.push({ mesh, mat, age: 0, active: false, max: 3.5 })
    }
  }

  // write a drop's two vertices: faint top, bright bottom along the slant
  private writeDrop(i: number, camX: number, camZ: number): void {
    const topX = camX + this.ox[i]
    const topY = this.dy[i]
    const topZ = camZ + this.oz[i]
    const l = this.len[i]
    const ci = i * 6
    const p = this.positions
    p[ci + 0] = topX
    p[ci + 1] = topY
    p[ci + 2] = topZ
    p[ci + 3] = topX + this.wdx * l
    p[ci + 4] = topY + this.wdy * l
    p[ci + 5] = topZ + this.wdz * l
  }

  update(ctx: FeatureContext): void {
    const dt = ctx.dt * ctx.motion
    const cam = ctx.camera.position
    const camX = cam.x
    const camZ = cam.z
    const audio = ctx.audio
    const fallMul = 1 + audio * 0.5
    const driftX = DRIFT_X * dt
    const driftZ = DRIFT_Z * dt

    for (let i = 0; i < COUNT; i++) {
      this.dy[i] -= this.spd[i] * dt * fallMul

      // gentle wind drift, wrapped within the column so it never runs out
      let ox = this.ox[i] + driftX
      if (ox > R) ox -= 2 * R
      else if (ox < -R) ox += 2 * R
      this.ox[i] = ox
      let oz = this.oz[i] + driftZ
      if (oz > R) oz -= 2 * R
      else if (oz < -R) oz += 2 * R
      this.oz[i] = oz

      // recycle to the top once the streak head clears the floor
      if (this.dy[i] <= FLOOR_Y) {
        this.dy[i] = TOP_Y + Math.random() * 4
        this.ox[i] = (Math.random() * 2 - 1) * R
        this.oz[i] = (Math.random() * 2 - 1) * R
      }

      this.writeDrop(i, camX, camZ)
    }
    this.posAttr.needsUpdate = true

    // brightness breathes faintly with the bass
    this.mat.opacity = Math.min(0.85, BASE_OPACITY * (1 + audio * 0.5))

    // ----- ripples: spawn on a cadence, then grow + fade -------------------
    this.spawnTimer -= dt
    const spawnEvery = RIPPLE_SPAWN / (1 + audio * 0.8)
    while (this.spawnTimer <= 0) {
      this.spawnTimer += spawnEvery
      this.spawnRipple(camX, camZ)
    }

    const rippleGain = 0.5 * (1 + audio * 0.4)
    for (const r of this.ripples) {
      if (!r.active) continue
      r.age += dt
      const f = r.age / RIPPLE_LIFE
      if (f >= 1) {
        r.active = false
        r.mesh.visible = false
        r.mat.opacity = 0
        continue
      }
      const radius = RIPPLE_R0 + (r.max - RIPPLE_R0) * f
      r.mesh.scale.set(radius, 1, radius)
      r.mat.opacity = (1 - f) * rippleGain
    }
  }

  private spawnRipple(camX: number, camZ: number): void {
    let slot = -1
    for (let i = 0; i < this.ripples.length; i++) {
      if (!this.ripples[i].active) {
        slot = i
        break
      }
    }
    if (slot < 0) return // pool exhausted — drop this landing

    const r = this.ripples[slot]
    const ang = Math.random() * Math.PI * 2
    const rad = Math.sqrt(Math.random()) * RIPPLE_FIELD // uniform over the disc
    r.mesh.position.set(camX + Math.cos(ang) * rad, RIPPLE_Y, camZ + Math.sin(ang) * rad)
    r.max = 3.2 + Math.random() * 2.2
    r.age = 0
    r.active = true
    r.mesh.visible = true
    r.mesh.scale.set(RIPPLE_R0, 1, RIPPLE_R0)
  }

  dispose(): void {
    this.geo.dispose()
    this.mat.dispose()
    this.rippleGeo.dispose()
    for (const r of this.ripples) r.mat.dispose()
    this.ripples.length = 0
    this.group.clear()
  }
}
