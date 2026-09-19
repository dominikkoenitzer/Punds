import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoplandScene, CoplandPhase } from '../scene/coplandScene'
import { NaviVoice } from '../scene/naviVoice'
import { PANEL_DATA } from '../scene/panelData'
import './CoplandOS.css'

// COPLAND OS ENTERPRISE :: produced by Tachibana Lab
// A 3D NAVI boot/desktop experience. The heavy Three.js scene lives in
// ../scene/coplandScene and is lazy-loaded through a dynamic import, so the
// React boot shell paints immediately while three streams in behind the boot
// sequence.
// This layer drives boot phases and the crisp DOM overlay (boot log, operator
// welcome). The desktop itself carries no HUD: once you're in, only the scene
// and the CRT texture remain on screen.

// The NAVI addresses its operator by name on boot. Retune freely.
const OPERATOR = 'LAIN'

const BOOT_LINES: string[] = [
  'TACHIBANA GENERAL LABORATORIES',
  'COPLAND OS ENTERPRISE',
  '',
  '> communication OS ................. superseded',
  '> initializing NAVI kernel ........ OK',
  '> mounting /dev/psyche ............ OK',
  '> calibrating phosphor array ...... OK',
  '> 7th generation wired protocol ... OK',
  '> protocol 7 handshake ............ OK',
  '> voice recognition ............... ready',
  '> speech synthesis ................ ready',
  '> carrier lock :: 7.83 Hz ......... OK',
  '> opening the WIRED ............... OK',
  '> layer 07 synchronised',
  '> no matter where you go, everyone is connected',
]

function supportsWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function CoplandOS() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CoplandScene | null>(null)
  const voiceRef = useRef<NaviVoice | null>(null)
  const phaseRef = useRef<CoplandPhase>('logo')
  const skipArmedRef = useRef(false)

  const [phase, setPhase] = useState<CoplandPhase>('logo')
  const [bootLines, setBootLines] = useState<string[]>([])
  const [skipped, setSkipped] = useState(false)
  const [muted, setMuted] = useState(false)
  const mutedRef = useRef(false)
  const [webglFailed] = useState(() => !supportsWebGL())
  const [sceneFailed, setSceneFailed] = useState(false)
  // no scene is ever coming: the written fallback owns the screen
  const noScene = webglFailed || sceneFailed

  // filling the log first keeps the skip off a half-written screen; `skipped` drops the boot timers
  const skipBoot = useCallback(() => {
    setSkipped(true)
    setBootLines(BOOT_LINES)
    setPhase('desktop')
  }, [])

  // --- scene lifecycle (lazy-loads the heavy Three.js layer) ----------------
  useEffect(() => {
    const container = containerRef.current
    if (!container || webglFailed) return
    let scene: CoplandScene | null = null
    let cancelled = false
    void (async () => {
      try {
        const mod = await import('../scene/coplandScene')
        if (cancelled) return
        scene = new mod.CoplandScene(container, { onActivate: skipBoot })
        sceneRef.current = scene
        scene.start()
        scene.setPhase(phaseRef.current) // sync to whatever phase we reached while loading
        scene.setMuted(mutedRef.current)
      } catch {
        // chunk never arrived or init threw: show the written fallback instead of a blank canvas
        sceneRef.current = null
        if (!cancelled) setSceneFailed(true)
      }
    })()
    return () => {
      cancelled = true
      scene?.dispose()
      sceneRef.current = null
    }
  }, [webglFailed, skipBoot])

  // --- NAVI voice -----------------------------------------------------------
  useEffect(() => {
    voiceRef.current = new NaviVoice()
    return () => {
      voiceRef.current?.dispose()
      voiceRef.current = null
    }
  }, [])

  // --- drive the scene from the boot phase (+ NAVI greets on welcome) --------
  useEffect(() => {
    phaseRef.current = phase
    sceneRef.current?.setPhase(phase)
    if (phase === 'welcome') {
      const v = voiceRef.current
      v?.speak('present day. present time.')
      v?.speak(`welcome, ${OPERATOR}`, { delay: 2200, pitch: 0.62 })
    }
  }, [phase])

  // --- boot orchestration ---------------------------------------------------
  useEffect(() => {
    if (skipped) return
    let cancelled = false
    const timers: number[] = []
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(() => { if (!cancelled) fn() }, ms))
    }

    at(3000, () => setPhase('boot'))
    BOOT_LINES.forEach((line, i) => at(3300 + i * 250, () => setBootLines((p) => [...p, line])))
    const bootEnd = 3300 + BOOT_LINES.length * 250
    at(bootEnd + 500, () => setPhase('welcome'))
    at(bootEnd + 3600, () => setPhase('desktop'))

    return () => {
      cancelled = true
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [skipped])

  // --- mute: keep a ref + push to the scene's audio and the NAVI voice -------
  useEffect(() => {
    mutedRef.current = muted
    sceneRef.current?.setMuted(muted)
    voiceRef.current?.setMuted(muted)
  }, [muted])

  // --- NAVI whispers once you're in --------------------------------------
  useEffect(() => {
    if (phase !== 'desktop') return
    const WHISPERS = [
      'are you there',
      'who is there',
      'you are not alone',
      'i am still here',
      'do you remember',
      'i see you',
      'we are connected',
      'the signal is clear',
    ]
    const id = window.setInterval(() => {
      if (mutedRef.current) return
      const dread = sceneRef.current?.getDread() ?? 0
      if (Math.random() > 0.2 + dread * 0.65) return // more often the longer you're still
      const line = WHISPERS[Math.floor(Math.random() * WHISPERS.length)]
      voiceRef.current?.speak(line, { pitch: 0.58 - dread * 0.08, rate: 0.8, volume: 0.55 + dread * 0.25 })
    }, 15000)
    return () => window.clearInterval(id)
  }, [phase])

  // --- shortcuts: M mutes ---------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'm') setMuted((m) => !m)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="copland-root"
      onPointerDown={(e) => {
        // arm only on gestures the scene cannot see: primary button, no scene yet, one still coming
        skipArmedRef.current = e.button === 0 && !sceneRef.current && !noScene
      }}
      onPointerUp={() => {
        const armed = skipArmedRef.current
        skipArmedRef.current = false
        if (armed && phase !== 'desktop') skipBoot()
      }}
    >
      {/* Decoration: everything the canvas draws is also written out for real
          in the .copland-sr fallback below. */}
      <div aria-hidden="true" className="copland-canvas" ref={containerRef} />

      {/* ambient overlays: always on, the "constant motion" */}
      <div className="copland-scan" aria-hidden="true" />
      <div className="copland-grain" aria-hidden="true" />
      <div className="copland-vignette" aria-hidden="true" />

      {/* the visual chrome is decorative + duplicated by the .copland-sr fallback,
          so hide it from assistive tech (real controls live outside this div) */}
      <div className="copland-overlay" aria-hidden="true">
        {/* boot splash caption (logo itself is rendered in 3D) */}
        {(phase === 'logo' || phase === 'boot') && (
          <>
            <div className={`copland-splash${phase === 'boot' ? ' is-dim' : ''}`}>
              <div className="copland-wordmark">Copland OS Enterprise</div>
              <div className="copland-tachibana">Produced By Tachibana Lab</div>
            </div>
            <div className="copland-skiphint">click anywhere to skip</div>
          </>
        )}

        {/* streaming boot log */}
        {phase === 'boot' && (
          <pre className="copland-bootlog">
            {bootLines.join('\n')}
            <span className="copland-caret">_</span>
          </pre>
        )}

        {/* present day / operator welcome */}
        {phase === 'welcome' && (
          <div className="copland-welcome">
            <div className="copland-presentday">
              <span>present day</span>
              <span>present time</span>
            </div>
            <div className="copland-operator">
              WELCOME, <b>{OPERATOR}</b>
            </div>
          </div>
        )}

      </div>

      {/* accessible / no-WebGL fallback: real content for screen readers + crawlers */}
      <main className={noScene ? 'copland-fallback' : 'copland-sr'}>
        <h1>Copland OS Enterprise :: punds.ch</h1>
        <p>A Serial Experiments Lain NAVI terminal. Access points:</p>
        <nav>
          {PANEL_DATA.filter((d) => d.kind === 'link').map((d) => (
            <a key={d.label} href={d.href} target="_blank" rel="noopener noreferrer">
              {d.label} :: {d.lines[0]}
            </a>
          ))}
        </nav>
      </main>
    </div>
  )
}
