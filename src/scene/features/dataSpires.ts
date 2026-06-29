import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// DataSpires — a receding "city of data" skyline backdrop.
//
// A wide band of dark instanced box towers sits far away (z ~ [-38,-106]) and
// flanks the sides, bases low and fading into the FogExp2 horizon. Each tower
// carries a handful of tiny additive blinking lights (one shared Points cloud)
// in phosphor/hologram, with sparing tachibana/warning accents and the odd
// pulsing top beacon. The towers themselves stay essentially static; update()
// drives the light blinking + a very slow parallax sway of the whole skyline,
// and lets the audio bass gently lift overall light brightness.
//
// Perf: ONE BoxGeometry + ONE MeshBasicMaterial for all towers (InstancedMesh,
// static matrices), ONE Points cloud for every light. Per frame we only rewrite
// a small Float32 colour buffer (no allocation) and nudge the group transform.
// ============================================================================

const TAU = Math.PI * 2
const TOWER_COUNT = 58
const GROUND = -10 // base y the towers rise from
const X_SPREAD = 78

// light "kinds"
const KIND_STEADY = 0 // gentle breathing, always lit
const KIND_BLINK = 1 // hard on/off twinkle
const KIND_BEACON = 2 // slow strong throb (tower-top warning/amber)

export class DataSpires implements SceneFeature {
  readonly group: THREE.Group

  private readonly towers: THREE.InstancedMesh
  private readonly towerGeo: THREE.BoxGeometry
  private readonly towerMat: THREE.MeshBasicMaterial

  private readonly lights: THREE.Points
  private readonly lightGeo: THREE.BufferGeometry
  private readonly lightMat: THREE.PointsMaterial
  private readonly dotTex: THREE.CanvasTexture

  // per-light animation state (all parallel, length = count)
  private readonly count: number
  private readonly baseColors: Float32Array // immutable base rgb
  private readonly colorArr: Float32Array // live attribute buffer we rewrite
  private readonly phase: Float32Array
  private readonly speed: Float32Array
  private readonly bright: Float32Array
  private readonly kind: Uint8Array
  private readonly colorAttr: THREE.BufferAttribute

  private anim = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()

