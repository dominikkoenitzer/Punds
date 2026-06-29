import { useState, useEffect, useRef } from 'react'
import { FaGithub, FaPaypal, FaGlobe, FaBook } from 'react-icons/fa'
import './Home.css'

// ============================================================================
// CONSTANTS
// ============================================================================

const SECRET_FILES: { [key: string]: string } = {
  'SYSTEM/REALITY.DLL': `
> File: REALITY.DLL
> Status: CORRUPTED
> Type: SYSTEM_CRITICAL

ERROR: Reality module not responding
WARNING: Consensus breach detected
INFO: Multiple realities detected

Question: Which reality is real?
Answer: All of them. None of them.

The Wired is as real as the real world.
  `,
  'DATA/MESSAGE.HEX': `
> File: MESSAGE.HEX
> Encoding: HEXADECIMAL
> Decoder: MESSAGE.DECODER

4E 6F 20 6D 61 74 74 65 72 20 77 68 65 72 65 20
79 6F 75 20 61 72 65 2C 20 65 76 65 72 79 6F 6E
65 20 69 73 20 61 6C 77 61 79 73 20 63 6F 6E 6E
65 63 74 65 64 2E
  `,
  'SECRETS/LAIN.LOG': `
> File: LAIN.LOG
> Access Level: RESTRICTED
> Location: THE_WIRED

"No matter where you are,
everyone is always connected."

You are not alone.
You have never been alone.
The network remembers everything.

LET'S ALL LOVE LAIN
  `,
  'DATA/WIRED_ACCESS.KEY': `
> File: WIRED_ACCESS.KEY
> Type: CRYPTOGRAPHIC_KEY
> Access: RESTRICTED

-----BEGIN WIRED KEY-----
476F6420697320686572652E
-----END WIRED KEY-----
  `,
  'SYSTEM/KNIGHTS.DAT': `
> File: KNIGHTS.DAT
> Organization: THE_KNIGHTS
> Status: ENCRYPTED

The Knights of the Eastern Calculus
Protecting the barriers between
The Wired and reality...

Or are they creating them?
  `,
}

const BOOT_LINES = [
  '> NAVI SYSTEM v7.0.1',
  '> WIRED_TECH INDUSTRIES BIOS REV.13',
  '',
  '> INITIALIZING HARDWARE...',
  '> DETECTING MEMORY BANKS...        [OK]',
  '> LOADING WIRED PROTOCOLS...       [OK]',
  '> ESTABLISHING NODE CONNECTION...',
  '  [████████████████████] LINKED',
  '> SCANNING MEMORY SECTORS...       [OK]',
  '> CALIBRATING REALITY MODULE...',
  '  WARNING: CONSENSUS_LAYER unstable',
  '  WARNING: MULTIPLE_REALITIES detected',
  '> LOADING USER_PROFILE::DOMINIK_KOENITZER...',
  '',
  '  PRESENT DAY.  PRESENT TIME.',
  '',
  '> SYSTEM READY.',
]

const IDLE_QUOTES = [
  { l1: 'present day,', l2: 'present time.' },
  { l1: '"no matter where you go,', l2: "everybody's connected.\"" },
  { l1: '"the wired is', l2: 'as real as the real world."' },
  { l1: '"close the world,', l2: 'open the next."' },
  { l1: '"if you are not remembered,', l2: 'did you ever exist?"' },
]


const FLOAT_MSGS = [
  '> SIGNAL_DETECTED',
  '> WIRED_NODE_ACTIVE',
  '> 7F 3A C2 09',
  '> LAYER_07',
  '> TRANSMISSION_RECV',
  '> NODE_BROADCAST',
  '> 4E 6F 20 62 61 72',
  '> REALITY: UNSTABLE',
  '> CONNECTED',
  '> PRESENCE_CONFIRMED',
  '> UPLOADING...',
  '> CONSENSUS: 67%',
  '> WIRED_v2 ACTIVE',
  '> PACKET_FLOW',
  '> NO_BARRIERS',
  '> 65 76 65 72 79',
  '> LAYER_SHIFT',
  '> SYNC_OK',
]

