import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FaGithub, FaPaypal, FaGlobe, FaBook } from 'react-icons/fa'
import './Home.css'

const Home = () => {
  const [cursorTrail, setCursorTrail] = useState<Array<{ x: number; y: number; id: number }>>([])
  const [time, setTime] = useState(new Date())
  // commandText is set but not read, used for side effects only
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_commandText, setCommandText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [matrixMode] = useState(false)
  const [hexInput, setHexInput] = useState('')
  const [decodedMessage, setDecodedMessage] = useState('')
  const [protocolClicks, setProtocolClicks] = useState(0)
  const [lastProtocolClick, setLastProtocolClick] = useState(0)
  // Load saved protocol level from localStorage
  const [protocolLevel, setProtocolLevel] = useState(() => {
    const saved = localStorage.getItem('protocolLevel')
    return saved ? parseInt(saved) : 7
  })
  const [volume, setVolume] = useState(7)
  const [bandwidth, setBandwidth] = useState(1.21)
  const [latency, setLatency] = useState(0)
  const [packetLoss, setPacketLoss] = useState(0.00)
  const [collapsedDirs, setCollapsedDirs] = useState<string[]>([])
  const [audioInitialized, setAudioInitialized] = useState(false)
  const [iframesLoaded, setIframesLoaded] = useState({ layer7: false, layer13: false })
  
  const commands = useMemo(() => [
    'INITIALIZING NAVI SYSTEM...',
    'CONNECTING TO THE WIRED...',
    'LOADING USER DATA...',
    'REALITY.EXE NOT FOUND',
    'SYSTEM READY',
  ], [])
  const [commandIndex, setCommandIndex] = useState(0)

  // Helper function to play audio
  const playAudio = (audioId: string) => {
    const iframe = document.getElementById(audioId) as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
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

  const pauseAudio = (audioId: string) => {
    const iframe = document.getElementById(audioId) as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          event: 'command',
          func: 'pauseVideo'
        }), '*')
      } catch (error) {
        console.error('Error pausing audio:', error)
      }
    }
  }

  const setAudioVolume = (audioId: string, vol: number) => {
    const iframe = document.getElementById(audioId) as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
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

  // Handle iframe load events
  const handleIframeLoad = (layer: 'layer7' | 'layer13') => {
    setIframesLoaded(prev => ({ ...prev, [layer]: true }))
  }

  const secretFiles: { [key: string]: string } = {
    'SYSTEM/NOTHING_STAYS_THE_SAME.TXT': `
> File: NOTHING_STAYS_THE_SAME.TXT
> Last Modified: PRESENT_DAY
> Author: UNKNOWN

Everything changes.
The only constant is change itself.
Who you were yesterday is not who you are today.
And tomorrow... who knows?

[HINT: Seven knocks on the door...]
[TIP: Some things require patience and persistence]
    `,
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

TIP: Use MESSAGE.DECODER to reveal
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
    'SYSTEM/PROTOCOL_7.SYS': `
> File: PROTOCOL_7.SYS
> Status: ACTIVE
> Layer: PHYSICAL_WORLD

CURRENT_LAYER: 7
NETWORK_STATUS: CONNECTED
REALITY_ANCHOR: STABLE

Protocol 7 maintains separation between
the real and the Wired.

Click deeper to transcend...
    `,
    'SYSTEM/NAVI_CORE.EXE': `
> File: NAVI_CORE.EXE
> Type: SYSTEM_EXECUTABLE
> Version: 13.0.7

NAVI Operating System
Initializing...
Connecting to the Wired...
Loading consciousness protocols...

Welcome to Layer 7.
Your presence is everywhere.
    `,
    'SECRETS/PSYCHE.DAT': `
> File: PSYCHE.DAT
> Type: PSYCHOLOGICAL_PROFILE
> Access: RESTRICTED

SUBJECT: LAIN_IWAKURA
LAYER_ACCESS: 13
NETWORK_PRESENCE: OMNIPRESENT

ANALYSIS:
Reality boundary: DISSOLVED
Identity coherence: FRAGMENTED
Wired integration: COMPLETE

The body is merely a vessel.
The mind transcends physical limitations.
    `,
    'SECRETS/PROPHECY.LOG': `
> File: PROPHECY.LOG
> Type: SYSTEM_PREDICTION
> Last Modified: [REDACTED]

WIRED_EVENT_001: Network consciousness achieved
WIRED_EVENT_002: Boundary collapse imminent  
WIRED_EVENT_003: Layer 13 convergence detected

WARNING: Reality anchors destabilizing
WARNING: Identity merge protocols active
WARNING: No one is alone anymore

The Wired and reality are one.
    `
  }

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
    const areIframesReady = iframesLoaded.layer7 && iframesLoaded.layer13
    
    if (!areIframesReady || audioInitialized) return

    const initAudio = () => {
      if (!audioInitialized) {
        setAudioInitialized(true)
        // Give a small delay for iframe API to be ready
        setTimeout(() => {
          const activeAudio = protocolLevel === 13 ? 'lain-audio-layer13' : 'lain-audio-layer7'
          setAudioVolume(activeAudio, protocolLevel === 13 ? 13 : 7)
          playAudio(activeAudio)
        }, 200)
      }
    }

    // Trigger on ANY user interaction
    const events = ['click', 'keydown', 'touchstart', 'scroll', 'mousemove']
    events.forEach(event => {
      document.addEventListener(event, initAudio, { once: true })
    })

    // Also try to play automatically after a delay (for browsers that allow it)
    const autoplayTimer = setTimeout(initAudio, 1000)

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, initAudio)
      })
      clearTimeout(autoplayTimer)
    }
  }, [audioInitialized, protocolLevel, iframesLoaded])

  // Time update and network stats modulation
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date())
      // Modulate network stats randomly with bigger fluctuations
      setBandwidth(prev => +(prev + (Math.random() - 0.5) * 0.5).toFixed(2))
      setLatency(Math.floor(Math.random() * 50))
      setPacketLoss(+(Math.random() * 5).toFixed(2))
    }, 1000)
    return () => clearInterval(interval)
  }, [])
  
  // Volume control
  useEffect(() => {
    if (!audioInitialized) return
    const activeAudio = protocolLevel === 13 ? 'lain-audio-layer13' : 'lain-audio-layer7'
    setAudioVolume(activeAudio, volume)
  }, [volume, audioInitialized, protocolLevel])
  
  // Auto-adjust volume based on protocol level
  useEffect(() => {
    if (protocolLevel === 13) {
      setVolume(13)
    } else if (protocolLevel === 7) {
      setVolume(7)
    }
  }, [protocolLevel])
  
  // Handle protocol level switching and audio track switching
  useEffect(() => {
    if (!audioInitialized) return
    
    const activeAudio = protocolLevel === 13 ? 'lain-audio-layer13' : 'lain-audio-layer7'
    const inactiveAudio = protocolLevel === 13 ? 'lain-audio-layer7' : 'lain-audio-layer13'
    
    // Pause inactive audio
    pauseAudio(inactiveAudio)
    
    // Play active audio
    setTimeout(() => {
      setAudioVolume(activeAudio, protocolLevel === 13 ? 13 : 7)
      playAudio(activeAudio)
    }, 100)
  }, [protocolLevel, audioInitialized])

  // Typing effect
  useEffect(() => {
    if (!isTyping && commandIndex < commands.length && !openFile) {
      setIsTyping(true)
      let currentText = ''
      let charIndex = 0
      const currentCommand = commands[commandIndex]
      
      const typeInterval = setInterval(() => {
        if (charIndex < currentCommand.length) {
          currentText += currentCommand[charIndex]
          setCommandText(currentText)
          charIndex++
        } else {
          clearInterval(typeInterval)
          setTimeout(() => {
            setIsTyping(false)
            setCommandIndex((prev) => (prev + 1) % commands.length)
            setCommandText('')
          }, 2000)
        }
      }, 80)
      
      return () => clearInterval(typeInterval)
    }
  }, [commandIndex, isTyping, openFile, commands])

  const handleFileClick = (filename: string) => {
    setOpenFile(filename)
    setCommandText('')
    setIsTyping(false)
  }

  const handleProtocolClick = () => {
    const now = Date.now()
    const timeSinceLastClick = now - lastProtocolClick
    
    // Reset if too much time passed (more than 1.5 seconds)
    if (timeSinceLastClick > 1500) {
      setProtocolClicks(1)
      setLastProtocolClick(now)
      return
    }
    
    // Increment clicks
    const newClicks = protocolClicks + 1
    setProtocolClicks(newClicks)
    setLastProtocolClick(now)
    
    // Toggle between Layer 7 and Layer 13 with 7 clicks
    if (newClicks === 7) {
      const newLevel = protocolLevel === 7 ? 13 : 7
      setProtocolLevel(newLevel)
      localStorage.setItem('protocolLevel', newLevel.toString())
      setProtocolClicks(0)
    }
  }

  const handleHexDecode = () => {
    try {
      // Remove spaces and newlines from hex input
      const cleanHex = hexInput.replace(/\s+/g, '')
      
      // Convert hex to string
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

  return (
    <div className={`navi-system ${protocolLevel === 13 ? 'layer13-theme' : ''}`}>
      {/* Hidden Audio Players - Different tracks for each layer */}
      <iframe 
        id="lain-audio-layer7"
        frameBorder="0"
        allow="autoplay"
        title="Lain Audio Layer 7"
        width="0" 
        height="0" 
        src="https://www.youtube.com/embed/_W1P7AvV17w?autoplay=0&mute=0&enablejsapi=1&loop=1&playlist=_W1P7AvV17w"
        style={{ display: 'none' }}
        onLoad={() => handleIframeLoad('layer7')}
      />
      <iframe 
        id="lain-audio-layer13"
        frameBorder="0"
        allow="autoplay"
        title="Lain Audio Layer 13"
        width="0" 
        height="0" 
        src="https://www.youtube.com/embed/_W1P7AvV17w?autoplay=0&mute=0&enablejsapi=1&loop=1&playlist=_W1P7AvV17w"
        style={{ display: 'none' }}
        onLoad={() => handleIframeLoad('layer13')}
      />
      
      {/* CRT Screen Effects */}
      <div className="crt-overlay"></div>
      <div className="crt-scanlines"></div>
      <div className="static-noise"></div>
      
      {/* Matrix Mode */}
      {matrixMode && <div className="matrix-overlay"></div>}
      
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
            {/* Window 1: User Profile - LARGER */}
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
                  <div className="profile-details">
                    
                    <div className="profile-stats-grid">
                      <div className="stat-item">
                        <span className="stat-label">USER_ID:</span>
                        <span className="stat-value">Lain_Iwakura</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">STATUS:</span>
                        <span className="stat-value blink-fast">ONLINE</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">PROTOCOL:</span>
                        <span className="stat-value">IPv{protocolLevel}</span>
                      </div>
                      <div className="stat-item">
                        <span className="stat-label">NODE:</span>
                        <span className="stat-value">{protocolLevel === 13 ? 'LAYER_13' : 'WIRED'}</span>
                      </div>
                    </div>
                  </div>
                </div>
                
              </div>
            </motion.div>

            {/* Window 2: Interactive Terminal */}
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
                <AnimatePresence mode="wait">
                  {!openFile ? (
                    <motion.div 
                      key="files"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="terminal-lines"
                    >
                      
                      <p 
                        className="terminal-line dir-folder"
                        onClick={() => toggleDirectory('SYSTEM')}
                        style={{ cursor: 'pointer' }}
                      >
                        <span className="folder-icon">{collapsedDirs.includes('SYSTEM') ? '📁' : '📂'}</span>
                        <span className="folder-name">SYSTEM/</span>
                        <span className="folder-count">({5} files)</span>
                      </p>
                      {!collapsedDirs.includes('SYSTEM') && (
                        <div className="file-list">
                          <p 
                            className="terminal-line file-entry"
                            onClick={() => handleFileClick('SYSTEM/NOTHING_STAYS_THE_SAME.TXT')}
                          >
                            <span className="file-icon">📄</span>
                            <span className="file-name">NOTHING_STAYS_THE_SAME.TXT</span>
                          </p>
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
                          <p 
                            className="terminal-line file-entry"
                            onClick={() => handleFileClick('SYSTEM/PROTOCOL_7.SYS')}
                          >
                            <span className="file-icon">🔧</span>
                            <span className="file-name">PROTOCOL_7.SYS</span>
                            <span className="file-badge">CORE</span>
                          </p>
                          <p 
                            className="terminal-line file-entry"
                            onClick={() => handleFileClick('SYSTEM/NAVI_CORE.EXE')}
                          >
                            <span className="file-icon">⚡</span>
                            <span className="file-name">NAVI_CORE.EXE</span>
                            <span className="file-badge">EXEC</span>
                          </p>
                        </div>
                      )}
                      
                      <p 
                        className="terminal-line dir-folder"
                        onClick={() => toggleDirectory('DATA')}
                        style={{ cursor: 'pointer' }}
                      >
                        <span className="folder-icon">{collapsedDirs.includes('DATA') ? '📁' : '📂'}</span>
                        <span className="folder-name">DATA/</span>
                        <span className="folder-count">({2} files)</span>
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
                      
                      {protocolLevel === 13 && (
                        <>
                          <motion.p 
                            className="terminal-line dir-folder layer13-folder"
                            onClick={() => toggleDirectory('SECRETS')}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            style={{ cursor: 'pointer' }}
                          >
                            <span className="folder-icon">{collapsedDirs.includes('SECRETS') ? '🔒' : '🔓'}</span>
                            <span className="folder-name secret">SECRETS/</span>
                            <span className="folder-count">({3} files)</span>
                          </motion.p>
                          {!collapsedDirs.includes('SECRETS') && (
                            <motion.div 
                              className="file-list"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                            >
                              <motion.p 
                                className="terminal-line file-entry layer13-file"
                                onClick={() => handleFileClick('SECRETS/LAIN.LOG')}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                              >
                                <span className="file-icon">👁️</span>
                                <span className="file-name">LAIN.LOG</span>
                                <span className="file-badge secret">LAYER_13</span>
                              </motion.p>
                              <motion.p 
                                className="terminal-line file-entry layer13-file"
                                onClick={() => handleFileClick('SECRETS/PSYCHE.DAT')}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                              >
                                <span className="file-icon">🧠</span>
                                <span className="file-name">PSYCHE.DAT</span>
                                <span className="file-badge secret">RESTRICTED</span>
                              </motion.p>
                              <motion.p 
                                className="terminal-line file-entry layer13-file"
                                onClick={() => handleFileClick('SECRETS/PROPHECY.LOG')}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                              >
                                <span className="file-icon">🔮</span>
                                <span className="file-name">PROPHECY.LOG</span>
                                <span className="file-badge secret">PROPHECY</span>
                              </motion.p>
                            </motion.div>
                          )}
                        </>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="content"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="terminal-lines file-content"
                    >
                      <button 
                        className="close-file-btn"
                        onClick={() => setOpenFile(null)}
                      >
                        [CLOSE FILE]
                      </button>
                      <pre className="file-text">{secretFiles[openFile as keyof typeof secretFiles]}</pre>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>

          {/* Center Column */}
          <div className="column-center">
            {/* Window 3: Protocol Switcher */}
            <motion.div 
              className="navi-window window-system"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1, delay: 0.6 }}
            >
              <div className="window-header">
                <div className="window-dots">
                  <span className="dot"></span>
                  <span className="dot"></span>
                  <span className="dot"></span>
                </div>
                <span className="window-title">PROTOCOL.SWITCH</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body">
                <div className="protocol-display">
                  <div className="protocol-main">
                    <span className="protocol-label">ACTIVE PROTOCOL:</span>
                    <button 
                      className="protocol-value"
                      onClick={handleProtocolClick}
                    >
                      IPv{protocolLevel}
                    </button>
                  </div>
                  <div className="protocol-grid">
                    <div className="protocol-item">
                      <span className="proto-label">LAYER:</span>
                      <span className="proto-value blink-slow">{String(protocolLevel).padStart(2, '0')}</span>
                    </div>
                    <div className="protocol-item">
                      <span className="proto-label">NODE:</span>
                      <span className="proto-value">{protocolLevel === 13 ? 'OUTER_LAYER' : 'THE_WIRED'}</span>
                    </div>
                    <div className="protocol-item">
                      <span className="proto-label">PRESENCE:</span>
                      <span className="proto-value blink-fast">{protocolLevel === 13 ? 'TRANSCENDENT' : 'OMNIPRESENT'}</span>
                    </div>
                  </div>
                </div>
                {protocolLevel === 13 && (
                  <motion.div 
                    className="layer13-access-bottom"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <p className="access-title">LAYER 13 ACCESS GRANTED</p>
                    <p className="access-subtitle">You've reached the outer layer...</p>
                  </motion.div>
                )}
              </div>
            </motion.div>

            {/* Window 4: Hidden Message Decoder */}
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
                      rows={12}
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
                        <p className="decoded-text">
                          {decodedMessage}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Right Column */}
          <div className="column-right">
            {/* Window 5: Links/Access Points */}
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
                    <span className="link-path">/senbon/ch</span>
                  </div>
                  <span className="link-arrow blink-slow">→</span>
                </a>
              </div>
            </motion.div>

            {/* Window 6: Network Monitor with Stats */}
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
                      <span className="metric-value">{protocolLevel === 13 ? 'TRANSCENDENT' : 'STABLE'}</span>
                    </div>
                  </div>
                </div>
                <div className="waveform">
                  <div className="wave wave1"></div>
                  <div className="wave wave2"></div>
                  <div className="wave wave3"></div>
                  <div className="wave wave4"></div>
                  <div className="wave wave5"></div>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Footer Bar */}
        <div className="navi-footer">
          <div className="footer-left">
            <span className="footer-text">{time.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          <div className="footer-center">
            <span className="glitch-subtle" data-text="PRESENT_DAY_PRESENT_TIME">
              PRESENT_DAY_PRESENT_TIME
            </span>
          </div>
          <div className="footer-right">
            <span className="footer-text">IP: {protocolLevel === 13 ? '13.13.13.13' : '127.0.0.1'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Home
