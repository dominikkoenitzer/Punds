import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ---------------------------------------------------------------------------
// DataRain — falling monospace glyph streams scattered through the mid/back of
// the Wired. Each stream is a tall, thin, camera-billboarded plane textured
// with a pre-rendered strip canvas of katakana / ASCII / hex glyphs. The
// canvas is drawn ONCE per stream; per-frame animation is just a cheap scroll
// of texture.offset.y (RepeatWrapping), so there is no per-frame canvas work
// and no per-frame allocation.
// ---------------------------------------------------------------------------

const CANVAS_W = 128
const CANVAS_H = 1024 // 1:8 strip — plane aspect matches to keep glyphs square
const STREAM_COUNT = 13
const ROWS = 32 // divides CANVAS_H exactly so vertical tiling is seamless
const COLS = 5

const TAU = Math.PI * 2

interface Stream {
  mesh: THREE.Mesh
  texture: THREE.CanvasTexture
  material: THREE.MeshBasicMaterial
  speed: number // texture-offset units per second
  flickerRate: number
  flickerPhase: number
  baseOpacity: number
}

function buildGlyphSet(): string {
  let s = ''
  // half-width katakana (U+FF66..U+FF9D) — the Lain / Wired staple
  for (let c = 0xff66; c <= 0xff9d; c++) s += String.fromCharCode(c)
  s += 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  s += '0123456789'
  s += '0123456789ABCDEF' // weight hex digits a little heavier
  s += '<>/\\|=+*#-'
  return s
}

function makeStreamTexture(glyphs: string, color: THREE.Color): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CANVAS_W
  canvas.height = CANVAS_H

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace

  const ctx = canvas.getContext('2d')
  if (!ctx) return tex // texture stays transparent if no 2d context

  const cellW = CANVAS_W / COLS
  const cellH = CANVAS_H / ROWS
  const fontSize = Math.floor(cellH * 0.9)

  const r = Math.round(THREE.MathUtils.clamp(color.r, 0, 1) * 255)
  const g = Math.round(THREE.MathUtils.clamp(color.g, 0, 1) * 255)
  const b = Math.round(THREE.MathUtils.clamp(color.b, 0, 1) * 255)
  // a near-white tint of the base hue for the leading glyph
  const hr = Math.min(255, r + 130)
  const hg = Math.min(255, g + 100)
  const hb = Math.min(255, b + 70)

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  ctx.font = `${fontSize}px monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const rnd = (): string => glyphs.charAt((Math.random() * glyphs.length) | 0)

  for (let c = 0; c < COLS; c++) {
    const x = c * cellW + cellW * 0.5
    const head = (Math.random() * ROWS) | 0
    const trail = 7 + ((Math.random() * 14) | 0)

    for (let row = 0; row < ROWS; row++) {
      const y = row * cellH + cellH * 0.5
      const d = (row - head + ROWS) % ROWS // 0 at the bright head, grows along the tail

      if (d === 0) {
        // leading glyph: brightest, near-white, with a soft halo for the bloom pass
        ctx.shadowColor = `rgba(${r},${g},${b},0.9)`
        ctx.shadowBlur = fontSize * 0.6
        ctx.fillStyle = `rgba(${hr},${hg},${hb},1)`
        ctx.fillText(rnd(), x, y)
        ctx.shadowBlur = 0
      } else if (d <= trail) {
        // fading tail behind the head
        const a = 0.08 + 0.8 * (1 - d / trail) * (0.7 + Math.random() * 0.3)
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`
        ctx.fillText(rnd(), x, y)
      } else if (Math.random() < 0.26) {
        // sparse faint background glyphs — kept sparse so the plane never reads
        // as a solid glowing rectangle, only as streaks
        const a = 0.05 + Math.random() * 0.07
        ctx.fillStyle = `rgba(${r},${g},${b},${a.toFixed(3)})`
        ctx.fillText(rnd(), x, y)
      }
    }
  }

  tex.needsUpdate = true
  return tex
}

export class DataRain implements SceneFeature {
  readonly group: THREE.Object3D

  private readonly geometry: THREE.PlaneGeometry
  private readonly streams: Stream[] = []

  constructor(palette: ScenePalette) {
    this.group = new THREE.Group()
    this.group.name = 'DataRain'

    // one shared unit plane; each stream sizes itself via mesh.scale
    this.geometry = new THREE.PlaneGeometry(1, 1)

    const glyphs = buildGlyphSet()

    for (let i = 0; i < STREAM_COUNT; i++) {
      // mostly phosphor cyan, with a few hologram-blue streams for depth variety
      const color = i % 4 === 0 ? palette.hologram : palette.phosphor
      const texture = makeStreamTexture(glyphs, color)
      texture.offset.y = Math.random() // random phase so streams start out of sync

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 1,
        toneMapped: false,
      })

      const mesh = new THREE.Mesh(this.geometry, material)

      // scatter through the mid/back, biased to the sides — never dead-center
      const z = -10 - Math.random() * 33 // -10 .. -43
      let x = (Math.random() * 2 - 1) * 30
      if (Math.abs(x) < 7) x += x >= 0 ? 7 : -7
      const y = (Math.random() * 2 - 1) * 11
      mesh.position.set(x, y, z)

      // tall, thin strip; height = width * 8 to match the 1:8 canvas aspect
      const w = 2 + Math.random() * 1.6
      mesh.scale.set(w, w * 8, 1)
      mesh.renderOrder = 1

      this.group.add(mesh)
      this.streams.push({
        mesh,
        texture,
        material,
        speed: 0.03 + Math.random() * 0.1,
        flickerRate: 2 + Math.random() * 5,
        flickerPhase: Math.random() * TAU,
        baseOpacity: 0.55 + Math.random() * 0.35,
      })
    }
  }

  update(ctx: FeatureContext): void {
    const m = ctx.motion
    const cam = ctx.camera.position
    const audioSpeed = 1 + ctx.audio * 0.6
    const audioGain = 1 + ctx.audio * 0.4

    for (const s of this.streams) {
      // scroll the glyph strip (cheap, no canvas redraw); keep offset bounded
      let off = s.texture.offset.y + s.speed * ctx.dt * m * audioSpeed
      off -= Math.floor(off)
      s.texture.offset.y = off

      // subtle CRT-style flicker, lifted a touch by the bass level
      const flick = 0.85 + 0.15 * Math.sin(ctx.t * s.flickerRate + s.flickerPhase)
      s.material.opacity = s.baseOpacity * flick * audioGain

      // billboard toward the live camera; world-up keeps columns vertical
      s.mesh.lookAt(cam)
    }
  }

  dispose(): void {
    for (const s of this.streams) {
      s.material.dispose()
      s.texture.dispose()
    }
    this.streams.length = 0
    this.geometry.dispose()
    this.group.clear()
  }
}
