import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// FoldedCity — the headline INCEPTION beat: a whole city that FOLDS UP and
// curves OVER the viewer. A great VAULT of skyscrapers arcs from one twilight
// horizon, UP and over the ZENITH directly above the plaza, and back down to
// the opposite horizon — so the world literally bends onto itself overhead.
//
// Geometry: the vault is the inner face of a HALF-CYLINDER whose axis is
// horizontal through the origin (along world X), radius R. A field of towers is
// laid out as a grid over (arc-angle phi  ×  axis-position x). For a surface
// point P = (x, R·sinφ, R·cosφ) the tower is mounted ON that inner face and its
// up-axis points INWARD toward the cylinder axis — n = (0, -sinφ, -cosφ). So at
// the ZENITH (φ≈π/2) towers hang straight DOWN like an upside-down city ceiling;
// sweeping toward either horizon they tilt back toward upright. The continuous
// inward orientation is what makes the fold read as one bending city, not a ring.
//
// One shared unit BoxGeometry drives the whole vault via ONE InstancedMesh
// (~1 draw call): a dark glass body with a shared emissive blue-window-grid
// CanvasTexture (cool reflective glass, some lit phosphor/hologram, some dark)
// tiled by RepeatWrapping, per-instance tint. A second instanced mesh adds a
// faint additive edge-glow rim so each folded silhouette catches the bloom.
//
// update(): a VERY slow drift/roll of the whole vault (it hangs almost still,
// folded over you) + a subtle audio window-brightness lift, all × ctx.motion.
// No per-frame allocation — only a couple of material scalars + group transforms.
// ============================================================================

const ROWS = 7 // bands swept across the arc (horizon → zenith → horizon)
const COLS = 10 // tower columns spread along the cylinder axis (X)
const SKIP_CHANCE = 0.08 // gaps in the grid so it doesn't read as a perfect lattice

const R = 80 // arc radius: zenith city sits ~80 above the plaza
const X_HALF = 56 // half-extent of the vault along its axis
const PHI_MIN = -0.1 // sweep just past the horizons so the ends dive into fog
const PHI_MAX = Math.PI + 0.1

export class FoldedCity implements SceneFeature {
  readonly group: THREE.Group

  private readonly bodies: THREE.InstancedMesh
  private readonly frames: THREE.InstancedMesh
  private readonly bodyMat: THREE.MeshBasicMaterial
  private readonly frameMat: THREE.MeshBasicMaterial
  private readonly frameBaseOpacity: number

  private readonly disposables: Array<{ dispose(): void }> = []

  private anim = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'FoldedCity'
    const white = new THREE.Color(1, 1, 1)

    // ----- per-instance accumulators (construction-time only) ----------------
    const px: number[] = []
    const py: number[] = []
    const pz: number[] = []
    const qx: number[] = []
    const qy: number[] = []
    const qz: number[] = []
    const qw: number[] = []
    const sx: number[] = []
    const sy: number[] = []
    const sz: number[] = []
    const tr: number[] = []
    const tg: number[] = []
    const tb: number[] = []

    // reusable scratch (constructor only)
    const xAxis = new THREE.Vector3(1, 0, 0) // box width → world X (along the axis)
    const yAxis = new THREE.Vector3() // box height → inward normal n
    const zAxis = new THREE.Vector3() // box depth → arc tangent (a × n)
    const basis = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const qTilt = new THREE.Quaternion()
    const tiltAxis = new THREE.Vector3()
    const center = new THREE.Vector3()
    const tint = new THREE.Color()

    // a tower's body tint: a dark cool cast, varied per tower so the folded city
    // doesn't read as one flat brightness; leans blue/teal (the inner-world look).
    const towerTint = (out: THREE.Color): THREE.Color => {
      const cool = Math.random() < 0.5 ? palette.hologram : palette.phosphor
      out.copy(white).lerp(cool, 0.12 + Math.random() * 0.26)
      return out.multiplyScalar(0.58 + Math.random() * 0.34)
    }

