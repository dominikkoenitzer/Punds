import * as THREE from 'three'
import type { ScenePalette, FeatureContext, SceneFeature } from './types'

// ============================================================================
// WiredIntercepts — eerie glitchy "Wired transmission" text fragments.
//
// A pool of small billboarded planes, each textured from its own tiny <canvas>
// painting a SHORT monospace transmission fragment (phosphor cyan, glowing, on a
// transparent additively-blended surface so the bloom pass catches it). Each
// fragment FADES IN at a random spot around the viewer (radius ~10..40, varied
// y), drifts slowly, occasionally GLITCHES — a brief redraw with scrambled
// glyphs + RGB-split + jitter — then FADES OUT and recycles to a fresh
// spot/phrase a few seconds later. Spawns are staggered so only a few hang in
// the haze at once: presences in the Wired, half-heard. ("you are not alone.")
//
// COPYRIGHT-SAFE: generic in-world flavour strings only.
//
// Perf: ONE shared PlaneGeometry; per-plane size in mesh.scale. Canvases are
// redrawn ONLY on (re)spawn and on the two edges of a glitch (start / end),
// never per frame, and a small per-frame REDRAW BUDGET spreads those redraws
// across frames. update() does no allocation beyond Math.* scalars — it only
// advances opacity / position / billboard rotation. Idle fragments are hidden
// (visible=false, opacity 0) and skipped.
// ============================================================================

const POOL_COUNT = 12

const CANVAS_W = 320
const CANVAS_H = 64
const FONT_PX = 24
const PAD_X = 22
const MONO_FONT = 'ui-monospace, "TrixieCyrG", SFMono-Regular, Menlo, monospace'

// At most this many canvas redraws per frame (spawn / glitch-start / glitch-end)
// so several due fragments never all repaint on the same frame.
const REDRAW_BUDGET = 2

// Short in-world transmission fragments (rotated through on respawn).
const PHRASES: readonly string[] = [
  'SIGNAL_DETECTED',
  'LAYER_07',
  'NODE_ACTIVE',
  '7F 3A C2 09',
  'PRESENCE_CONFIRMED',
  'ARE YOU THERE?',
  'NO BARRIERS',
  'CONNECTED',
  'WHO IS THERE',
  'TRANSMISSION_RECV',
  'you are not alone',
  'SYNC_OK',
  'REALITY: UNSTABLE',
  'I SEE YOU',
]

// Glyphs used to scramble a fragment during a glitch.
const GLYPHS = '▓▒░#@%&*/\\|<>=+0123456789ABCDEF'

function scramble(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === ' ') {
      out += ' '
      continue
    }
    out += Math.random() < 0.45 ? GLYPHS[(Math.random() * GLYPHS.length) | 0] : c
  }
  return out
}

// Per-fragment lifecycle states.
const DEAD = 0
const FADEIN = 1
const SHOW = 2
const FADEOUT = 3

interface Intercept {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  tex: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  phrase: string

  state: number
  stateT: number
  respawnAt: number // localT at which a DEAD fragment may respawn

  fadeInDur: number
  showDur: number
  fadeOutDur: number
  deadDur: number
  peak: number // max opacity for this appearance

  // slowly-drifting anchor (world units) + gentle bob
  ax: number
  ay: number
  az: number
  vx: number
  vy: number
  vz: number
  bobPhase: number
  bobSpeed: number
  bobAmp: number

  baseW: number
  baseH: number

  glitching: boolean
  glitchEndsAt: number
  nextGlitchAt: number
}

export class WiredIntercepts implements SceneFeature {
  readonly group: THREE.Object3D

  private readonly palette: ScenePalette
  private readonly geo: THREE.PlaneGeometry
  private readonly items: Intercept[] = []
  private localT = 0
  private phraseCursor = (Math.random() * PHRASES.length) | 0

  constructor(palette: ScenePalette) {
    this.palette = palette
    this.group = new THREE.Group()
    this.group.name = 'WiredIntercepts'

    // One shared unit plane; each fragment scales it.
    this.geo = new THREE.PlaneGeometry(1, 1)

    const aspect = CANVAS_W / CANVAS_H
    for (let i = 0; i < POOL_COUNT; i++) {
      const canvas = document.createElement('canvas')
      canvas.width = CANVAS_W
      canvas.height = CANVAS_H
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2d context unavailable')

      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = 2

      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })

