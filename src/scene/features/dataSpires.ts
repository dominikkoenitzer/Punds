import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// DataSpires — the CORPORATE PLAZA CANYON that ENCLOSES the camera.
//
// The camera stands in an open plaza at the ORIGIN. This feature RINGS the
// origin with the downtown skyline on ALL sides (full 360°) so the viewer looks
// UP an urban canyon of corp towers. Towers are seated in THREE concentric
// depth layers around a CLEAR central plaza (nothing within radius ~18):
//   • NEAR ring  (r ~24..37)  — the close canyon walls, clearly readable
//   • MID  ring  (r ~37..56)  — taller massing rising behind the near wall
//   • FAR  ring  (r ~56..80)  — the tallest backdrop, fading into FogExp2
// 3-5 HERO corp MEGASTRUCTURES rise far above the rest (heights ~85-96) at
// evenly-spaced bearings as plaza landmarks with bright phosphor crowns.
//
// Bases are planted ON the shared ground plane (y = -10) and sink ~1.5-3 units
// below it. Every tower is assembled from 1-3 STACKED, narrowing box tiers
// (setbacks) + an optional thin antenna spire + a bright crown on heroes — and
// ALL of those segments are instances of ONE unit BoxGeometry in ONE
// InstancedMesh (~1 draw call). Towers share a single dark CanvasTexture FACADE
// (a grid of mostly-dim / a-few-bright / a-few-off windows, phosphor + hologram
// tint, rare tachibana) tiled down the height via RepeatWrapping; it stays dark
// so only lit windows + the additive light cloud glow under the bloom pass.
//
// A single Points cloud carries every light: scattered facade windows that
// breathe/blink + throbbing/blinking BEACONS on tower tops and hero crowns
// (tachibana amber + warning red accents). Two faint additive CYLINDRICAL
// horizon-haze rings sit beyond the furthest towers to seat the skyline against
// the void and backlight the silhouettes all the way around.
//
// update(): blink/breathe the lights, lift overall brightness with audio bass,
// and apply a very slow sway of the whole ring. Towers are static. Per frame we
// only rewrite one small Float32 colour buffer (no allocation), nudge a couple
// transforms, and tweak a handful of material scalars. Rates × ctx.motion.
// ============================================================================

const TAU = Math.PI * 2
const GROUND = -10 // shared floor: tower bases sit on this and sink below it
const HERO_TOWERS = 5

// light "kinds"
const KIND_STEADY = 0 // gentle breathing, always lit (facade windows / crown)
const KIND_BLINK = 1 // hard on/off twinkle
const KIND_BEACON = 2 // slow strong throb (tower-top warning / amber)

interface RingLayer {
  n: number
  rMin: number
  rMax: number
  hMin: number
  hMax: number
  sMin: number
  sMax: number
}

export class DataSpires implements SceneFeature {
  readonly group: THREE.Group

  private readonly towers: THREE.InstancedMesh
  private readonly towerMat: THREE.MeshBasicMaterial

  private readonly lightMat: THREE.PointsMaterial
  private readonly hazeMats: THREE.MeshBasicMaterial[] = []
  private readonly hazeBaseOpacity: number[] = []

  // per-light animation state (all parallel, length = count)
  private readonly count: number
  private readonly baseColors: Float32Array // immutable base rgb
  private readonly colorArr: Float32Array // live attribute buffer we rewrite
  private readonly phase: Float32Array
  private readonly speed: Float32Array
  private readonly bright: Float32Array
  private readonly kind: Uint8Array
  private readonly colorAttr: THREE.BufferAttribute

  // everything that owns GPU memory, freed in dispose()
  private readonly disposables: Array<{ dispose(): void }> = []

  private anim = 0

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    const white = new THREE.Color(1, 1, 1)

    // ----- segment + light accumulators (construction-time only) -------------
    const sx: number[] = []
    const sy: number[] = []
    const sz: number[] = []
    const sw: number[] = []
    const sh: number[] = []
    const sd: number[] = []
    const syaw: number[] = []
    const sr: number[] = []
    const sg: number[] = []
    const sb: number[] = []

