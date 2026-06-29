import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// SidewaysCity — the SIGNATURE Bleach "inner world" image bled into the Wired:
// glass blue-windowed SKYSCRAPERS lying SIDEWAYS at impossible angles, floating
// in the twilight sky around and ABOVE the upright corporate plaza. Where the
// two realities overlap you get wrong-gravity vertigo — towers that should rise
// instead hang horizontal overhead, receding into the twilight-blue fog.
//
// Each skyscraper is a tall thin box (a few get a second, narrower stacked
// "annex" at one end for massing variety) whose long +Y axis is TIPPED ~90°
// about a random horizontal axis (plus extra random tilt) so it reads as a
// sideways tower. Centres sit in a wide sky band around the plaza
// (radius ~38..115, y ~8..90) — never in the clear central plaza; long towers
// are length-capped by their radius so they can't stab inward across the plaza.
//
// EVERYTHING is ONE shared unit BoxGeometry driven by TWO InstancedMeshes
// (~2 draw calls total spanning the whole sky):
//   • bodies — a shared dark twilight-blue CanvasTexture FACADE: a grid of cool
//     reflective-blue glass windows, a few lit brighter phosphor/hologram, a few
//     dark; tiled via RepeatWrapping. The body stays dark so only the windows
//     glow under the bloom pass. Per-instance instanceColor varies each tower's
//     brightness/cool-cast.
//   • frames — the SAME boxes scaled a hair larger with a shared additive
//     edge-frame CanvasTexture (glowing border, transparent centre) so each
//     sideways silhouette catches a faint twilight-blue rim/edge glow.
//
// update(): a VERY slow continuous drift/rotation of the whole group (they hang
// almost still in the sky) + a subtle audio brightness/opacity lift. No
// per-frame allocation — only a few material scalars and group transforms.
// ============================================================================

const TAU = Math.PI * 2
const TOWER_COUNT = 46
const ANNEX_CHANCE = 0.4

const R_MIN = 38
const R_MAX = 115
const Y_MIN = 8
const Y_MAX = 90

export class SidewaysCity implements SceneFeature {
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
    this.group.name = 'SidewaysCity'
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