    // --- towers -------------------------------------------------------------
    // Dim base colour: just above the void so silhouettes read but stay well
    // under the bloom threshold (only the lights are meant to glow).
    const towerColor = palette.voidColor.clone().lerp(palette.hologram, 0.18)
    this.towerGeo = new THREE.BoxGeometry(1, 1, 1)
    this.towerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 1, 1), // multiplied by per-instance colour
      fog: true,
    })
    this.towers = new THREE.InstancedMesh(this.towerGeo, this.towerMat, TOWER_COUNT)
    this.towers.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    this.towers.frustumCulled = false // one draw call; spans a wide arc

    const positions: number[] = []
    const baseCols: number[] = []
    const phases: number[] = []
    const speeds: number[] = []
    const brights: number[] = []
    const kinds: number[] = []

    const pushLight = (
      x: number,
      y: number,
      z: number,
      col: THREE.Color,
      b: number,
      ph: number,
      sp: number,
      k: number,
    ): void => {
      positions.push(x, y, z)
      baseCols.push(col.r, col.g, col.b)
      phases.push(ph)
      speeds.push(sp)
      brights.push(b)
      kinds.push(k)
    }

    const pickColor = (): THREE.Color => {
      const r = Math.random()
      if (r < 0.55) return palette.phosphor
      if (r < 0.85) return palette.hologram
      if (r < 0.95) return palette.tachibana
      return palette.warning
    }

    // temps reused while composing instance matrices (construction-time only)
    const mtx = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const euler = new THREE.Euler()
    const instCol = new THREE.Color()

    for (let i = 0; i < TOWER_COUNT; i++) {
      const cx = (Math.random() * 2 - 1) * X_SPREAD
      // wide far band; edges bow further away for a subtle panoramic curve.
      const cz = -38 - Math.random() * 54 - ((cx * cx) / (X_SPREAD * X_SPREAD)) * 14

      let h = 7 + Math.random() * 16
      if (cz < -68) h += Math.random() * 16 // far towers taller -> read over near ones
      const w = 2.5 + Math.random() * 4
      const d = 2.5 + Math.random() * 4
      const yaw = (Math.random() * 2 - 1) * 0.2
      const base = GROUND + (Math.random() - 0.5) * 2
      const cy = base + h / 2

      pos.set(cx, cy, cz)
      euler.set(0, yaw, 0)
      quat.setFromEuler(euler)
      scl.set(w, h, d)
      mtx.compose(pos, quat, scl)
      this.towers.setMatrixAt(i, mtx)

      const variance = 0.65 + Math.random() * 0.45
      instCol.copy(towerColor).multiplyScalar(variance)
      this.towers.setColorAt(i, instCol)

      // --- lights for this tower -------------------------------------------
      const cosA = Math.cos(yaw)
      const sinA = Math.sin(yaw)
      const nL = 2 + Math.floor(Math.random() * 4)
      for (let l = 0; l < nL; l++) {
        // pick a face: front (+z) most often, then the two sides.
        let lx: number
        let lz: number
        const face = Math.random()
        if (face < 0.6) {
          lx = (Math.random() * 2 - 1) * w * 0.4
          lz = d / 2 + 0.05
        } else if (face < 0.8) {
          lx = w / 2 + 0.05
          lz = (Math.random() * 2 - 1) * d * 0.4
        } else {
          lx = -w / 2 - 0.05
          lz = (Math.random() * 2 - 1) * d * 0.4
        }
        // upper-biased vertical placement within the tower height
        const ly = (Math.random() * 0.8 - 0.3) * h
        const ox = lx * cosA + lz * sinA
        const oz = -lx * sinA + lz * cosA

        const isBlink = Math.random() < 0.35
        const k = isBlink ? KIND_BLINK : KIND_STEADY
        const sp = isBlink ? 1.2 + Math.random() * 2.4 : 0.4 + Math.random() * 0.8
        pushLight(
          cx + ox,
          cy + ly,
          cz + oz,
          pickColor(),
          0.55 + Math.random() * 0.4,
          Math.random() * TAU,
          sp,
          k,
        )
      }

      // occasional pulsing beacon on top of the taller towers (sparing accent)
      if (h > 24 && Math.random() < 0.7) {
        const beaconCol = Math.random() < 0.5 ? palette.warning : palette.tachibana
        pushLight(cx, cy + h / 2 - 0.15, cz, beaconCol, 0.95, Math.random() * TAU, 1.4 + Math.random(), KIND_BEACON)
      }
    }

    this.towers.instanceMatrix.needsUpdate = true
    if (this.towers.instanceColor) this.towers.instanceColor.needsUpdate = true
    this.group.add(this.towers)

    // --- lights cloud -------------------------------------------------------
    this.count = phases.length
    this.baseColors = Float32Array.from(baseCols)
    this.colorArr = new Float32Array(this.baseColors) // start lit at base colour
    this.phase = Float32Array.from(phases)
    this.speed = Float32Array.from(speeds)
    this.bright = Float32Array.from(brights)
    this.kind = Uint8Array.from(kinds)

    this.dotTex = this.makeDotTexture()
    this.lightGeo = new THREE.BufferGeometry()
    this.lightGeo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
    this.colorAttr = new THREE.BufferAttribute(this.colorArr, 3)
    this.colorAttr.setUsage(THREE.DynamicDrawUsage)
    this.lightGeo.setAttribute('color', this.colorAttr)

    this.lightMat = new THREE.PointsMaterial({
      size: 0.8,
      map: this.dotTex,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    this.lights = new THREE.Points(this.lightGeo, this.lightMat)
    this.lights.frustumCulled = false
    this.group.add(this.lights)
  }

  private makeDotTexture(): THREE.CanvasTexture {
    const s = 32
    const canvas = document.createElement('canvas')
    canvas.width = s
    canvas.height = s
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  update(ctx: FeatureContext): void {
    const motion = ctx.motion
    this.anim += ctx.dt * motion
    const a = this.anim

    // very slow parallax sway of the whole skyline (stays near-static)
    this.group.rotation.y = Math.sin(a * 0.05) * 0.012
    this.group.position.x = Math.sin(a * 0.031) * 0.8
    this.group.position.y = Math.sin(a * 0.043) * 0.3

    // audio bass gently lifts overall light brightness
    const audioGain = 1 + ctx.audio * 0.8
    const flickP = 0.012 * motion

    const base = this.baseColors
    const col = this.colorArr
    for (let i = 0; i < this.count; i++) {
      const ph = this.phase[i]
      const sp = this.speed[i]
      const k = this.kind[i]

      let b: number
      if (k === KIND_BLINK) {
        b = Math.sin(a * sp + ph) > 0.15 ? 1.0 : 0.06
      } else if (k === KIND_BEACON) {
        b = 0.5 + 0.5 * Math.abs(Math.sin(a * sp * 0.5 + ph))
      } else {
        b = 0.62 + 0.38 * Math.sin(a * sp + ph)
      }
      b *= this.bright[i] * audioGain
      if (Math.random() < flickP) b *= 0.22 // sparse occasional flicker
      if (b < 0) b = 0

      const j = i * 3
      col[j] = base[j] * b
      col[j + 1] = base[j + 1] * b
      col[j + 2] = base[j + 2] * b
    }
    this.colorAttr.needsUpdate = true
  }

  dispose(): void {
    this.towerGeo.dispose()
    this.towerMat.dispose()
    this.lightGeo.dispose()
    this.lightMat.dispose()
    this.dotTex.dispose()
  }
}
