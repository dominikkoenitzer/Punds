// A self-contained ambient "Wired hum": a low detuned drone through a lowpass,
// its level slowly modulated by an LFO so the analysed bass band breathes. The
// scene reads level() each frame to drive bloom / core scale / particle glow.
// Must be resume()'d from a user gesture (autoplay policy).

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

export class AudioEngine {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private data: Uint8Array<ArrayBuffer> | null = null
  private outGain: GainNode | null = null
  private lp: BiquadFilterNode | null = null
  private muted = false
  private started = false
  private smoothed = 0

  resume(): void {
    if (this.started) {
      void this.ctx?.resume()
      return
    }
    this.started = true
    try {
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      this.ctx = ctx

      const master = ctx.createGain()
      master.gain.value = 0.035 // very low ambient hum
      const out = ctx.createGain()
      out.gain.value = this.muted ? 0 : 1
      master.connect(out)
      out.connect(ctx.destination)
      this.outGain = out

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      this.analyser = analyser
      this.data = new Uint8Array(analyser.frequencyBinCount)
      master.connect(analyser) // pre-mute, so visuals keep reacting when muted

      // low drone: a few detuned saws through a lowpass
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 240
      lp.connect(master)
      this.lp = lp
      for (const [freq, detune] of [[55, -5], [55, 7], [110, 3]] as const) {
        const osc = ctx.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = freq
        osc.detune.value = detune
        const g = ctx.createGain()
        g.gain.value = 0.5
        osc.connect(g)
        g.connect(lp)
        osc.start()
      }

      // slow LFO on the master gain so the bass level breathes
      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.18
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 0.02
      lfo.connect(lfoGain)
      lfoGain.connect(master.gain)
      lfo.start()
    } catch {
      this.analyser = null
    }
  }

  level(): number {
    const a = this.analyser
    const d = this.data
    if (!a || !d) return 0
    a.getByteFrequencyData(d)
    const n = Math.max(1, Math.floor(d.length / 8)) // bass band
    let sum = 0
    for (let i = 0; i < n; i++) sum += d[i]
    const raw = sum / n / 255
    this.smoothed += (raw - this.smoothed) * 0.1
    return this.smoothed
  }

  setMuted(m: boolean): void {
    this.muted = m
    if (this.outGain) this.outGain.gain.value = m ? 0 : 1
  }

  // 0..1 idle dread: drop the lowpass so the hum sinks lower / muddier.
  setDread(d: number): void {
    if (this.lp) this.lp.frequency.value = 240 - d * 130
  }

  isMuted(): boolean {
    return this.muted
  }

  dispose(): void {
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
    this.data = null
    this.outGain = null
  }
}