    const phiSpan = PHI_MAX - PHI_MIN
    const phiCell = phiSpan / ROWS
    const xSpan = X_HALF * 2
    const xCell = xSpan / COLS

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (Math.random() < SKIP_CHANCE) continue

        // jittered grid position over (arc-angle, axis-offset)
        const phi = PHI_MIN + (r + 0.5 + (Math.random() - 0.5) * 0.7) * phiCell
        const xPos = -X_HALF + (c + 0.5 + (Math.random() - 0.5) * 0.7) * xCell

        const sinP = Math.sin(phi)
        const cosP = Math.cos(phi)

        // surface point on the inner face + inward normal toward the axis
        // n = (0, -sinφ, -cosφ) is already unit-length (sin²+cos² = 1)
        yAxis.set(0, -sinP, -cosP)
        zAxis.crossVectors(xAxis, yAxis) // = arc tangent, unit & orthogonal
        basis.makeBasis(xAxis, yAxis, zAxis)
        quat.setFromRotationMatrix(basis)

        // a touch of "impossible angle" lean so the vault feels hand-stacked
        tiltAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        if (tiltAxis.lengthSq() < 1e-4) tiltAxis.set(0, 0, 1)
        tiltAxis.normalize()
        qTilt.setFromAxisAngle(tiltAxis, (Math.random() - 0.5) * 0.16)
        quat.premultiply(qTilt)

        const w = 4 + Math.random() * 4
        const d = 4 + Math.random() * 4
        const h = 10 + Math.random() * 15 // inner tip stays well clear of the plaza

        // base sits on the surface; box extends inward by h, so centre = P + n·h/2
        center.set(xPos, R * sinP, R * cosP).addScaledVector(yAxis, h * 0.5)

