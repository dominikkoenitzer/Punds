import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// TerminalText — floating "Wired" log readouts
// A scatter of CanvasTexture planes drifting at depth, each rendering several
// lines of monospace log text in phosphor cyan with glow on a transparent,
// additively-blended surface so the bloom pass makes them bloom. Planes always
// billboard toward the camera, bob gently, and slowly fade in/out (per-plane
// sine) so logs appear and dissolve. Each plane scrolls in a fresh line at
// most every ~2s (throttled, one redraw per frame), never per frame.
// ============================================================================

type Tone = 'phosphor' | 'hologram' | 'tachibana' | 'warning'

interface LogLine {
  text: string
  tone: Tone
}

interface LogPlane {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  tex: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  channel: string
  lines: LogLine[]
  baseX: number
  baseY: number
  baseW: number
  baseH: number
  bobPhase: number
  bobSpeed: number
  bobAmpX: number
  bobAmpY: number
  fadePhase: number
  fadeSpeed: number
  nextRedraw: number
}

// --- canvas geometry --------------------------------------------------------
const CANVAS_W = 512
const CANVAS_H = 288
const LINE_COUNT = 7
const FONT_PX = 21
const LINE_H = 32
const PAD_X = 18
const HEADER_Y = 12
const DIVIDER_Y = 36
const LINES_TOP = 46
const PLANE_COUNT = 8
const MONO_FONT = 'ui-monospace, "TrixieCyrG", SFMono-Regular, Menlo, monospace'

const HEX = '0123456789ABCDEF'
function rhex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += HEX[(Math.random() * 16) | 0]
  return s
}
function ri(max: number): number {
  return (Math.random() * max) | 0
}

// Mostly phosphor chatter; hologram, tachibana and warning are sparing accents.
const LINE_POOL: Array<() => LogLine> = [
  () => ({ text: 'PROTOCOL 7 :: HANDSHAKE OK', tone: 'phosphor' }),
  () => ({ text: `LAYER 0x${rhex(2)} SYNC`, tone: 'phosphor' }),
  () => ({ text: `carrier ${(7.0 + Math.random() * 0.99).toFixed(2)}Hz`, tone: 'phosphor' }),
  () => ({ text: `node 0x${rhex(4)} linked`, tone: 'phosphor' }),
  () => ({ text: `0x${rhex(4)}: ${rhex(2)} ${rhex(2)} ${rhex(2)} ${rhex(2)} ${rhex(2)}`, tone: 'phosphor' }),
  () => ({ text: `WIRED :: ROUTE ${rhex(2)}.${rhex(2)}`, tone: 'phosphor' }),
  () => ({ text: `psyche_xfer ${ri(100)}%`, tone: 'phosphor' }),
  () => ({ text: `> recv ${rhex(2)}${rhex(2)} ack`, tone: 'phosphor' }),
  () => ({ text: `pkt ${rhex(2)} -> 0x${rhex(4)}`, tone: 'phosphor' }),
  () => ({ text: 'schumann res lock', tone: 'hologram' }),
  () => ({ text: `KIDS sig ${ri(1000).toString().padStart(3, '0')}`, tone: 'hologram' }),
  () => ({ text: `mem 0x${rhex(4)} dump ok`, tone: 'hologram' }),
  () => ({ text: 'tachibana lab :: trace', tone: 'tachibana' }),
  () => ({ text: `! desync layer 0x${rhex(2)}`, tone: 'warning' }),
]

function makeLine(): LogLine {
  return LINE_POOL[ri(LINE_POOL.length)]()
}

export class TerminalText implements SceneFeature {
  readonly group: THREE.Object3D

  private palette: ScenePalette
  private geo: THREE.PlaneGeometry
  private planes: LogPlane[] = []
  private localT = 0

  constructor(palette: ScenePalette) {
    this.palette = palette
    this.group = new THREE.Group()
    // One shared unit plane; per-plane size lives in mesh.scale.
    this.geo = new THREE.PlaneGeometry(1, 1)

    for (let i = 0; i < PLANE_COUNT; i++) {
      const plane = this.buildPlane(i)
      this.planes.push(plane)
      this.group.add(plane.mesh)
    }
  }