      const baseH = 0.9 + (i % 4) * 0.18
      const baseW = baseH * aspect

      const mesh = new THREE.Mesh(this.geo, mat)
      mesh.scale.set(baseW, baseH, 1)
      mesh.visible = false

      const item: Intercept = {
        mesh,
        mat,
        tex,
        canvas,
        ctx,
        phrase: PHRASES[0],
        state: DEAD,
        stateT: 0,
        // Stagger the first appearances across the opening seconds.
        respawnAt: i * 0.6 + Math.random() * 1.2,
        fadeInDur: 1,
        showDur: 4,
        fadeOutDur: 1.2,
        deadDur: 6,
        peak: 0.9,
        ax: 0,
        ay: 0,
        az: -20,
        vx: 0,
        vy: 0,
        vz: 0,
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.3 + Math.random() * 0.4,
        bobAmp: 0.08 + Math.random() * 0.16,
        baseW,
        baseH,
        glitching: false,
        glitchEndsAt: 0,
        nextGlitchAt: 0,
      }

      this.items.push(item)
      this.group.add(mesh)
    }
  }

  // Pick a fresh spot, phrase and timings; paint the (clean) fragment once.
  private respawn(p: Intercept): void {
    this.phraseCursor = (this.phraseCursor + 1) % PHRASES.length
    // Occasionally hop randomly so the rotation never feels like a fixed loop.
    if (Math.random() < 0.3) this.phraseCursor = (Math.random() * PHRASES.length) | 0
    p.phrase = PHRASES[this.phraseCursor]

    const ang = Math.random() * Math.PI * 2
    const rad = 10 + Math.random() * 30 // ~10..40
    p.ax = Math.cos(ang) * rad
    p.az = Math.sin(ang) * rad
    p.ay = -1 + Math.random() * 16 // varied height, floor is at y=-10

    // very slow drift, mostly sideways with a touch of rise/sink
    const dir = Math.random() * Math.PI * 2
    const speed = 0.15 + Math.random() * 0.4
    p.vx = Math.cos(dir) * speed
    p.vz = Math.sin(dir) * speed
    p.vy = (Math.random() - 0.5) * 0.25

    p.bobPhase = Math.random() * Math.PI * 2
    p.bobSpeed = 0.3 + Math.random() * 0.4
    p.bobAmp = 0.08 + Math.random() * 0.16

    p.fadeInDur = 0.6 + Math.random() * 0.7
    p.showDur = 2.5 + Math.random() * 2.5
    p.fadeOutDur = 0.8 + Math.random() * 0.8
    p.deadDur = 5 + Math.random() * 6
    p.peak = 0.62 + Math.random() * 0.38

    p.glitching = false
    p.nextGlitchAt = this.localT + p.fadeInDur + 0.5 + Math.random() * 2.5
    p.glitchEndsAt = 0

    p.state = FADEIN
    p.stateT = 0
    p.mesh.position.set(p.ax, p.ay, p.az)
    p.mesh.visible = true
    this.draw(p, false)
  }

  // Paint the fragment. glitch=true scrambles glyphs and RGB-splits the passes.
  private draw(p: Intercept, glitch: boolean): void {
    const ctx = p.ctx
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'

    // Fit the (clean) phrase to the canvas width, keep that size for glitches.
    let fpx = FONT_PX
    ctx.font = `${fpx}px ${MONO_FONT}`
    const maxW = CANVAS_W - PAD_X * 2
    const w = ctx.measureText(p.phrase).width
    if (w > maxW) {
      fpx = Math.max(12, Math.floor((fpx * maxW) / w))
      ctx.font = `${fpx}px ${MONO_FONT}`
    }

    const cx = CANVAS_W / 2
    const cy = CANVAS_H / 2
    const text = glitch ? scramble(p.phrase) : p.phrase

    if (glitch) {
      // RGB-split: offset red + blue ghosts behind the main pass.
      const dx = 2 + ((Math.random() * 3) | 0)
      const jy = (Math.random() - 0.5) * 3
      ctx.shadowBlur = 0
      ctx.globalAlpha = 0.6
      ctx.fillStyle = this.palette.warningStr
      ctx.fillText(text, cx + dx, cy + jy)
      ctx.fillStyle = this.palette.hologramStr
      ctx.fillText(text, cx - dx, cy - jy)
    }

    // Main phosphor pass with glow.
    ctx.globalAlpha = 1
    ctx.shadowColor = this.palette.phosphorStr
    ctx.shadowBlur = glitch ? 6 : 12
    ctx.fillStyle = this.palette.phosphorStr
    ctx.fillText(text, cx + (glitch ? (Math.random() - 0.5) * 2 : 0), cy)

    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
    p.tex.needsUpdate = true
  }

  update(ctx: FeatureContext): void {
    const step = ctx.dt * ctx.motion
    this.localT += step
    const lt = this.localT
    const audio = ctx.audio
    let budget = REDRAW_BUDGET

    for (const p of this.items) {
      // --- lifecycle ------------------------------------------------------
      if (p.state === DEAD) {
        if (lt >= p.respawnAt && budget > 0) {
          this.respawn(p)
          budget--
        }
        continue // stays hidden until it (re)spawns
      }

      p.stateT += step

      if (p.state === FADEIN && p.stateT >= p.fadeInDur) {
        p.state = SHOW
        p.stateT = 0
      } else if (p.state === SHOW && p.stateT >= p.showDur) {
        p.state = FADEOUT
        p.stateT = 0
      } else if (p.state === FADEOUT && p.stateT >= p.fadeOutDur) {
        p.state = DEAD
        p.stateT = 0
        p.respawnAt = lt + p.deadDur
        p.glitching = false
        p.mesh.visible = false
        p.mat.opacity = 0
        continue
      }

      // --- glitches (only while fully present) ----------------------------
      if (p.state === SHOW) {
        // Loud audio jolts an extra glitch in early.
        if (!p.glitching && audio > 0.6 && lt >= p.nextGlitchAt - 1.5) {
          p.nextGlitchAt = lt
        }
        if (!p.glitching && lt >= p.nextGlitchAt && budget > 0) {
          p.glitching = true
          p.glitchEndsAt = lt + 0.12 + Math.random() * 0.12
          this.draw(p, true)
          budget--
        } else if (p.glitching && lt >= p.glitchEndsAt) {
          if (budget > 0) {
            p.glitching = false
            p.nextGlitchAt = lt + 1.5 + Math.random() * 2.8
            this.draw(p, false)
            budget--
          } else {
            // No redraw budget this frame — hold the scramble one more frame.
            p.glitchEndsAt = lt + 0.05
          }
        }
      }

      // --- drift + bob + glitch jitter ------------------------------------
      p.ax += p.vx * step
      p.ay += p.vy * step
      p.az += p.vz * step
      const bob = Math.sin(lt * p.bobSpeed + p.bobPhase) * p.bobAmp
      let jx = 0
      let jy = 0
      if (p.glitching) {
        jx = (Math.random() - 0.5) * 0.14
        jy = (Math.random() - 0.5) * 0.14
      }
      p.mesh.position.set(p.ax + jx, p.ay + bob + jy, p.az)

      // billboard toward the live camera
      p.mesh.lookAt(ctx.camera.position)

      // --- opacity envelope ----------------------------------------------
      let env: number
      if (p.state === FADEIN) {
        env = p.fadeInDur > 0 ? p.stateT / p.fadeInDur : 1
      } else if (p.state === FADEOUT) {
        env = p.fadeOutDur > 0 ? 1 - p.stateT / p.fadeOutDur : 0
      } else {
        env = 1
      }
      // subtle flicker + a brief brighten on glitch + audio lift
      const flicker = 0.9 + 0.1 * Math.sin(lt * 9 + p.bobPhase)
      const glitchLift = p.glitching ? 1.3 : 1
      p.mat.opacity = THREE.MathUtils.clamp(
        p.peak * env * flicker * glitchLift * (1 + audio * 0.3),
        0,
        1,
      )
    }
  }

  dispose(): void {
    for (const p of this.items) {
      this.group.remove(p.mesh)
      p.mat.dispose()
      p.tex.dispose()
    }
    this.geo.dispose()
    this.items.length = 0
  }
}
