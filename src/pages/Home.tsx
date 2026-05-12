import { useState, useEffect } from 'react'
import { FaGithub, FaPaypal, FaGlobe, FaBook, FaLinkedin, FaWind, FaPalette, FaRandom, FaArchive } from 'react-icons/fa'
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
  '> LOADING USER_PROFILE::LAIN_IWAKURA...',
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
        const newTrail = [...prev, { x: e.clientX, y: e.clientY, id: Date.now() }]
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

  // Mobile visibility helper — on desktop the class has no effect
  const mv = (tabs: ('links' | 'profile' | 'files' | 'decode')[]) =>
    tabs.includes(mobileTab) ? '' : ' mobile-hidden'

  const quote = IDLE_QUOTES[idleQuoteIndex]

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
            <span className="mobile-tab-label">DECODE</span>
          </button>
        </div>

        {/* Main Content Area */}
        <div className="navi-content">

          {/* Left Column — Profile */}
          <div className={`column-left${mv(['profile'])}`}>
            <div className="navi-window window-profile-large">
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
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Center Column — FS Browser + Message Decoder */}
          <div className={`column-center${mv(['files', 'decode'])}`}>
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
                    <span className="fs-tree-prompt">lain@wired://layer_07$</span>
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

            {/* Message Decoder */}
            <div className={`navi-window window-message${mv(['decode'])}`}>
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
                <div className="decoder-input-row">
                  <span className="decoder-prompt-label">RECV&nbsp;&gt;</span>
                  <textarea
                    className="hex-input"
                    value={hexInput}
                    onChange={(e) => setHexInput(e.target.value)}
                    placeholder="intercept hex stream from the wired..."
                    rows={5}
                    spellCheck={false}
                  />
                </div>
                <button className="decode-btn" onClick={handleHexDecode}>
                  ◈&nbsp;&nbsp;DECRYPT SIGNAL
                </button>
                {decodedMessage && (
                  <div className="decoded-output">
                    <div className="output-header">
                      <span className="output-label">SIGNAL &gt;</span>
                      <button className="clear-btn" onClick={() => { setDecodedMessage(''); setHexInput('') }}>CLR</button>
                    </div>
                    <p className="decoded-text">{decodedMessage}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className={`column-right${mv(['links'])}`}>
            {/* Access Points */}
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
                <a
                  href="https://dominikkoenitzer.ch"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaGlobe /></div>
                  <div className="link-info">
                    <span className="link-name">PERSONAL_SITE</span>
                    <span className="link-path">/home/web</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://senbon.ch"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaBook /></div>
                  <div className="link-info">
                    <span className="link-name">JOURNAL</span>
                    <span className="link-path">/senbon/journal</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://github.com/dominikkoenitzer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaGithub /></div>
                  <div className="link-info">
                    <span className="link-name">REPOSITORY</span>
                    <span className="link-path">/git/hub</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://linkedin.com/in/dominik-koenitzer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaLinkedin /></div>
                  <div className="link-info">
                    <span className="link-name">LINKEDIN</span>
                    <span className="link-path">/in/dominik-koenitzer</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://zephyr.punds.ch/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaWind /></div>
                  <div className="link-info">
                    <span className="link-name">ZEPHYR</span>
                    <span className="link-path">/zephyr.punds.ch</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://spectrum.punds.ch/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaPalette /></div>
                  <div className="link-info">
                    <span className="link-name">SPECTRUM</span>
                    <span className="link-path">/spectrum.punds.ch</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://entropy.punds.ch/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaRandom /></div>
                  <div className="link-info">
                    <span className="link-name">ENTROPY</span>
                    <span className="link-path">/entropy.punds.ch</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://remnants.punds.ch/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon"><FaArchive /></div>
                  <div className="link-info">
                    <span className="link-name">REMNANTS</span>
                    <span className="link-path">/remnants.punds.ch</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>

                <a
                  href="https://www.paypal.com/paypalme/dominikkoenitzer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
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