  private buildPlane(i: number): LogPlane {
    const canvas = document.createElement('canvas')
    canvas.width = CANVAS_W
    canvas.height = CANVAS_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2d context unavailable')

    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4

    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })

    const aspect = CANVAS_W / CANVAS_H
    const baseH = 1.5 + (i % 3) * 0.45
    const baseW = baseH * aspect

    const mesh = new THREE.Mesh(this.geo, mat)
    mesh.scale.set(baseW, baseH, 1)

    // Scatter to the sides and mid/back; never dead-centre. z spans ~ -8..-42.
    const side = i % 2 === 0 ? 1 : -1
    const depthT = PLANE_COUNT > 1 ? i / (PLANE_COUNT - 1) : 0
    const baseX = side * (4.5 + Math.random() * 13)
    const baseY = (Math.random() - 0.5) * 13
    const baseZ = -8 - depthT * 30 - Math.random() * 4
    mesh.position.set(baseX, baseY, baseZ)

    const lines: LogLine[] = []
    for (let l = 0; l < LINE_COUNT; l++) lines.push(makeLine())

    const plane: LogPlane = {
      mesh,
      mat,
      tex,
      canvas,
      ctx,
      channel: `0x${rhex(2)}`,
      lines,
      baseX,
      baseY,
      baseW,
      baseH,
      bobPhase: Math.random() * Math.PI * 2,
      bobSpeed: 0.2 + Math.random() * 0.3,
      bobAmpX: 0.05 + Math.random() * 0.1,
      bobAmpY: 0.15 + Math.random() * 0.28,
      fadePhase: Math.random() * Math.PI * 2,
      fadeSpeed: 0.1 + Math.random() * 0.18,
      // Stagger first scroll so canvases never redraw on the same frame.
      nextRedraw: 1.5 + i * 0.45 + Math.random() * 0.8,
    }
    this.draw(plane)
    return plane
  }

  private toneColor(tone: Tone): string {
    switch (tone) {
      case 'hologram':
        return this.palette.hologramStr
      case 'tachibana':
        return this.palette.tachibanaStr
      case 'warning':
        return this.palette.warningStr
      case 'phosphor':
        return this.palette.phosphorStr
    }
  }

  private draw(p: LogPlane): void {
    const ctx = p.ctx
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.textBaseline = 'top'

    // --- header tag --------------------------------------------------------
    ctx.font = `16px ${MONO_FONT}`
    ctx.globalAlpha = 0.7
    ctx.shadowColor = this.palette.hologramStr
    ctx.shadowBlur = 6
    ctx.fillStyle = this.palette.hologramStr
    ctx.fillText(`//WIRED.LOG ${p.channel}`, PAD_X, HEADER_Y)

    // divider + left accent rail
    ctx.shadowBlur = 0
    ctx.globalAlpha = 0.32
    ctx.fillRect(PAD_X, DIVIDER_Y, CANVAS_W - PAD_X * 2, 1.5)
    ctx.globalAlpha = 0.45
    ctx.fillRect(PAD_X - 8, LINES_TOP, 2, LINE_COUNT * LINE_H)

    // --- log lines (older dimmer, newest brightest + caret) ----------------
    ctx.font = `${FONT_PX}px ${MONO_FONT}`
    const last = p.lines.length - 1
    for (let l = 0; l < p.lines.length; l++) {
      const line = p.lines[l]
      const newest = l === last
      const y = LINES_TOP + l * LINE_H
      const color = this.toneColor(line.tone)
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = newest ? 14 : 8
      ctx.globalAlpha = newest ? 1 : 0.32 + 0.55 * (last > 0 ? l / last : 1)
      ctx.fillText(newest ? `${line.text} _` : line.text, PAD_X, y)
    }

    ctx.globalAlpha = 1
    ctx.shadowBlur = 0
    p.tex.needsUpdate = true
  }

  update(ctx: FeatureContext): void {
    this.localT += ctx.dt * ctx.motion
    const lt = this.localT
    const audio = ctx.audio
    let redrawBudget = 1

    for (const p of this.planes) {
      // Throttled scroll: append a fresh line, drop the oldest, redraw once.
      // At most one canvas redraw per frame so several due planes spread out.
      if (redrawBudget > 0 && ctx.t >= p.nextRedraw) {
        p.lines.shift()
        p.lines.push(makeLine())
        this.draw(p)
        p.nextRedraw = ctx.t + 2 + Math.random() * 1.8
        redrawBudget--
      }

      // Gentle drift bob (z held constant so depth scatter is preserved).
      p.mesh.position.x = p.baseX + Math.sin(lt * p.bobSpeed * 0.6 + p.bobPhase) * p.bobAmpX
      p.mesh.position.y = p.baseY + Math.sin(lt * p.bobSpeed + p.bobPhase) * p.bobAmpY

      // Billboard toward the live camera.
      p.mesh.lookAt(ctx.camera.position)

      // Slow per-plane fade in/out; bias toward time spent dissolved.
      const f = 0.5 + 0.5 * Math.sin(lt * p.fadeSpeed + p.fadePhase)
      const env = Math.pow(f, 1.6)
      p.mat.opacity = THREE.MathUtils.clamp(env * (0.9 + audio * 0.25), 0, 1)

      // Subtle breathing + audio pulse on scale.
      const pulse = 1 + audio * 0.05 + Math.sin(lt * 0.8 + p.bobPhase) * 0.01
      p.mesh.scale.set(p.baseW * pulse, p.baseH * pulse, 1)
    }
  }

  dispose(): void {
    for (const p of this.planes) {
      this.group.remove(p.mesh)
      p.mat.dispose()
      p.tex.dispose()
    }
    this.geo.dispose()
    this.planes = []
  }
}
