import * as THREE from 'three'
import type { ScenePalette } from './features/types'
import type { PanelDatum } from './panelData'

// ---------------------------------------------------------------------------
// Canvas-2D textures (crisp control, amplified by the bloom pass)
// ---------------------------------------------------------------------------

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  return { canvas, ctx }
}

export function makeSpriteTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 64)
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(160,230,255,0.8)')
  g.addColorStop(1, 'rgba(120,210,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export function drawLogoTexture(p: ScenePalette): THREE.CanvasTexture {
  const S = 1024
  const { canvas, ctx } = makeCanvas(S, S)
  ctx.translate(S / 2, S / 2)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const cyan = p.phosphorStr // bright iris / nodes
  const blue = p.hologramStr // mid-blue body / brackets
  const setGlow = (color: string, blur: number): void => {
    ctx.shadowColor = color
    ctx.shadowBlur = blur
    ctx.strokeStyle = color
    ctx.fillStyle = color
  }
  const dot = (x: number, y: number, r: number): void => {
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // soft outer halo
  const halo = ctx.createRadialGradient(0, 0, 40, 0, 0, 470)
  halo.addColorStop(0, 'rgba(90,170,255,0.22)')
  halo.addColorStop(1, 'rgba(90,170,255,0)')
  ctx.fillStyle = halo
  ctx.beginPath(); ctx.arc(0, 0, 470, 0, Math.PI * 2); ctx.fill()

  // big rounded BODY/BOWL — open at the TOP, where the iris nests
  setGlow(blue, 26)
  ctx.lineWidth = 18
  ctx.beginPath(); ctx.arc(0, -22, 122, 1.72 * Math.PI, 3.28 * Math.PI); ctx.stroke()

  // angular "< >" chevron wings at the iris level
  setGlow(blue, 24)
  ctx.lineWidth = 22
  const chevron = (s: number): void => {
    ctx.beginPath()
    ctx.moveTo(s * 150, -124)
    ctx.lineTo(s * 234, -58)
    ctx.lineTo(s * 150, 8)
    ctx.stroke()
  }
  chevron(-1); chevron(1)

  // short horizontal traces linking the iris out to each wing
  setGlow(blue, 16)
  ctx.lineWidth = 12
  ctx.beginPath(); ctx.moveTo(-84, -58); ctx.lineTo(-150, -58); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(84, -58); ctx.lineTo(150, -58); ctx.stroke()

  // iris: two concentric rings (mid then bright)
  setGlow(blue, 18); ctx.lineWidth = 10
  ctx.beginPath(); ctx.arc(0, -60, 80, 0, Math.PI * 2); ctx.stroke()
  setGlow(cyan, 22); ctx.lineWidth = 11
  ctx.beginPath(); ctx.arc(0, -60, 58, 0, Math.PI * 2); ctx.stroke()

  // bright scan-lined pupil
  const pupil = ctx.createRadialGradient(0, -60, 4, 0, -60, 46)
  pupil.addColorStop(0, '#ffffff')
  pupil.addColorStop(0.45, cyan)
  pupil.addColorStop(1, 'rgba(120,210,255,0.18)')
  ctx.shadowColor = cyan
  ctx.shadowBlur = 40
  ctx.fillStyle = pupil
  ctx.beginPath(); ctx.arc(0, -60, 44, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(18,52,104,0.5)'
  ctx.lineWidth = 5
  for (let yy = -82; yy <= -38; yy += 11) {
    ctx.beginPath(); ctx.moveTo(-40, yy); ctx.lineTo(40, yy); ctx.stroke()
  }

  // vertical stem dropping through the bowl + diagonal traces to corner nodes
  setGlow(cyan, 18)
  ctx.lineWidth = 12
  ctx.beginPath(); ctx.moveTo(0, 20); ctx.lineTo(0, 114); ctx.stroke()
  ctx.lineWidth = 9
  ctx.beginPath(); ctx.moveTo(0, 82); ctx.lineTo(-68, 106); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, 82); ctx.lineTo(68, 106); ctx.stroke()

  // node dots: wing upper tips, bottom corners, stem terminal
  setGlow(cyan, 16)
  dot(-150, -124, 14)
  dot(150, -124, 14)
  dot(-68, 106, 15)
  dot(68, 106, 15)
  dot(0, 116, 11)

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// A NAVI panel rendered as an ETHEREAL projection in the Wired rather than a
// solid window: a luminous field (no hard border), a faint constellation of
// connected nodes, hologram scanlines, a data-stream, implied corner brackets,
// and feathered edges that dissolve into the void. Drawn once per panel; the
// drift/bloom/hover animation lives on the mesh.
export function drawPanelTexture(d: PanelDatum, p: ScenePalette): THREE.CanvasTexture {
  const W = 512
  const H = 320
  const TAU = Math.PI * 2
  const { canvas, ctx } = makeCanvas(W, H)
  const accent = p.phosphorStr

  // manual letter-spacing (avoids depending on ctx.letterSpacing)
  const spacedWidth = (text: string, sp: number): number => {
    let w = 0
    for (const ch of text) w += ctx.measureText(ch).width + sp
    return Math.max(0, w - sp)
  }
  const fillSpaced = (text: string, x: number, y: number, sp: number): void => {
    let cx = x
    for (const ch of text) {
      ctx.fillText(ch, cx, y)
      cx += ctx.measureText(ch).width + sp
    }
  }

  // --- ethereal body: a soft luminous field, no hard window fill -----------
  const body = ctx.createLinearGradient(0, 16, 0, H - 16)
  body.addColorStop(0, 'rgba(20,72,124,0.04)')
  body.addColorStop(0.45, 'rgba(28,98,158,0.20)')
  body.addColorStop(1, 'rgba(12,48,92,0.04)')
  ctx.fillStyle = body
  ctx.fillRect(0, 0, W, H)

  // soft core glow pooled behind the title
  const core = ctx.createRadialGradient(150, 64, 0, 150, 64, 280)
  core.addColorStop(0, 'rgba(96,184,252,0.22)')
  core.addColorStop(1, 'rgba(96,184,252,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, W, H)

  // --- the Wired: a faint constellation of nodes + nearest-neighbour traces -
  ctx.globalCompositeOperation = 'lighter'
  const nodes: { x: number; y: number }[] = []
  for (let i = 0; i < 8; i++) nodes.push({ x: 36 + Math.random() * (W - 72), y: 92 + Math.random() * (H - 132) })
  ctx.lineWidth = 1
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dist = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y)
      if (dist < 158) {
        ctx.strokeStyle = `rgba(126,206,255,${(0.12 * (1 - dist / 158)).toFixed(3)})`
        ctx.beginPath()
        ctx.moveTo(nodes[i].x, nodes[i].y)
        ctx.lineTo(nodes[j].x, nodes[j].y)
        ctx.stroke()
      }
    }
  }
  for (const n of nodes) {
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 6)
    g.addColorStop(0, 'rgba(184,236,255,0.55)')
    g.addColorStop(1, 'rgba(184,236,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(n.x, n.y, 6, 0, TAU)
    ctx.fill()
  }
  ctx.globalCompositeOperation = 'source-over'

  // --- hologram scanlines --------------------------------------------------
  ctx.fillStyle = 'rgba(124,204,255,0.05)'
  for (let yy = 20; yy < H - 18; yy += 4) ctx.fillRect(20, yy, W - 40, 1)

  ctx.textBaseline = 'top'

  // --- kind tag + live status node, top-right ------------------------------
  const tag = 'LINK'
  ctx.font = '600 17px "TrixieCyrG", ui-monospace, monospace'
  const tagX = W - 36 - spacedWidth(tag, 3)
  ctx.fillStyle = 'rgba(150,214,250,0.55)'
  fillSpaced(tag, tagX, 34, 3)
  ctx.fillStyle = accent
  ctx.shadowColor = accent
  ctx.shadowBlur = 10
  ctx.beginPath()
  ctx.arc(tagX - 12, 42, 3.5, 0, TAU)
  ctx.fill()
  ctx.shadowBlur = 0

  // --- label ---------------------------------------------------------------
  ctx.font = '700 31px "TrixieCyrG", ui-monospace, monospace'
  ctx.fillStyle = accent
  ctx.shadowColor = accent
  ctx.shadowBlur = 16
  fillSpaced(d.label, 38, 26, 2)
  ctx.shadowBlur = 0

  // --- divider: a trace that fades at both ends, with a node at the head ----
  const dy = 76
  const dg = ctx.createLinearGradient(38, 0, W - 44, 0)
  dg.addColorStop(0, 'rgba(126,206,255,0)')
  dg.addColorStop(0.12, 'rgba(126,206,255,0.5)')
  dg.addColorStop(1, 'rgba(126,206,255,0)')
  ctx.fillStyle = dg
  ctx.fillRect(38, dy, W - 82, 1.5)
  ctx.fillStyle = accent
  ctx.shadowColor = accent
  ctx.shadowBlur = 8
  ctx.beginPath()
  ctx.arc(40, dy + 0.5, 3, 0, TAU)
  ctx.fill()
  ctx.shadowBlur = 0

  // --- body lines (a "▸ …" line renders as a glowing action) --------------
  let y = 106
  for (const line of d.lines) {
    if (line.startsWith('▸')) {
      ctx.font = '700 25px "TrixieCyrG", ui-monospace, monospace'
      ctx.fillStyle = accent
      ctx.shadowColor = accent
      ctx.shadowBlur = 16
      fillSpaced(line, 38, y + 4, 2)
      ctx.shadowBlur = 0
    } else {
      ctx.font = '400 23px "TrixieCyrG", ui-monospace, monospace'
      ctx.fillStyle = 'rgba(174,224,255,0.82)'
      ctx.fillText(line, 38, y)
    }
    y += 40
  }

  // --- data-stream: a faint signal trace along the lower edge --------------
  ctx.globalCompositeOperation = 'lighter'
  ctx.fillStyle = 'rgba(126,206,255,0.28)'
  for (let i = 0; i < 48; i++) {
    const tx = 38 + i * 9
    if (tx > W - 46) break
    const th = 2 + Math.random() * 12
    ctx.fillRect(tx, H - 32 - th, 2, th)
  }
  ctx.globalCompositeOperation = 'source-over'

  // --- HUD corner brackets: an implied frame, not a window -----------------
  ctx.strokeStyle = accent
  ctx.shadowColor = accent
  ctx.shadowBlur = 10
  ctx.lineWidth = 2
  const m = 22
  const L = 26
  const corner = (cx: number, cy: number, sx: number, sy: number): void => {
    ctx.beginPath()
    ctx.moveTo(cx, cy + sy * L)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx + sx * L, cy)
    ctx.stroke()
  }
  corner(m, m, 1, 1)
  corner(W - m, m, -1, 1)
  corner(m, H - m, 1, -1)
  corner(W - m, H - m, -1, -1)
  ctx.shadowBlur = 0

  // --- feather the edges so the card dissolves into the void ---------------
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = '#000'
  ctx.shadowColor = '#000'
  ctx.shadowBlur = 26
  const mi = 18
  const rr = 30
  ctx.beginPath()
  ctx.moveTo(mi + rr, mi)
  ctx.arcTo(W - mi, mi, W - mi, H - mi, rr)
  ctx.arcTo(W - mi, H - mi, mi, H - mi, rr)
  ctx.arcTo(mi, H - mi, mi, mi, rr)
  ctx.arcTo(mi, mi, W - mi, mi, rr)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.globalCompositeOperation = 'source-over'

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// ---------------------------------------------------------------------------
