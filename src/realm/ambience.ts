import * as THREE from 'three'
import { OUTFLOW, POND_BOUNDS } from './layout'

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

export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private trickle: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private rush: GainNode | null = null
  private drops: GainNode | null = null
  private enabled = false
  private dropTimer = 0
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
    if (on) void ctx.resume()
    const now = ctx.currentTime
    this.master.gain.cancelScheduledValues(now)
    this.master.gain.setTargetAtTime(on ? 1 : 0, now, on ? 0.8 : 0.25)
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
    const breathe = 0.5 + 0.5 * Math.sin(this.t * 0.23) * Math.sin(this.t * 0.11 + 1)
    this.wind.gain.gain.setTargetAtTime(0.16 + gust * 0.22 + breathe * 0.06, now, 0.6)
    this.wind.filter.frequency.setTargetAtTime(320 + gust * 700 + breathe * 200, now, 0.8)
    const dPond = camera.distanceTo(this.pond)
    const dFall = camera.distanceTo(this.fall)
    const water = THREE.MathUtils.clamp(1.4 - dPond / 18, 0.12, 1)
    this.trickle.gain.gain.setTargetAtTime(0.05 * water, now, 0.5)
    this.trickle.filter.frequency.setTargetAtTime(2000 + Math.sin(this.t * 1.7) * 400, now, 0.2)
    this.rush.gain.setTargetAtTime(THREE.MathUtils.clamp(1.3 - dFall / 40, 0.15, 1) * 0.12, now, 0.6)
    this.drops.gain.setTargetAtTime(1, now, 0.3)
    this.dropTimer -= dt
    if (this.dropTimer <= 0) {
      this.drop(water)
      this.dropTimer = 0.05 + Math.random() * (0.5 / water)
    }
  }

  dispose(): void {
    void this.ctx?.close()
    this.ctx = null
  }
}
