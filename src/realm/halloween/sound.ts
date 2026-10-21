import * as THREE from 'three'
import type { AmbienceDress } from '../ambience'
import { onFlash, hallow } from './state'

// The night's sound, behind the sound switch: a soft bed of rain on leaves
// and stone, its patter on the pond when the visitor is near the water, and
// far thunder that rolls in low a few seconds after each flash, longer after
// the one in the ghost. All of it from noise made here; nothing ships.

// deep noise for the thunder: white noise integrated, so its weight is low
function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buffer.getChannelData(ch)
    let b = 0
    for (let i = 0; i < length; i++) {
      b = (b + (Math.random() * 2 - 1) * 0.02) * 0.998
      d[i] = b * 3.2
    }
  }
  return buffer
}

class NightSound implements AmbienceDress {
  private ctx: AudioContext | null = null
  private out: AudioNode | null = null
  private bed: GainNode | null = null
  private hiss: GainNode | null = null
  private onWater: { gain: GainNode; filter: BiquadFilterNode } | null = null
  private patter: GainNode | null = null
  private rumble: AudioBuffer | null = null
  private patterTimer = 0
  private t = 0
  private off: (() => void) | null = null

  build(ctx: AudioContext, out: AudioNode, noise: { pink: AudioBuffer; white: AudioBuffer }): void {
    this.ctx = ctx
    this.out = out
    const loop = (buffer: AudioBuffer, rate: number) => {
      const s = ctx.createBufferSource()
      s.buffer = buffer
      s.loop = true
      s.playbackRate.value = rate
      s.start(0, Math.random() * buffer.duration)
      return s
    }
    const chain = (src: AudioNode, ...nodes: AudioNode[]) => nodes.reduce((a, b) => a.connect(b), src)

    // the bed: rain on leaves, moss and stone all around, soft and wide
    {
      const hp = ctx.createBiquadFilter()
      hp.type = 'highpass'
      hp.frequency.value = 350
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 5200
      lp.Q.value = 0.3
      this.bed = ctx.createGain()
      this.bed.gain.value = 0
      chain(loop(noise.pink, 0.83), hp, lp, this.bed, out)
    }
    // its fine top: drops on near leaves
    {
      const bp = ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = 6500
      bp.Q.value = 0.5
      this.hiss = ctx.createGain()
      this.hiss.gain.value = 0
      chain(loop(noise.white, 0.91), bp, this.hiss, out)
    }
    // rain on the water: a brighter, busier hush near the pond
    {
      const filter = ctx.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 2800
      filter.Q.value = 1.1
      const gain = ctx.createGain()
      gain.gain.value = 0
      chain(loop(noise.white, 1.07), filter, gain, out)
      this.onWater = { gain, filter }
    }
    this.patter = ctx.createGain()
    this.patter.gain.value = 0
    this.patter.connect(out)
    this.rumble = brownNoise(ctx, 12)
    this.off = onFlash((strength, _dir, ghost) => this.thunder(strength, ghost))
  }

  // one roll of thunder, a few seconds after its flash: it swells in, rolls
  // in two or three slow surges and dies away, all below a couple of hundred
  // hertz, so it never cracks
  private thunder(strength: number, ghost: boolean): void {
    const ctx = this.ctx
    if (!ctx || !this.out || !this.rumble || ctx.state !== 'running') return
    const delay = ghost ? 4.5 + Math.random() * 1.5 : 3 + Math.random() * 3
    const length = ghost ? 9 + Math.random() * 2 : 5 + Math.random() * 2.5
    const start = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.rumble
    src.playbackRate.value = 0.8 + Math.random() * 0.25
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(ghost ? 210 : 170, start)
    lp.frequency.exponentialRampToValueAtTime(70, start + length)
    lp.Q.value = 0.5
    const pan = ctx.createStereoPanner()
    pan.pan.value = (Math.random() - 0.5) * 0.8
    const g = ctx.createGain()
    const peak = (ghost ? 0.5 : 0.36) * Math.min(1, 0.4 + strength * 0.7)
    g.gain.setValueAtTime(0, start)
    g.gain.linearRampToValueAtTime(peak * 0.6, start + 0.7)
    const surges = ghost ? 3 : 2
    for (let i = 0; i < surges; i++) {
      const at = start + 0.9 + (i * length * 0.45) / surges + Math.random() * 0.4
      g.gain.linearRampToValueAtTime(peak * (1 - i * 0.22), at)
      g.gain.linearRampToValueAtTime(peak * (0.45 - i * 0.08), at + 0.9)
    }
    g.gain.setTargetAtTime(0, start + length * 0.6, length * 0.16)
    src.connect(lp).connect(pan).connect(g).connect(this.out)
    src.start(start, Math.random() * (this.rumble.duration - length - 1))
    src.stop(start + length + 2)
  }

  // a single drop on the water: a tiny falling tone
  private drop(level: number): void {
    const ctx = this.ctx
    if (!ctx || !this.patter) return
    const now = ctx.currentTime
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    const f = 1400 + Math.random() * 2600
    o.frequency.setValueAtTime(f, now)
    o.frequency.exponentialRampToValueAtTime(f * 0.6, now + 0.05)
    g.gain.setValueAtTime(0, now)
    g.gain.linearRampToValueAtTime(0.012 * level * (0.4 + Math.random() * 0.6), now + 0.003)
    g.gain.exponentialRampToValueAtTime(1e-4, now + 0.06)
    o.connect(g).connect(this.patter)
    o.start(now)
    o.stop(now + 0.07)
  }

  update(dt: number, _camera: THREE.Vector3, water: number): void {
    const ctx = this.ctx
    if (!ctx || !this.bed || !this.hiss || !this.onWater || !this.patter) return
    this.t += dt
    const now = ctx.currentTime
    const rain = hallow.uRain.value
    // the rain comes and goes a little in long slow waves
    const swell = 0.85 + 0.15 * Math.sin(this.t * 0.07) * Math.sin(this.t * 0.031 + 2)
    this.bed.gain.setTargetAtTime(0.085 * rain * swell, now, 0.8)
    this.hiss.gain.setTargetAtTime(0.018 * rain * swell, now, 0.8)
    const near = THREE.MathUtils.smoothstep(water, 0.2, 1)
    this.onWater.gain.gain.setTargetAtTime(0.05 * rain * near, now, 0.6)
    this.onWater.filter.frequency.setTargetAtTime(2600 + Math.sin(this.t * 1.3) * 300, now, 0.3)
    this.patter.gain.setTargetAtTime(1, now, 0.3)
    this.patterTimer -= dt
    if (this.patterTimer <= 0) {
      if (near > 0.05) this.drop(near * rain)
      this.patterTimer = 0.02 + Math.random() * (0.12 / Math.max(near, 0.1))
    }
  }

  dispose(): void {
    this.off?.()
    this.off = null
    this.ctx = null
  }
}

// what the garden's sound wears (read by Ambience); one per load, made when
// the audio is first built
export const sound: AmbienceDress = new NightSound()