    const emitBox = (
      pos: THREE.Vector3,
      quat: THREE.Quaternion,
      w: number,
      h: number,
      d: number,
      tint: THREE.Color,
    ): void => {
      px.push(pos.x)
      py.push(pos.y)
      pz.push(pos.z)
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

    // reusable scratch (constructor only)
    const upAxis = new THREE.Vector3(0, 1, 0)
    const tipAxis = new THREE.Vector3()
    const tiltAxis = new THREE.Vector3()
    const qTip = new THREE.Quaternion()
    const qTilt = new THREE.Quaternion()
    const qRoll = new THREE.Quaternion()
    const qFinal = new THREE.Quaternion()
    const longDir = new THREE.Vector3()
    const center = new THREE.Vector3()
    const annexPos = new THREE.Vector3()
    const tint = new THREE.Color()

    // a tower's body tint: a dark-ish cool cast, varied per tower so the sky-city
    // doesn't read as one flat brightness; leans blue/teal (the inner-world look).
    const towerTint = (out: THREE.Color): THREE.Color => {
      const cool = Math.random() < 0.5 ? palette.hologram : palette.phosphor
      out.copy(white).lerp(cool, 0.12 + Math.random() * 0.26)
      return out.multiplyScalar(0.6 + Math.random() * 0.34)
    }

    const sector = TAU / TOWER_COUNT
    for (let i = 0; i < TOWER_COUNT; i++) {
      // even 360° coverage with jitter so it never reads as a perfect ring
      const ang = (i + 0.5 + (Math.random() - 0.5) * 0.95) * sector
      let radius = R_MIN + Math.random() * (R_MAX - R_MIN)
      const y = Y_MIN + Math.random() * (Y_MAX - Y_MIN)
      // keep the low-altitude ones far out so nothing hangs across the plaza floor
      if (y < 16 && radius < 60) radius = 60
      center.set(Math.cos(ang) * radius, y, Math.sin(ang) * radius)

      const w = 3 + Math.random() * 4
      const d = 3 + Math.random() * 4
      // long axis length, capped by radius so a flat tower can't stab the plaza
      const cap = Math.max(22, 2 * (radius - 14))
      const len = Math.min(24 + Math.random() * 48, cap)

      // ---- orientation: tip the upright tower ~90° onto its side, + tilt/roll
      const tipAz = Math.random() * TAU
      tipAxis.set(Math.cos(tipAz), 0, Math.sin(tipAz))
      qTip.setFromAxisAngle(tipAxis, Math.PI / 2 + (Math.random() - 0.5) * 0.9)
      // a little extra "impossible angle" tilt about another horizontal axis
      const tiltAz = Math.random() * TAU
      tiltAxis.set(Math.cos(tiltAz), 0, Math.sin(tiltAz))
      qTilt.setFromAxisAngle(tiltAxis, (Math.random() - 0.5) * 0.7)
      // roll about the original long axis so window faces vary
      qRoll.setFromAxisAngle(upAxis, Math.random() * TAU)
      qFinal.copy(qTilt).multiply(qTip).multiply(qRoll)

      towerTint(tint)
      emitBox(center, qFinal, w, len, d, tint)

      // optional narrower stacked annex at one end of the long axis (setback)
      if (Math.random() < ANNEX_CHANCE) {
        longDir.copy(upAxis).applyQuaternion(qFinal)
        const len2 = len * (0.25 + Math.random() * 0.2)
        const off = len * 0.5 + len2 * 0.5 - 0.5
        annexPos.copy(center).addScaledVector(longDir, off)
        emitBox(
          annexPos,
          qFinal,
          w * 0.7,
          len2,
          d * 0.7,
          tint.clone().multiplyScalar(0.85),
        )
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

    const frameTint = palette.hologram.clone().lerp(palette.phosphor, 0.35).lerp(white, 0.12)
    this.frameBaseOpacity = 0.5
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
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const instCol = new THREE.Color()
    for (let i = 0; i < count; i++) {
      pos.set(px[i], py[i], pz[i])
      quat.set(qx[i], qy[i], qz[i], qw[i])
      scl.set(sx[i], sy[i], sz[i])
      mtx.compose(pos, quat, scl)
      this.bodies.setMatrixAt(i, mtx)
      instCol.setRGB(tr[i], tg[i], tb[i])
      this.bodies.setColorAt(i, instCol)
      // frame: same transform grown a hair so its glowing edge rims the body
      scl.set(sx[i] + 0.18, sy[i] + 0.18, sz[i] + 0.18)
      mtx.compose(pos, quat, scl)
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
        if (k < 0.14) continue // dark window — stays the dark glass base
        let col: THREE.Color
        if (k < 0.66) {
          // cool reflective-blue glass (the dominant look)
          col = (Math.random() < 0.55 ? teal : palette.hologram)
            .clone()
            .multiplyScalar(0.14 + Math.random() * 0.16)
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
    tex.repeat.set(2, 5)
    return tex
  }

  // glowing edge frame: transparent centre, bright soft border. One per box face
  // (no tiling) so each sideways box catches a faint additive rim/edge glow.
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
      const a = (1 - i / steps) * 0.9
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

    // the sky-city hangs almost still: a super-slow continuous yaw drift plus a
    // faint tilt/bob so it breathes without ever reading as spinning
    this.group.rotation.y = a * 0.0035
    this.group.rotation.z = Math.sin(a * 0.02) * 0.012
    this.group.position.y = Math.sin(a * 0.045) * 0.4

    // subtle audio brightness lift on the glass windows + rim-glow opacity
    this.bodyMat.color.setScalar(1 + ctx.audio * 0.4)
    this.frameMat.opacity =
      this.frameBaseOpacity * (0.82 + 0.18 * Math.sin(a * 0.25) + ctx.audio * 0.6)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.disposables.length = 0
    this.group.clear()
  }
}
