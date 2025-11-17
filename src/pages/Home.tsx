import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
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

const AUDIO_IFRAME_SRC = 'https://www.youtube.com/embed/_W1P7AvV17w?autoplay=0&mute=0&enablejsapi=1&loop=1&playlist=_W1P7AvV17w'

// ============================================================================
// COMPONENT
// ============================================================================

const Home = () => {
  // ==========================================================================
  // STATE
  // ==========================================================================
  
  // UI State
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<string[]>([])
  
  // Visual Effects
  const [cursorTrail, setCursorTrail] = useState<Array<{ x: number; y: number; id: number }>>([])
  
  // Time & Network
  const [time, setTime] = useState(new Date())
  const [bandwidth, setBandwidth] = useState(1.21)
  const [latency, setLatency] = useState(0)
  const [packetLoss, setPacketLoss] = useState(0.00)
  
  // Audio
  const [volume, setVolume] = useState(7)
  const [audioInitialized, setAudioInitialized] = useState(false)
  const [iframesLoaded, setIframesLoaded] = useState(false)
  
  // Message Decoder
  const [hexInput, setHexInput] = useState('')
  const [decodedMessage, setDecodedMessage] = useState('')
  

  // ==========================================================================
  // AUDIO HELPERS
  // ==========================================================================

  const playAudio = (audioId: string) => {
    const iframe = document.getElementById(audioId) as HTMLIFrameElement
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'playVideo'
        }), '*')
      } catch (error) {
        console.error('Error playing audio:', error)
      }
    }
  }


  const setAudioVolume = (audioId: string, vol: number) => {
    const iframe = document.getElementById(audioId) as HTMLIFrameElement
    if (iframe?.contentWindow) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'setVolume',
          args: [vol]
        }), '*')
      } catch (error) {
        console.error('Error setting volume:', error)
      }
    }
  }

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  const handleIframeLoad = () => {
    setIframesLoaded(true)
  }

  const handleFileClick = (filename: string) => {
    setOpenFile(filename)
  }

  const handleHexDecode = () => {
    try {
      const cleanHex = hexInput.replace(/\s+/g, '')
      let decoded = ''
      for (let i = 0; i < cleanHex.length; i += 2) {
        const hexChar = cleanHex.substr(i, 2)
        decoded += String.fromCharCode(parseInt(hexChar, 16))
      }
      setDecodedMessage(decoded)
    } catch {
      setDecodedMessage('ERROR: Invalid hex format')
    }
  }

  const toggleDirectory = (dirName: string) => {
    setCollapsedDirs(prev => 
      prev.includes(dirName) 
        ? prev.filter(d => d !== dirName)
        : [...prev, dirName]
    )
  }

  // ==========================================================================
  // EFFECTS
  // ==========================================================================

  // Cursor trail effect
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

  // Initialize audio on first user interaction
  useEffect(() => {
    if (!iframesLoaded || audioInitialized) return

    const initAudio = () => {
      if (!audioInitialized) {
        setAudioInitialized(true)
        setTimeout(() => {
          setAudioVolume('lain-audio', 7)
          playAudio('lain-audio')
        }, 200)
      }
    }

    const events = ['click', 'keydown', 'touchstart', 'scroll', 'mousemove']
    events.forEach(event => {
      document.addEventListener(event, initAudio, { once: true })
    })

    const autoplayTimer = setTimeout(initAudio, 1000)

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, initAudio)
      })
      clearTimeout(autoplayTimer)
    }
  }, [audioInitialized, iframesLoaded])

  // Time update and network stats modulation
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date())
      setBandwidth(prev => +(prev + (Math.random() - 0.5) * 0.5).toFixed(2))
      setLatency(Math.floor(Math.random() * 50))
      setPacketLoss(+(Math.random() * 5).toFixed(2))
    }, 1000)
    return () => clearInterval(interval)
  }, [])
  
  // Volume control
  useEffect(() => {
    if (!audioInitialized) return
    setAudioVolume('lain-audio', volume)
  }, [volume, audioInitialized])


  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <div className="navi-system">
      {/* Hidden Audio Player */}
      <iframe 
        id="lain-audio"
        frameBorder="0"
        allow="autoplay"
        title="Lain Audio"
        width="0" 
        height="0" 
        src={AUDIO_IFRAME_SRC}
        style={{ display: 'none' }}
        onLoad={handleIframeLoad}
      />
      
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

        {/* Main Content Area */}
        <div className="navi-content">
          {/* Left Column */}
          <div className="column-left">
            {/* User Profile */}
            <motion.div 
              className="navi-window window-profile-large"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.2 }}
            >
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
                  <div className="profile-username">Lain_Iwakura</div>
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
            </motion.div>

            {/* Directory */}
            <motion.div 
              className="navi-window window-terminal"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.4 }}
            >
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">DIRECTORY.NAV</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body terminal-body">
                <div className="terminal-lines">
                  {/* SYSTEM Folder */}
                  <p 
                    className="terminal-line dir-folder"
                    onClick={() => toggleDirectory('SYSTEM')}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="folder-icon">{collapsedDirs.includes('SYSTEM') ? '📁' : '📂'}</span>
                    <span className="folder-name">SYSTEM/</span>
                    <span className="folder-count">(2 files)</span>
                  </p>
                  {!collapsedDirs.includes('SYSTEM') && (
                    <div className="file-list">
                      <p 
                        className="terminal-line file-entry"
                        onClick={() => handleFileClick('SYSTEM/REALITY.DLL')}
                      >
                        <span className="file-icon">⚙️</span>
                        <span className="file-name">REALITY.DLL</span>
                      </p>
                      <p 
                        className="terminal-line file-entry"
                        onClick={() => handleFileClick('SYSTEM/KNIGHTS.DAT')}
                      >
                        <span className="file-icon">🗡️</span>
                        <span className="file-name">KNIGHTS.DAT</span>
                      </p>
                    </div>
                  )}
                  
                  {/* DATA Folder */}
                  <p 
                    className="terminal-line dir-folder"
                    onClick={() => toggleDirectory('DATA')}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="folder-icon">{collapsedDirs.includes('DATA') ? '📁' : '📂'}</span>
                    <span className="folder-name">DATA/</span>
                    <span className="folder-count">(2 files)</span>
                  </p>
                  {!collapsedDirs.includes('DATA') && (
                    <div className="file-list">
                      <p 
                        className="terminal-line file-entry"
                        onClick={() => handleFileClick('DATA/MESSAGE.HEX')}
                      >
                        <span className="file-icon">🔐</span>
                        <span className="file-name">MESSAGE.HEX</span>
                        <span className="file-badge">ENCODED</span>
                      </p>
                      <p 
                        className="terminal-line file-entry"
                        onClick={() => handleFileClick('DATA/WIRED_ACCESS.KEY')}
                      >
                        <span className="file-icon">🔑</span>
                        <span className="file-name">WIRED_ACCESS.KEY</span>
                      </p>
                    </div>
                  )}
                  
                  {/* SECRETS Folder */}
                  <p 
                    className="terminal-line dir-folder"
                    onClick={() => toggleDirectory('SECRETS')}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="folder-icon">{collapsedDirs.includes('SECRETS') ? '📁' : '📂'}</span>
                    <span className="folder-name">SECRETS/</span>
                    <span className="folder-count">(1 file)</span>
                  </p>
                  {!collapsedDirs.includes('SECRETS') && (
                    <div className="file-list">
                      <p 
                        className="terminal-line file-entry"
                        onClick={() => handleFileClick('SECRETS/LAIN.LOG')}
                      >
                        <span className="file-icon">👁️</span>
                        <span className="file-name">LAIN.LOG</span>
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>

          {/* Center Column */}
          <div className="column-center">
            {/* Message Decoder */}
            <motion.div 
              className="navi-window window-message"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, delay: 0.8 }}
            >
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">MESSAGE.DECODER</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body message-body">
                <div className="decoder-container">
                  <div className="hex-input-group">
                    <label className="input-label">PASTE HEX CODE:</label>
                    <textarea 
                      className="hex-input"
                      value={hexInput}
                      onChange={(e) => setHexInput(e.target.value)}
                      placeholder="57 68 79 20 61 72 65 20 79 6F 75 20 68 65 72 65 3F"
                      rows={8}
                    />
                  </div>
                  <button 
                    className="decode-btn"
                    onClick={handleHexDecode}
                  >
                    <span>◈ DECODE MESSAGE</span>
                  </button>
                  <AnimatePresence>
                    {decodedMessage && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="decoded-output"
                      >
                        <div className="output-header">
                          <span className="output-label">DECODED:</span>
                          <button 
                            className="clear-btn"
                            onClick={() => {
                              setDecodedMessage('')
                              setHexInput('')
                            }}
                          >
                            CLEAR
                          </button>
                        </div>
                        <p className="decoded-text">{decodedMessage}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>

            {/* File Viewer */}
            <motion.div 
              className="navi-window window-file-viewer"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 1.0 }}
            >
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">FILE_VIEWER.NAV</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body file-viewer-body">
                <div className="file-viewer-content">
                  {openFile ? (
                    <>
                      <div className="file-viewer-header">
                        <span className="file-viewer-name">{openFile}</span>
                        <button 
                          className="close-file-btn"
                          onClick={() => setOpenFile(null)}
                        >
                          [CLOSE]
                        </button>
                      </div>
                      <pre className="file-text">{SECRET_FILES[openFile as keyof typeof SECRET_FILES]}</pre>
                    </>
                  ) : (
                    <div className="file-viewer-empty">
                      <p className="empty-message">No file selected</p>
                      <p className="empty-hint">Click a file in DIRECTORY.NAV to view its contents</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>

          {/* Right Column */}
          <div className="column-right">
            {/* Access Points */}
            <motion.div 
              className="navi-window window-links"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 1.0 }}
            >
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
                  <div className="link-icon pulse-icon">
                    <FaGlobe />
                  </div>
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
                  <div className="link-icon pulse-icon">
                    <FaBook />
                  </div>
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
                  <div className="link-icon pulse-icon">
                    <FaGithub />
                  </div>
                  <div className="link-info">
                    <span className="link-name">REPOSITORY</span>
                    <span className="link-path">/git/hub</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>
                
                <a
                  href="https://www.paypal.com/paypalme/dominikkoenitzer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="access-link"
                >
                  <div className="link-icon pulse-icon">
                    <FaPaypal />
                  </div>
                  <div className="link-info">
                    <span className="link-name">TRANSFER</span>
                    <span className="link-path">/pay/support</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>
              </div>
            </motion.div>

            {/* Network Monitor */}
            <motion.div 
              className="navi-window window-network"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 1, delay: 1.2 }}
            >
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">NETWORK.MONITOR</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body network-body">
                <div className="network-monitor-grid">
                  <div className="monitor-section">
                    <div className="monitor-header">SYSTEM METRICS</div>
                    <div className="metric-row">
                      <span className="metric-label">UPTIME</span>
                      <span className="metric-value">{Math.floor(time.getSeconds() + time.getMinutes() * 60)}s</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">BANDWIDTH</span>
                      <span className="metric-value">{bandwidth.toFixed(2)} GB/s</span>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">PACKET_LOSS</span>
                      <span className="metric-value">{packetLoss.toFixed(2)}%</span>
                      <div className="metric-bar">
                        <div className="metric-fill" style={{ width: `${Math.max(0, 100 - packetLoss * 20)}%` }}></div>
                      </div>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">LATENCY</span>
                      <span className="metric-value">{latency}ms</span>
                      <div className="metric-bar">
                        <div className="metric-fill" style={{ width: `${Math.max(0, 100 - latency * 2)}%` }}></div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="monitor-section">
                    <div className="monitor-header">AUDIO CONTROL</div>
                    <div className="metric-row volume-control-row">
                      <span className="metric-label">VOLUME</span>
                      <span className="metric-value">{volume}%</span>
                      <div className="volume-slider-container">
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={volume}
                          onChange={(e) => setVolume(Number(e.target.value))}
                          className="volume-range-input"
                        />
                        <div className="volume-track">
                          <div className="volume-fill" style={{ width: `${volume}%` }}></div>
                        </div>
                      </div>
                    </div>
                    <div className="metric-row">
                      <span className="metric-label">STATUS</span>
                      <span className="metric-value">STABLE</span>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Home
