// The NAVI speaks. A thin wrapper over the Web Speech API for eerie,
// low-pitched system utterances on boot. No-ops where speech is unavailable or
// blocked. Browsers may gate speech until the first user interaction.

export class NaviVoice {
  private synth: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
  private voice: SpeechSynthesisVoice | null = null

  constructor() {
    const synth = this.synth
    if (!synth) return
    const pick = (): void => {
      const voices = synth.getVoices()
      this.voice = voices.find((v) => /en[-_]/i.test(v.lang)) ?? voices[0] ?? null
    }
    pick()
    synth.addEventListener('voiceschanged', pick)
  }

  speak(text: string, opts?: { rate?: number; pitch?: number; volume?: number; delay?: number }): void {
    const synth = this.synth
    if (!synth) return
    const u = new SpeechSynthesisUtterance(text)
    if (this.voice) u.voice = this.voice
    u.rate = opts?.rate ?? 0.86
    u.pitch = opts?.pitch ?? 0.68
    u.volume = opts?.volume ?? 0.9
    const go = (): void => synth.speak(u)
    if (opts?.delay) window.setTimeout(go, opts.delay)
    else go()
  }

  cancel(): void {
    this.synth?.cancel()
  }
}
