import * as THREE from 'three'
import { OUTFLOW, POND_BOUNDS } from './layout'
import { dressFor } from './season'

// Water and wind, made from noise at runtime: no recordings ship. Wind is
// pink noise through a slowly breathing low-pass, swelling with the gusts.
// The water is two layers: the pond's outflow trickling over stones (band
// passed noise with small random drops) and, under it, the far rush of the
// fall. Both follow the camera: the water grows as the visitor nears the pond
// and the rim. Silent until the visitor turns it on; browsers only start
// audio from a gesture anyway.

function noiseBuffer(ctx: AudioContext, seconds: number, pink: boolean): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch)
    let b0 = 0
    let b1 = 0
    let b2 = 0
    let b3 = 0
    let b4 = 0
    let b5 = 0
    let b6 = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      if (!pink) {
        d[i] = w * 0.5
        continue
      }
      // Paul Kellet's pink filter
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.8665 * b3 + w * 0.3104856
      b4 = 0.55 * b4 + w * 0.5329522
      b5 = -0.7616 * b5 - w * 0.016898
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11
      b6 = w * 0.115926
    }
  }
  return buffer
}

// What a season adds to the sound: its own layers on the same master, so
// the switch silences them with the rest.
export interface AmbienceDress {
  build(ctx: AudioContext, out: AudioNode, noise: { pink: AudioBuffer; white: AudioBuffer }): void
  // water: how near the pond is, 0.12 far to 1 beside it; steer: whether to
  // move the layers' levels this frame, a few times a second
  update(dt: number, camera: THREE.Vector3, water: number, steer: boolean): void
  dispose(): void
}

export class Ambience {
  private dress: AmbienceDress | null = null
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private trickle: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private rush: GainNode | null = null
  private drops: GainNode | null = null
  private enabled = false
  private dropTimer = 0
  private steerTimer = 0
  private sleepTimer = 0
  private t = 0
  private pond = new THREE.Vector3((POND_BOUNDS.xMin + POND_BOUNDS.xMax) / 2, 0, (POND_BOUNDS.zMin + POND_BOUNDS.zMax) / 2)
  private fall = new THREE.Vector3(OUTFLOW.x1, -2, OUTFLOW.z1)

  get on(): boolean {
    return this.enabled
  }