    const lpos: number[] = []
    const lcol: number[] = []
    const lphase: number[] = []
    const lspeed: number[] = []
    const lbright: number[] = []
    const lkind: number[] = []

    const emitSeg = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      yaw: number,
      tint: THREE.Color,
    ): void => {
      sx.push(x)
      sy.push(y)
      sz.push(z)
      sw.push(w)
      sh.push(h)
      sd.push(d)
      syaw.push(yaw)
      sr.push(tint.r)
      sg.push(tint.g)
      sb.push(tint.b)
    }

    const emitLight = (
      x: number,
      y: number,
      z: number,
      col: THREE.Color,
      b: number,
      sp: number,
      k: number,
    ): void => {
      lpos.push(x, y, z)
      lcol.push(col.r, col.g, col.b)
      lphase.push(Math.random() * TAU)
      lspeed.push(sp)
      lbright.push(b)
      lkind.push(k)
    }

    // tower tints: near-white with a subtle cool cast so windows keep their hue;
    // antennas read as dark struts; hero crowns are pushed bright so they bloom.
    const towerTint = (hero: boolean): THREE.Color => {
      const cool = Math.random() < 0.5 ? palette.phosphor : palette.hologram
      const c = white.clone().lerp(cool, 0.1 + Math.random() * 0.16)
      return c.multiplyScalar(hero ? 0.95 + Math.random() * 0.12 : 0.8 + Math.random() * 0.18)
    }
    const crownTint = palette.phosphor.clone().lerp(white, 0.5).multiplyScalar(1.08)

    const facadeColor = (): THREE.Color =>
      Math.random() < 0.6 ? palette.phosphor : palette.hologram

    // ----- one tower: stacked narrowing tiers (+ antenna, + hero crown) -------
    // `baseYaw` orients the tower toward the plaza so its faces address the camera.
    const emitTower = (
      cx: number,
      cz: number,
      w: number,
      d: number,
      hAbove: number,
      hero: boolean,
      baseYaw: number,
    ): void => {
      const yaw = baseYaw + (Math.random() * 2 - 1) * (hero ? 0.05 : 0.18)
      const cosA = Math.cos(yaw)
      const sinA = Math.sin(yaw)
      const below = hero ? 2.2 + Math.random() * 1.0 : 1.5 + Math.random() * 1.5
      const bottomY = GROUND - below
      const fullH = below + hAbove

      const tiers = hero ? 3 : Math.random() < 0.34 ? 1 : Math.random() < 0.74 ? 2 : 3
      const frac =
        tiers === 3 ? [0.54, 0.3, 0.16] : tiers === 2 ? [0.64, 0.36] : [1]
      const tint = towerTint(hero)

      let yC = bottomY
      let cw = w
      let cd = d
      let lastW = w
      let lastD = d
      for (let ti = 0; ti < tiers; ti++) {
        const th = fullH * frac[ti]
        emitSeg(cx, yC + th / 2, cz, cw, th, cd, yaw, tint)
        yC += th
        lastW = cw
        lastD = cd
        cw *= 0.74
        cd *= 0.74
      }
      let topY = yC // top of the highest tier

      // bright crown cap on heroes
      if (hero) {
        const crownH = 1.0 + Math.random() * 1.2
        emitSeg(cx, topY + crownH / 2, cz, lastW * 1.14, crownH, lastD * 1.14, yaw, crownTint)
        topY += crownH
      }

      // thin antenna / spire
      const wantAntenna = hero || (hAbove > 22 && Math.random() < 0.5)
      let tipY = topY
      if (wantAntenna) {
        const ah = hero ? 6 + Math.random() * 5 : 2.5 + Math.random() * 4
        const aw = Math.max(0.28, lastW * 0.16)
        emitSeg(cx, topY + ah / 2, cz, aw, ah, aw, yaw, tint.clone().multiplyScalar(0.5))
        tipY = topY + ah
      }

      // ----- facade window lights for this tower -----------------------------
      const nL = hero
        ? 8 + Math.floor(Math.random() * 6)
        : Math.min(6, 2 + Math.floor(hAbove / 8))
      for (let l = 0; l < nL; l++) {
        let lx: number
        let lz: number
        const face = Math.random()
        if (face < 0.6) {
          lx = (Math.random() * 2 - 1) * w * 0.42
          lz = d / 2 + 0.05
        } else if (face < 0.8) {
          lx = w / 2 + 0.05
          lz = (Math.random() * 2 - 1) * d * 0.42
        } else {
          lx = -w / 2 - 0.05
          lz = (Math.random() * 2 - 1) * d * 0.42
        }
        const ly = GROUND + hAbove * (0.2 + Math.random() * 0.75)
        const ox = lx * cosA + lz * sinA
        const oz = -lx * sinA + lz * cosA

        const isBlink = Math.random() < 0.34
        emitLight(
          cx + ox,
          ly,
          cz + oz,
          facadeColor(),
          0.5 + Math.random() * 0.4,
          isBlink ? 1.2 + Math.random() * 2.4 : 0.4 + Math.random() * 0.8,
          isBlink ? KIND_BLINK : KIND_STEADY,
        )
      }

      // ----- beacons --------------------------------------------------------
      if (hero) {
        // glowing crown cluster: bright steady phosphor/hologram crown lights
        emitLight(cx, topY + 0.4, cz, white.clone().lerp(palette.phosphor, 0.4), 1.2, 0.5 + Math.random() * 0.4, KIND_STEADY)
        const crownN = 3 + Math.floor(Math.random() * 3)
        for (let c = 0; c < crownN; c++) {
          const a = (c / crownN) * TAU + Math.random() * 0.4
          const rr = lastW * 0.55
          emitLight(
            cx + Math.cos(a) * rr,
            topY + 0.2 + Math.random() * 0.6,
            cz + Math.sin(a) * rr,
            Math.random() < 0.45 ? palette.tachibana : palette.hologram,
            0.9 + Math.random() * 0.3,
            0.8 + Math.random() * 1.2,
            Math.random() < 0.5 ? KIND_BEACON : KIND_STEADY,
          )
        }
        // red aircraft-warning blink on the spire tip
        emitLight(cx, tipY, cz, palette.warning, 1.05, 0.9 + Math.random() * 0.6, KIND_BLINK)
      } else if (hAbove > 20 && Math.random() < 0.62) {
        const warm = Math.random() < 0.5
        emitLight(
          cx,
          tipY + 0.2,
          cz,
          warm ? palette.tachibana : palette.warning,
          0.95,
          1.2 + Math.random(),
          warm ? KIND_BEACON : KIND_BLINK,
        )
      }
    }

    // ----- generate the city: concentric rings enclosing the plaza ----------
    // Each layer lays its towers in stratified angular sectors (with jitter) so
    // the canyon closes a full 360° with even coverage and limited overlap; the
    // radius varies within the layer band so it never reads as a perfect circle.
    const layers: RingLayer[] = [
      { n: 50, rMin: 24, rMax: 37, hMin: 20, hMax: 42, sMin: 3, sMax: 6 },
      { n: 42, rMin: 37, rMax: 56, hMin: 28, hMax: 58, sMin: 4, sMax: 7.5 },
      { n: 30, rMin: 56, rMax: 80, hMin: 40, hMax: 70, sMin: 5, sMax: 9 },
    ]
    let layerIdx = 0
    for (const layer of layers) {
      const sector = TAU / layer.n
      const offset = layerIdx * 0.7 // rotate each ring so layers don't align radially
      for (let i = 0; i < layer.n; i++) {
        const ang = offset + (i + 0.5 + (Math.random() - 0.5) * 0.9) * sector
        const r = layer.rMin + Math.random() * (layer.rMax - layer.rMin)
        const cx = Math.cos(ang) * r
        const cz = Math.sin(ang) * r
        const w = layer.sMin + Math.random() * (layer.sMax - layer.sMin)
        const d = layer.sMin + Math.random() * (layer.sMax - layer.sMin)
        const hAbove = layer.hMin + Math.random() * (layer.hMax - layer.hMin)
        emitTower(cx, cz, w, d, hAbove, false, ang)
      }
      layerIdx++
    }

    // distinctive HERO megastructures, evenly spaced bearings, prominent radius
    const heroStart = Math.random() * TAU
    for (let i = 0; i < HERO_TOWERS; i++) {
      const ang = heroStart + (i / HERO_TOWERS) * TAU + (Math.random() * 2 - 1) * 0.18
      const r = 30 + Math.random() * 16 // 30..46 — landmarks rising over the near wall
      const cx = Math.cos(ang) * r
      const cz = Math.sin(ang) * r
      emitTower(cx, cz, 8 + Math.random() * 4, 8 + Math.random() * 4, 52 + Math.random() * 26, true, ang)
    }

    // ----- build the instanced towers ---------------------------------------
    const segCount = sx.length
    const facadeTex = this.makeFacadeTexture(palette, white)
    const towerGeo = new THREE.BoxGeometry(1, 1, 1)
    this.towerMat = new THREE.MeshBasicMaterial({ color: white.clone(), map: facadeTex, fog: true })
    this.towers = new THREE.InstancedMesh(towerGeo, this.towerMat, segCount)
    this.towers.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    this.towers.frustumCulled = false // one draw call spanning the full ring

    const mtx = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const euler = new THREE.Euler()
    const instCol = new THREE.Color()
    for (let i = 0; i < segCount; i++) {
      pos.set(sx[i], sy[i], sz[i])
      euler.set(0, syaw[i], 0)
      quat.setFromEuler(euler)
      scl.set(sw[i], sh[i], sd[i])
      mtx.compose(pos, quat, scl)
      this.towers.setMatrixAt(i, mtx)
      instCol.setRGB(sr[i], sg[i], sb[i])
      this.towers.setColorAt(i, instCol)
    }
    this.towers.instanceMatrix.needsUpdate = true
    if (this.towers.instanceColor) this.towers.instanceColor.needsUpdate = true
    this.group.add(this.towers)
    this.disposables.push(towerGeo, this.towerMat, facadeTex, this.towers)

    // ----- cylindrical horizon haze rings to seat the city ------------------
    this.addHaze(palette, white)

    // ----- the light cloud ---------------------------------------------------
    this.count = lkind.length
    this.baseColors = Float32Array.from(lcol)
    this.colorArr = new Float32Array(this.baseColors)
    this.phase = Float32Array.from(lphase)
    this.speed = Float32Array.from(lspeed)
    this.bright = Float32Array.from(lbright)
    this.kind = Uint8Array.from(lkind)

    const dotTex = this.makeDotTexture()
    const lightGeo = new THREE.BufferGeometry()
    lightGeo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(lpos), 3))
    this.colorAttr = new THREE.BufferAttribute(this.colorArr, 3)
    this.colorAttr.setUsage(THREE.DynamicDrawUsage)
    lightGeo.setAttribute('color', this.colorAttr)

    this.lightMat = new THREE.PointsMaterial({
      size: 0.85,
      map: dotTex,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      fog: true,
    })
    const lights = new THREE.Points(lightGeo, this.lightMat)
    lights.frustumCulled = false
    this.group.add(lights)
    this.disposables.push(lightGeo, this.lightMat, dotTex)
  }

  // --- dark facade with a grid of mostly-dim / a-few-bright / a-few-off windows
  private makeFacadeTexture(palette: ScenePalette, white: THREE.Color): THREE.CanvasTexture {
    const W = 128
    const H = 256
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')

    // base sits just above the void so the silhouette reads through the fog
    const baseDark = palette.voidColor.clone().lerp(palette.hologram, 0.16)
    ctx.fillStyle = baseDark.getStyle(THREE.SRGBColorSpace)
    ctx.fillRect(0, 0, W, H)

    const litCyan = palette.phosphor.clone().lerp(white, 0.55)
    const cols = 4
    const rows = 7
    const cw = W / cols
    const ch = H / rows
    const gap = 2
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const k = Math.random()
        if (k < 0.12) continue // window OFF -> stays the dark facade base
        let col: THREE.Color
        if (k < 0.62) {
          // dim window
          col = (Math.random() < 0.5 ? palette.phosphor : palette.hologram)
            .clone()
            .multiplyScalar(0.1 + Math.random() * 0.1)
        } else if (k < 0.86) {
          // medium-lit window
          col = (Math.random() < 0.6 ? palette.phosphor : palette.hologram)
            .clone()
            .multiplyScalar(0.35 + Math.random() * 0.25)
        } else {
          // bright-lit window (rare warm tachibana among them)
          col = (Math.random() < 0.12 ? palette.tachibana.clone() : litCyan.clone()).multiplyScalar(
            0.9 + Math.random() * 0.25,
          )
        }
        ctx.fillStyle = col.getStyle(THREE.SRGBColorSpace)
        ctx.fillRect(c * cw + gap, r * ch + gap, cw - gap * 2, ch - gap * 2)
      }
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(1.4, 2.2)
    return tex
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

  // faint additive horizon band for a haze CYLINDER: a bright horizontal line at
  // the vertical centre that fades up/down, UNIFORM around the circumference
  // (no horizontal fade) so the glow seats the skyline evenly on every bearing.
  private makeHorizonTexture(core: THREE.Color, soft: number): THREE.CanvasTexture {
    const W = 8
    const H = 128
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')
    const rgba = (a: number): string =>
      core.getStyle(THREE.SRGBColorSpace).replace('rgb(', 'rgba(').replace(')', `,${a})`)

    const grad = ctx.createLinearGradient(0, 0, 0, H)
    const a = Math.max(0, 0.5 - soft)
    const b = Math.min(1, 0.5 + soft)
    grad.addColorStop(0, rgba(0))
    if (a > 0.001) grad.addColorStop(a, rgba(0))
    grad.addColorStop(0.5, rgba(1))
    if (b < 0.999) grad.addColorStop(b, rgba(0))
    grad.addColorStop(1, rgba(0))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // two concentric haze rings BEYOND the furthest towers: a low ground-glow band
  // seating the bases, and a taller horizon band backlighting the silhouettes.
  // BackSide so the camera (inside) sees only the far wall — a single additive
  // layer, no double-exposure; fog:false so it reads through the FogExp2 depth.
  private addHaze(palette: ScenePalette, white: THREE.Color): void {
    const bands: Array<{
      core: THREE.Color
      radius: number
      height: number
      y: number
      soft: number
      opacity: number
      seg: number
    }> = [
      // ground glow where the city base meets the floor / fog horizon
      {
        core: palette.hologram.clone().lerp(palette.phosphor, 0.4),
        radius: 86,
        height: 34,
        y: -7,
        soft: 0.18,
        opacity: 0.42,
        seg: 64,
      },
      // distant horizon haze backlighting the tallest ring
      {
        core: palette.hologram.clone().lerp(white, 0.12),
        radius: 98,
        height: 72,
        y: 4,
        soft: 0.3,
        opacity: 0.3,
        seg: 72,
      },
    ]
    for (const def of bands) {
      const tex = this.makeHorizonTexture(def.core, def.soft)
      const geo = new THREE.CylinderGeometry(def.radius, def.radius, def.height, def.seg, 1, true)
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: def.opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: THREE.BackSide,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(0, def.y, 0)
      mesh.frustumCulled = false
      this.group.add(mesh)
      this.hazeMats.push(mat)
      this.hazeBaseOpacity.push(def.opacity)
      this.disposables.push(geo, mat, tex)
    }
  }

  update(ctx: FeatureContext): void {
    const motion = ctx.motion
    this.anim += ctx.dt * motion
    const a = this.anim

    // very slow sway of the whole enclosing ring (stays near-static)
    this.group.rotation.y = Math.sin(a * 0.04) * 0.01
    this.group.position.y = Math.sin(a * 0.05) * 0.25

    // audio bass gently lifts the windows + the haze brightness
    const audioGain = 1 + ctx.audio * 0.8
    this.towerMat.color.setScalar(1 + ctx.audio * 0.35)
    for (let h = 0; h < this.hazeMats.length; h++) {
      this.hazeMats[h].opacity =
        this.hazeBaseOpacity[h] * (0.85 + 0.15 * Math.sin(a * 0.2 + h) + ctx.audio * 0.5)
    }

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
    for (const d of this.disposables) d.dispose()
  }
}