// ============================================================================
// OSCILLOSCOPE
// ============================================================================

const Oscilloscope: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animFrame: number
    let t = 0
    const dpr = window.devicePixelRatio || 1
    let lw = 0, lh = 0  // logical (CSS) dimensions

    let glitchTimer = 0
    let isGlitching = false
    let glitchIntensity = 0
    let isDropout = false
    let dropoutTimer = 0
    let phaseShift = 0
    let targetPhase = 0
    let freqMod = 1.0
    let targetFreq = 1.0

    const resize = () => {
      const p = canvas.parentElement
      if (!p) return
      const rect = p.getBoundingClientRect()
      lw = rect.width
      lh = rect.height
      canvas.width  = Math.round(lw * dpr)
      canvas.height = Math.round(lh * dpr)
      canvas.style.width  = lw + 'px'
      canvas.style.height = lh + 'px'
    }
    resize()
    const ro = new ResizeObserver(resize)
    if (canvas.parentElement) ro.observe(canvas.parentElement)

    document.fonts.load('10px TrixieCyrG').finally(() => { animFrame = requestAnimationFrame(draw) })

    const draw = () => {
      t += 0.018
      // Re-apply DPR scale each frame (safe after canvas.width reassignment on resize)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = lw
      const h = lh
      const sh = h - 32

      // Phosphor persistence — don't fully clear, just dim
      ctx.fillStyle = 'rgba(0, 4, 0, 0.13)'
      ctx.fillRect(0, 0, w, sh)

      // Grid
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.045)'
      for (let i = 0; i <= 10; i++) {
        ctx.beginPath(); ctx.moveTo((w / 10) * i, 0); ctx.lineTo((w / 10) * i, sh); ctx.stroke()
      }
      for (let i = 0; i <= 8; i++) {
        ctx.beginPath(); ctx.moveTo(0, (sh / 8) * i); ctx.lineTo(w, (sh / 8) * i); ctx.stroke()
      }
      // Center crosshairs (slightly brighter)
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.10)'
      ctx.beginPath(); ctx.moveTo(0, sh / 2); ctx.lineTo(w, sh / 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, sh); ctx.stroke()

      // Glitch events
      glitchTimer++
      if (!isGlitching && glitchTimer > 220 + Math.random() * 380) {
        isGlitching = true; glitchIntensity = 1; glitchTimer = 0
        targetPhase = (Math.random() - 0.5) * 4
        targetFreq = 0.4 + Math.random() * 1.8
      }
      if (isGlitching) {
        glitchIntensity -= 0.025
        if (glitchIntensity <= 0) { isGlitching = false; glitchIntensity = 0 }
      }
      phaseShift += (targetPhase - phaseShift) * 0.025
      freqMod   += (targetFreq  - freqMod)   * 0.01

      // Dropout
      dropoutTimer++
      if (!isDropout && dropoutTimer > 550 + Math.random() * 700) {
        isDropout = true; dropoutTimer = 0
        setTimeout(() => { isDropout = false }, 120 + Math.random() * 280)
      }

      const midY = sh / 2

      if (isDropout) {
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.45)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(0, midY + (Math.random() - 0.5) * 3)
        ctx.lineTo(w, midY + (Math.random() - 0.5) * 3)
        ctx.stroke()
      } else {
        // CH2 — dim reference
        ctx.strokeStyle = `rgba(0, 160, 80, ${0.2 + glitchIntensity * 0.12})`
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = 0; x < w; x++) {
          const n = (x / w) * Math.PI * 10
          const noise = isGlitching ? (Math.random() - 0.5) * 28 * glitchIntensity : 0
          const y = midY
            + Math.sin(n * 0.7 + t * 1.4 + phaseShift) * (sh * 0.14)
            + Math.sin(n * 2.2 + t * 0.5) * (sh * 0.04)
            + noise
          if (x === 0) { ctx.moveTo(x, y) } else { ctx.lineTo(x, y) }
        }
        ctx.stroke()

        // CH1 — main wave, 3-pass glow
        const r = isGlitching ? Math.round(60 * glitchIntensity) : 0
        const b = isGlitching ? Math.round(160 * glitchIntensity) : 0
        const passes = [
          { alpha: 0.10, width: 10 },
          { alpha: 0.28, width: 4  },
          { alpha: 1.00, width: 1.5 },
        ]
        for (const { alpha, width } of passes) {
          ctx.strokeStyle = `rgba(${r}, 255, ${b}, ${alpha})`
          ctx.lineWidth = width
          if (width === 1.5) { ctx.shadowBlur = 14; ctx.shadowColor = `rgba(${r}, 255, ${b}, 0.7)` }
          ctx.beginPath()
          for (let x = 0; x < w; x++) {
            const n = (x / w) * Math.PI * 8 * freqMod
            const glitchNoise = isGlitching ? (Math.random() - 0.5) * 45 * glitchIntensity : 0
            const y = midY
              + Math.sin(n + t * 2.1 + phaseShift) * (sh * 0.27)
              + Math.sin(n * 2.0 + t * 0.85) * (sh * 0.08)
              + Math.sin(n * 0.3 + t * 0.4)  * (sh * 0.05)
              + glitchNoise
            if (x === 0) { ctx.moveTo(x, y) } else { ctx.lineTo(x, y) }
          }
          ctx.stroke()
          ctx.shadowBlur = 0
        }

        // Glitch horizontal tears
        if (isGlitching && glitchIntensity > 0.25) {
          for (let i = 0; i < 2; i++) {
            ctx.fillStyle = `rgba(0, 255, 120, ${glitchIntensity * 0.12})`
            ctx.fillRect(
              Math.random() * w * 0.4,
              Math.random() * sh,
              w * 0.3 + Math.random() * w * 0.5,
              1 + Math.random() * 6
            )
          }
        }
      }

      // Status bar
      ctx.fillStyle = 'rgba(0, 0, 0, 0.88)'
      ctx.fillRect(0, sh, w, 32)
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.18)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, sh); ctx.lineTo(w, sh); ctx.stroke()

      const freq = (47.3 * freqMod + Math.sin(t * 0.11) * 1.8).toFixed(1)
      const amp  = (0.87 + Math.sin(t * 0.07) * 0.09).toFixed(2)
      const deg  = (((phaseShift + Math.PI) % (Math.PI * 2)) * (180 / Math.PI)).toFixed(0)

      ctx.font = '10px TrixieCyrG'
      ctx.fillStyle = 'rgba(0, 140, 0, 0.75)'
      ctx.fillText(`${freq} Hz`, 8, sh + 21)
      ctx.fillText(`${amp} V`, 82, sh + 21)
      ctx.fillText(`φ ${deg}°`, 138, sh + 21)
      ctx.fillText(isDropout ? 'SYNC: LOST  ' : 'SYNC: LOCKED', 194, sh + 21)

      animFrame = requestAnimationFrame(draw)
    }

    return () => { cancelAnimationFrame(animFrame); ro.disconnect() }
  }, [])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
}