        towerTint(tint)
        px.push(center.x)
        py.push(center.y)
        pz.push(center.z)
        qx.push(quat.x)
        qy.push(quat.y)
        qz.push(quat.z)
        qw.push(quat.w)
        sx.push(w)
        sy.push(h)
        sz.push(d)
        tr.push(tint.r)
        tg.push(tint.g)
        tb.push(tint.b)
      }
    }

    const count = px.length

    // ----- shared geometry + textures ---------------------------------------
    const boxGeo = new THREE.BoxGeometry(1, 1, 1)
    const windowTex = this.makeWindowTexture(palette, white)
    const frameTex = this.makeFrameTexture()

    this.bodyMat = new THREE.MeshBasicMaterial({ color: white.clone(), map: windowTex, fog: true })
    this.bodies = new THREE.InstancedMesh(boxGeo, this.bodyMat, count)
    this.bodies.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    this.bodies.frustumCulled = false

    const frameTint = palette.hologram.clone().lerp(palette.phosphor, 0.35).lerp(white, 0.1)
    this.frameBaseOpacity = 0.42
    this.frameMat = new THREE.MeshBasicMaterial({
      color: frameTint,
      map: frameTex,
      transparent: true,
      opacity: this.frameBaseOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
    })
    this.frames = new THREE.InstancedMesh(boxGeo, this.frameMat, count)
    this.frames.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    this.frames.frustumCulled = false

    // build the instance matrices + per-body tint
    const mtx = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const oq = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const instCol = new THREE.Color()
    for (let i = 0; i < count; i++) {
      pos.set(px[i], py[i], pz[i])
      oq.set(qx[i], qy[i], qz[i], qw[i])
      scl.set(sx[i], sy[i], sz[i])
      mtx.compose(pos, oq, scl)
      this.bodies.setMatrixAt(i, mtx)
      instCol.setRGB(tr[i], tg[i], tb[i])
      this.bodies.setColorAt(i, instCol)
      // frame: same transform grown a hair so its glowing edge rims the body
      scl.set(sx[i] + 0.2, sy[i] + 0.2, sz[i] + 0.2)
      mtx.compose(pos, oq, scl)
      this.frames.setMatrixAt(i, mtx)
    }
    this.bodies.instanceMatrix.needsUpdate = true
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true
    this.frames.instanceMatrix.needsUpdate = true

    this.group.add(this.bodies)
    this.group.add(this.frames)
    this.disposables.push(boxGeo, windowTex, frameTex, this.bodyMat, this.frameMat, this.bodies, this.frames)
  }

  // dark twilight-blue facade with a grid of cool reflective-blue glass windows,
  // a few lit brighter (phosphor/hologram), a few dark. Stays dark so only the
  // windows glow under bloom. Tiled across the box faces via RepeatWrapping.
  private makeWindowTexture(palette: ScenePalette, white: THREE.Color): THREE.CanvasTexture {
    const W = 128
    const H = 256
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')

    // body base: just above the void with a cool blue cast so the silhouette
    // reads as dark glass through the twilight fog
    const baseDark = palette.voidColor.clone().lerp(palette.hologram, 0.2)
    ctx.fillStyle = baseDark.getStyle(THREE.SRGBColorSpace)
    ctx.fillRect(0, 0, W, H)

    const teal = palette.hologram.clone().lerp(palette.phosphor, 0.45)
    const litCool = palette.phosphor.clone().lerp(white, 0.5)
    const cols = 4
    const rows = 8
    const cw = W / cols
    const ch = H / rows
    const gap = 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = Math.random()
        if (k < 0.16) continue // dark window — stays the dark glass base
        let col: THREE.Color
        if (k < 0.66) {
          // cool reflective-blue glass (the dominant look)
          col = (Math.random() < 0.55 ? teal : palette.hologram)
            .clone()
            .multiplyScalar(0.13 + Math.random() * 0.16)
        } else if (k < 0.88) {
          // medium-lit window
          col = (Math.random() < 0.6 ? palette.hologram : palette.phosphor)
            .clone()
            .multiplyScalar(0.4 + Math.random() * 0.25)
        } else {
          // bright-lit window (rare brighter ones bloom)
          col = litCool.clone().multiplyScalar(0.9 + Math.random() * 0.3)
        }
        ctx.fillStyle = col.getStyle(THREE.SRGBColorSpace)
        ctx.fillRect(c * cw + gap, r * ch + gap, cw - gap * 2, ch - gap * 2)
      }
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(2, 4)
    return tex
  }

  // glowing edge frame: transparent centre, bright soft border. One per box face
  // (no tiling) so each folded box catches a faint additive rim/edge glow.
  private makeFrameTexture(): THREE.CanvasTexture {
    const S = 64
    const canvas = document.createElement('canvas')
    canvas.width = S
    canvas.height = S
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')

    ctx.clearRect(0, 0, S, S)
    // stack a few strokes from the edge inward with a fading alpha for a soft glow
    const steps = 6
    for (let i = 0; i < steps; i++) {
      const a = (1 - i / steps) * 0.85
      const inset = 0.5 + i
      ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
      ctx.lineWidth = 1
      ctx.strokeRect(inset, inset, S - inset * 2, S - inset * 2)
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  update(ctx: FeatureContext): void {
    const motion = ctx.motion
    this.anim += ctx.dt * motion
    const a = this.anim

    // the folded vault hangs almost still: a super-slow roll about its own axis
    // (X) so the fold barely turns overhead, plus a faint yaw drift and breath.
    this.group.rotation.x = Math.sin(a * 0.013) * 0.02
    this.group.rotation.y = a * 0.003
    this.group.position.y = Math.sin(a * 0.04) * 0.5

    // subtle audio brightness lift on the glass windows + rim-glow opacity
    this.bodyMat.color.setScalar(1 + ctx.audio * 0.4)
    this.frameMat.opacity =
      this.frameBaseOpacity * (0.8 + 0.2 * Math.sin(a * 0.22) + ctx.audio * 0.6)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.group.clear()
  }
}