  // call from a click or key handler
  setEnabled(on: boolean): void {
    this.enabled = on
    if (on && !this.ctx) this.build()
    const ctx = this.ctx
    if (!ctx || !this.master) return
    window.clearTimeout(this.sleepTimer)
    if (on) void ctx.resume()
    const now = ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.8 : 0.25)
    // once faded out the graph sleeps, so a muted garden costs the phone nothing
    if (!on) this.sleepTimer = window.setTimeout(() => void ctx.suspend(), 1500)
  }

  private build(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    const ctx = new Ctor()
    this.ctx = ctx
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    this.master = master

    const pink = noiseBuffer(ctx, 6, true)
    const white = noiseBuffer(ctx, 4, false)
    const loop = (buffer: AudioBuffer, rate = 1) => {
      const s = ctx.createBufferSource()
      s.buffer = buffer
      s.loop = true
      s.playbackRate.value = rate
      s.start(0, Math.random() * buffer.duration)
      return s
    }

    // wind
    {
      const src = loop(pink, 0.9)
      const filter = ctx.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = 500
      filter.Q.value = 0.4
      const gain = ctx.createGain()
      gain.gain.value = 0.0
      src.connect(filter).connect(gain).connect(master)
      this.wind = { gain, filter }
    }
    // the outflow over stones
    {
      const src = loop(white)
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 900
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 2400
      filter.Q.value = 0.7
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(hp).connect(filter).connect(gain).connect(master)
      this.trickle = { gain, filter }
    }
    // the fall, far below
    {
      const src = loop(pink, 0.6)
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 380
      const gain = ctx.createGain()
      gain.gain.value = 0
      src.connect(lp).connect(gain).connect(master)
      this.rush = gain
    }
    const drops = ctx.createGain()
    drops.gain.value = 0
    drops.connect(master)
    this.drops = drops
    this.dress = dressFor<AmbienceDress>('Ambience')
    this.dress?.build(ctx, master, { pink, white })
  }

  // the shrine bell: a few inharmonic partials that ring out slowly
  bell(): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.enabled) return
    const now = ctx.currentTime
    for (const [ratio, level, decay] of [[1, 0.12, 2.6], [2.76, 0.05, 1.6], [5.4, 0.025, 0.9], [8.9, 0.012, 0.5]] as const) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 330 * ratio
      g.gain.setValueAtTime(0, now)
      g.gain.linearRampToValueAtTime(level, now + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, now + decay)
      o.connect(g).connect(this.master)
      o.start(now)
      o.stop(now + decay + 0.05)
    }
  }

  // two boards of thin hinoki striking: a dry click of filtered noise over a
  // short hollow tone, quieter for a light touch
  knock(level: number, pan: number): void {
    const ctx = this.ctx
    if (!ctx || !this.master || !this.enabled || level < 0.04) return
    const now = ctx.currentTime
    const v = Math.min(1, level)
    const out = ctx.createStereoPanner()
    out.pan.value = Math.max(-1, Math.min(1, pan))
    out.connect(this.master)
    const len = Math.round(ctx.sampleRate * 0.05)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.12))
    const click = ctx.createBufferSource()
    click.buffer = buf
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 1900 + Math.random() * 500
    bp.Q.value = 2.2
    const cg = ctx.createGain()
    cg.gain.value = 0.11 * v
    click.connect(bp).connect(cg).connect(out)
    click.start(now)
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    const f = 720 + Math.random() * 120
    o.frequency.setValueAtTime(f, now)
    o.frequency.exponentialRampToValueAtTime(f * 0.92, now + 0.07)
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(0.045 * v, now + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08)
    o.connect(g).connect(out)
    o.start(now)
    o.stop(now + 0.1)
  }

  // a single drop: a short sine that falls in pitch, like water on water
  private drop(level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.drops) return
    const now = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    const f = 900 + Math.random() * 1600
    o.frequency.setValueAtTime(f, now)
    o.frequency.exponentialRampToValueAtTime(f * 0.55, now + 0.06)
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(0.05 * level * (0.4 + Math.random() * 0.6), now + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
    const pan = ctx.createStereoPanner()
    pan.pan.value = Math.random() * 1.2 - 0.6
    o.connect(g).connect(pan).connect(this.drops)
    o.start(now)
    o.stop(now + 0.1)
  }

  update(dt: number, camera: THREE.Vector3, gust: number): void {
    if (!this.enabled || !this.ctx || !this.wind || !this.trickle || !this.rush || !this.drops) return
    this.t += dt
    const now = this.ctx.currentTime
    const dPond = camera.distanceTo(this.pond)
    const water = THREE.MathUtils.clamp(1.4 - dPond / 18, 0.12, 1)
    // the levels glide over a good part of a second, so steering them ten
    // times a second sounds the same as every frame and keeps each param's
    // list of scheduled changes short
    this.steerTimer -= dt
    const steer = this.steerTimer <= 0
    if (steer) {
      this.steerTimer = 0.1
      const breathe = 0.5 + 0.5 * Math.sin(this.t * 0.23) * Math.sin(this.t * 0.11 + 1)
      this.wind.gain.gain.setTargetAtTime(0.16 + gust * 0.22 + breathe * 0.06, now, 0.6)
      this.wind.filter.frequency.setTargetAtTime(320 + gust * 700 + breathe * 200, now, 0.8)
      const dFall = camera.distanceTo(this.fall)
      this.trickle.gain.gain.setTargetAtTime(0.05 * water, now, 0.5)
      this.trickle.filter.frequency.setTargetAtTime(2000 + Math.sin(this.t * 1.7) * 400, now, 0.2)
      this.rush.gain.setTargetAtTime(THREE.MathUtils.clamp(1.3 - dFall / 40, 0.15, 1) * 0.12, now, 0.6)
      this.drops.gain.setTargetAtTime(1, now, 0.3)
    }
    this.dropTimer -= dt
    if (this.dropTimer <= 0) {
      this.drop(water)
      this.dropTimer = 0.05 + Math.random() * (0.5 / water)
    }
    this.dress?.update(dt, camera, water, steer)
  }

  dispose(): void {
    window.clearTimeout(this.sleepTimer)
    this.dress?.dispose()
    void this.ctx?.close()
    this.ctx = null
  }
}