// ============================================================================
// COMPONENT
// ============================================================================

const Home = () => {
  // ==========================================================================
  // STATE
  // ==========================================================================

  const [openFile, setOpenFile] = useState<string | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<string[]>([])
  const [mobileTab, setMobileTab] = useState<'links' | 'profile' | 'files' | 'decode'>('links')
  const [mobileFsPane, setMobileFsPane] = useState<'tree' | 'viewer'>('tree')
  const [cursorTrail, setCursorTrail] = useState<Array<{ x: number; y: number; id: number }>>([])
  const [time, setTime] = useState(new Date())
  const [hexInput, setHexInput] = useState('')
  const [decodedMessage, setDecodedMessage] = useState('')

  const [booted, setBooted] = useState(false)
  const [bootFading, setBootFading] = useState(false)
  const [bootLines, setBootLines] = useState<string[]>([])
  const [idleQuoteIndex, setIdleQuoteIndex] = useState(0)
  const [uptime, setUptime] = useState(0)

  const [floatingMsgs, setFloatingMsgs] = useState<Array<{ id: number; x: number; y: number; text: string }>>([])

  // Monotonic id source for transient lists (cursor trail, floating intercepts).
  // Date.now() collides when events fire within the same millisecond, producing duplicate React keys.
  const uidRef = useRef(0)

  // ==========================================================================
  // EFFECTS
  // ==========================================================================

  // Boot sequence
  useEffect(() => {
    let lineIndex = 0
    let t1: ReturnType<typeof setTimeout>
    let t2: ReturnType<typeof setTimeout>
    const interval = setInterval(() => {
      if (lineIndex < BOOT_LINES.length) {
        setBootLines(prev => [...prev, BOOT_LINES[lineIndex]])
        lineIndex++
      } else {
        clearInterval(interval)
        t1 = setTimeout(() => {
          setBootFading(true)
          t2 = setTimeout(() => setBooted(true), 650)
        }, 450)
      }
    }, 90)
    return () => {
      clearInterval(interval)
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])

  // Idle quote cycling
  useEffect(() => {
    const interval = setInterval(() => {
      setIdleQuoteIndex(prev => (prev + 1) % IDLE_QUOTES.length)
    }, 4500)
    return () => clearInterval(interval)
  }, [])

  // Cursor trail
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCursorTrail(prev => {
        const newTrail = [...prev, { x: e.clientX, y: e.clientY, id: ++uidRef.current }]
        return newTrail.slice(-15)
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Time update
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Uptime counter
  useEffect(() => {
    const interval = setInterval(() => setUptime(prev => prev + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // Floating intercepts
  useEffect(() => {
    if (!booted) return
    const spawn = setInterval(() => {
      const id = ++uidRef.current
      const x = 3 + Math.random() * 93
      const y = 8 + Math.random() * 83
      const text = FLOAT_MSGS[Math.floor(Math.random() * FLOAT_MSGS.length)]
      setFloatingMsgs(prev => [...prev.slice(-12), { id, x, y, text }])
      setTimeout(() => setFloatingMsgs(prev => prev.filter(m => m.id !== id)), 5500)
    }, 1600)
    return () => clearInterval(spawn)
  }, [booted])

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  const handleFileClick = (filename: string) => { setOpenFile(filename); setMobileFsPane('viewer') }
  const handleFileClose = () => { setOpenFile(null); setMobileFsPane('tree') }

  const handleHexDecode = () => {
    try {
      const cleanHex = hexInput.replace(/\s+/g, '')
      let decoded = ''
      for (let i = 0; i < cleanHex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(cleanHex.slice(i, i + 2), 16))
      }
      setDecodedMessage(decoded)
    } catch {
      setDecodedMessage('ERROR: Invalid hex format')
    }
  }

  const toggleDirectory = (dirName: string) => {
    setCollapsedDirs(prev =>
      prev.includes(dirName) ? prev.filter(d => d !== dirName) : [...prev, dirName]
    )
  }

  const mv = (tabs: ('links' | 'profile' | 'files' | 'decode')[]) =>
    tabs.includes(mobileTab) ? '' : ' mobile-hidden'

  const quote = IDLE_QUOTES[idleQuoteIndex]

  const formatUptime = (secs: number) => {
    const h = Math.floor(secs / 3600).toString().padStart(2, '0')
    const m = Math.floor((secs % 3600) / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${h}:${m}:${s}`
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className="navi-system">

      {/* Boot Sequence Overlay */}
      {!booted && (
        <div className={`boot-overlay${bootFading ? ' boot-fading' : ''}`}>
          <div className="boot-content">
            <pre className="boot-ascii">{` ███╗   ██╗ █████╗ ██╗   ██╗██╗
 ████╗  ██║██╔══██╗██║   ██║██║
 ██╔██╗ ██║███████║██║   ██║██║
 ██║╚██╗██║██╔══██║╚██╗ ██╔╝██║
 ██║ ╚████║██║  ██║ ╚████╔╝ ██║
 ╚═╝  ╚═══╝╚═╝  ╚═╝  ╚═══╝  ╚═╝`}</pre>
            <div className="boot-terminal">
              {bootLines.map((line, i) => (
                <div
                  key={i}
                  className={`boot-line${i === bootLines.length - 1 ? ' boot-line-current' : ''}`}
                >
                  {line}
                </div>
              ))}
              <span className="boot-cursor blink-fast">_</span>
            </div>
          </div>
        </div>
      )}

      {/* CRT Screen Effects */}
      <div className="crt-overlay"></div>
      <div className="crt-scanlines"></div>
      <div className="static-noise"></div>

      {/* Floating WIRED Intercepts */}
      {floatingMsgs.map(m => (
        <div
          key={m.id}
          className="floating-intercept"
          style={{ left: `${m.x}%`, top: `${m.y}%` }}
        >
          {m.text}
        </div>
      ))}

      {/* Ghostly Cursor Trail */}
      {cursorTrail.map((pos, index) => (
        <div
          key={pos.id}
          className="cursor-ghost"
          style={{
            left: pos.x,
            top: pos.y,
            opacity: (index / cursorTrail.length) * 0.3,
          }}
        />
      ))}

      {/* Main Grid Layout */}
      <div className="navi-grid">

        {/* Header Bar */}
        <div className="navi-header">
          <div className="header-left">
            <span className="navi-logo glitch-fast" data-text="NAVI">NAVI</span>
            <span className="header-separator">://</span>
            <span className="system-status blink-slow">ACTIVE</span>
            <span className="header-layer">LAYER_07</span>
          </div>
          <div className="header-right">
            <span className="system-time">{time.toLocaleTimeString()}</span>
            <div className="signal-indicator">
              <span className="signal-bar"></span>
              <span className="signal-bar"></span>
              <span className="signal-bar"></span>
              <span className="signal-bar blink-fast"></span>
            </div>
          </div>
        </div>

        {/* Mobile Tab Bar */}
        <div className="mobile-tab-bar">
          <button
            className={`mobile-tab${mobileTab === 'links' ? ' mobile-tab-active' : ''}`}
            onClick={() => setMobileTab('links')}
          >
            <span className="mobile-tab-icon">⬡</span>
            <span className="mobile-tab-label">LINKS</span>
          </button>
          <button
            className={`mobile-tab${mobileTab === 'profile' ? ' mobile-tab-active' : ''}`}
            onClick={() => setMobileTab('profile')}
          >
            <span className="mobile-tab-icon">◈</span>
            <span className="mobile-tab-label">PROFILE</span>
          </button>
          <button
            className={`mobile-tab${mobileTab === 'files' ? ' mobile-tab-active' : ''}`}
            onClick={() => setMobileTab('files')}
          >
            <span className="mobile-tab-icon">⊞</span>
            <span className="mobile-tab-label">FILES</span>
          </button>
          <button
            className={`mobile-tab${mobileTab === 'decode' ? ' mobile-tab-active' : ''}`}
            onClick={() => setMobileTab('decode')}
          >
            <span className="mobile-tab-icon">≋</span>
            <span className="mobile-tab-label">WIRED</span>
          </button>
        </div>

        {/* Main Content Area */}
        <div className="navi-content">

          {/* Left Column — Profile + FS Browser */}
          <div className="column-left">

            {/* Profile */}
            <div className={`navi-window window-profile-large${mv(['profile'])}`}>
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">USER_PROFILE.NAV</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body">
                <div className="profile-large-content">
                  <div className="profile-image-wrapper">
                    <div className="image-static"></div>
                    <img
                      src="https://avatars.githubusercontent.com/u/82450286?v=4"
                      alt="User"
                      className="profile-image-large glitch-image"
                    />
                    <div className="image-scanline"></div>
                  </div>
                  <div className="profile-username">Dominik_Koenitzer</div>
                  <div className="profile-node-id">NODE :: 0xD04C_1K_N37</div>
                  <div className="profile-details">
                    <div className="profile-stats-grid">
                      <div className="stat-item">
                        <span className="stat-label">STATUS:</span>
                        <span className="stat-value blink-fast">ONLINE</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">NODE:</span>
                        <span className="stat-value">WIRED</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">LAYER:</span>
                        <span className="stat-value">07</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">UPTIME:</span>
                        <span className="stat-value">{formatUptime(uptime)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* FS Browser */}
            <div className={`navi-window window-fs-browser${mv(['files'])}`}>
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">MEMORY_ACCESS.SYS</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className={`window-body fs-browser-body${mobileFsPane === 'viewer' ? ' mobile-viewer-active' : ''}`}>

                {/* Tree pane */}
                <div className="fs-tree-pane">
                  <div className="fs-tree-prompt-line">
                    <span className="fs-tree-prompt">dominik@wired://layer_07$</span>
                  </div>
                  <div className="fs-tree-body">

                    <div className="tree-folder" onClick={() => toggleDirectory('SYSTEM')}>
                      <span className="tree-fold-icon">{collapsedDirs.includes('SYSTEM') ? '▸' : '▾'}</span>
                      <span className="tree-folder-name">SYSTEM</span>
                    </div>
                    {!collapsedDirs.includes('SYSTEM') && (
                      <div className="tree-children">
                        <div
                          className={`tree-file${openFile === 'SYSTEM/REALITY.DLL' ? ' tree-file-active' : ''}`}
                          onClick={() => handleFileClick('SYSTEM/REALITY.DLL')}
                        >
                          <span className="tree-branch">├─</span>
                          <span className="tree-file-name">REALITY.DLL</span>
                          <span className="tree-file-chevron">›</span>
                        </div>
                        <div
                          className={`tree-file${openFile === 'SYSTEM/KNIGHTS.DAT' ? ' tree-file-active' : ''}`}
                          onClick={() => handleFileClick('SYSTEM/KNIGHTS.DAT')}
                        >
                          <span className="tree-branch">└─</span>
                          <span className="tree-file-name">KNIGHTS.DAT</span>
                          <span className="tree-file-chevron">›</span>
                        </div>
                      </div>
                    )}

                    <div className="tree-folder" onClick={() => toggleDirectory('DATA')}>
                      <span className="tree-fold-icon">{collapsedDirs.includes('DATA') ? '▸' : '▾'}</span>
                      <span className="tree-folder-name">DATA</span>
                    </div>
                    {!collapsedDirs.includes('DATA') && (
                      <div className="tree-children">
                        <div
                          className={`tree-file${openFile === 'DATA/MESSAGE.HEX' ? ' tree-file-active' : ''}`}
                          onClick={() => handleFileClick('DATA/MESSAGE.HEX')}
                        >
                          <span className="tree-branch">├─</span>
                          <span className="tree-file-name">MESSAGE.HEX</span>
                          <span className="tree-file-badge">ENC</span>
                          <span className="tree-file-chevron">›</span>
                        </div>
                        <div
                          className={`tree-file${openFile === 'DATA/WIRED_ACCESS.KEY' ? ' tree-file-active' : ''}`}
                          onClick={() => handleFileClick('DATA/WIRED_ACCESS.KEY')}
                        >
                          <span className="tree-branch">└─</span>
                          <span className="tree-file-name">WIRED.KEY</span>
                          <span className="tree-file-chevron">›</span>
                        </div>
                      </div>
                    )}

                    <div className="tree-folder" onClick={() => toggleDirectory('SECRETS')}>
                      <span className="tree-fold-icon">{collapsedDirs.includes('SECRETS') ? '▸' : '▾'}</span>
                      <span className="tree-folder-name">SECRETS</span>
                    </div>
                    {!collapsedDirs.includes('SECRETS') && (
                      <div className="tree-children">
                        <div
                          className={`tree-file${openFile === 'SECRETS/LAIN.LOG' ? ' tree-file-active' : ''}`}
                          onClick={() => handleFileClick('SECRETS/LAIN.LOG')}
                        >
                          <span className="tree-branch">└─</span>
                          <span className="tree-file-name">LAIN.LOG</span>
                          <span className="tree-file-chevron">›</span>
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {/* Viewer pane */}
                <div className="fs-viewer-pane">
                  {openFile ? (
                    <>
                      <div className="fs-viewer-header">
                        <button className="fs-back-btn" onClick={handleFileClose}>‹ BACK</button>
                        <span className="fs-viewer-path">&gt; {openFile}</span>
                        <button className="fs-close-btn" onClick={handleFileClose}>✕</button>
                      </div>
                      <div className="fs-viewer-content">
                        <pre className="file-text">{SECRET_FILES[openFile as keyof typeof SECRET_FILES]}</pre>
                      </div>
                    </>
                  ) : (
                    <div className="fs-viewer-idle">
                      <span className="fs-idle-status blink-slow">∷ NAVI STANDING BY ∷</span>
                      <div className="fs-idle-quote" key={idleQuoteIndex}>
                        <span>{quote.l1}</span>
                        <span>{quote.l2}</span>
                      </div>
                      <span className="fs-idle-divider">────────────────</span>
                      <span className="fs-idle-hint">[ select a file to access memory ]</span>
                    </div>
                  )}
                </div>

              </div>
            </div>

          </div>

          {/* Center Column — Oscilloscope + Decoder */}
          <div className={`column-center${mv(['decode'])}`}>

            {/* Oscilloscope */}
            <div className="navi-window window-oscilloscope">
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">SIGNAL_MONITOR.NAV</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body osc-body">
                <Oscilloscope />
              </div>
            </div>

            {/* Message Decoder */}
            <div className="navi-window window-message">
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">WIRED.INTERCEPT</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body decoder-body">
                <div className="decoder-section-label">
                  <span className="decoder-section-tag">INPUT</span>
                  <span className="decoder-section-hint">{hexInput.replace(/\s+/g, '').length > 0 ? `${Math.floor(hexInput.replace(/\s+/g, '').length / 2)} bytes` : 'awaiting transmission'}</span>
                </div>
                <textarea
                  className="hex-input"
                  value={hexInput}
                  onChange={(e) => setHexInput(e.target.value)}
                  placeholder={"> _ "}
                  spellCheck={false}
                />
                <button className="decode-btn" onClick={handleHexDecode}>
                  DECRYPT
                </button>
                {decodedMessage && (
                  <div className="decoded-output">
                    <div className="output-header">
                      <span className="decoder-section-tag">OUTPUT</span>
                      <button className="clear-btn" onClick={() => { setDecodedMessage(''); setHexInput('') }}>CLEAR</button>
                    </div>
                    <p className="decoded-text">{decodedMessage}</p>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* Right Column — Access Points */}
          <div className={`column-right${mv(['links'])}`}>
            <div className="navi-window window-links">
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">ACCESS_POINTS.NAV</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body links-body">
                <a href="https://dominikkoenitzer.ch" target="_blank" rel="noopener noreferrer" className="access-link">
                  <div className="link-icon pulse-icon"><FaGlobe /></div>
                  <div className="link-info">
                    <span className="link-name">PERSONAL_SITE</span>
                    <span className="link-path">/home/web</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>
                <a href="https://senbon.ch" target="_blank" rel="noopener noreferrer" className="access-link">
                  <div className="link-icon pulse-icon"><FaBook /></div>
                  <div className="link-info">
                    <span className="link-name">JOURNAL</span>
                    <span className="link-path">/senbon/journal</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>
                <a href="https://github.com/dominikkoenitzer" target="_blank" rel="noopener noreferrer" className="access-link">
                  <div className="link-icon pulse-icon"><FaGithub /></div>
                  <div className="link-info">
                    <span className="link-name">REPOSITORY</span>
                    <span className="link-path">/git/hub</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>
                <a href="https://www.paypal.com/paypalme/dominikkoenitzer" target="_blank" rel="noopener noreferrer" className="access-link">
                  <div className="link-icon pulse-icon"><FaPaypal /></div>
                  <div className="link-info">
                    <span className="link-name">TRANSFER</span>
                    <span className="link-path">/pay/support</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>
              </div>
            </div>
          </div>

        </div>


      </div>
    </div>
  )
}

export default Home
