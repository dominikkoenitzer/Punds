import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { FaGithub, FaPaypal, FaGlobe, FaEye, FaEyeSlash } from 'react-icons/fa'
import './Home.css'

const Home = () => {
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
  const [cursorTrail, setCursorTrail] = useState<Array<{ x: number; y: number; id: number }>>([])
  const [time, setTime] = useState(new Date())
  const [commandText, setCommandText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [protocolLevel, setProtocolLevel] = useState(7)
  const [secretRevealed, setSecretRevealed] = useState(false)
  const [clickCount, setClickCount] = useState(0)
  const [matrixMode, setMatrixMode] = useState(false)
  const [hiddenMessageFound, setHiddenMessageFound] = useState(false)
  const [hexInput, setHexInput] = useState('')
  const [decodedMessage, setDecodedMessage] = useState('')
  const [protocolClicks, setProtocolClicks] = useState(0)
  const [lastProtocolClick, setLastProtocolClick] = useState(0)
  const [volume, setVolume] = useState(30)
  const [bandwidth, setBandwidth] = useState(1.21)
  const [latency, setLatency] = useState(0)
  const [packetLoss, setPacketLoss] = useState(0.00)
  
  const commands = [
    'INITIALIZING NAVI SYSTEM...',
    'CONNECTING TO THE WIRED...',
    'LOADING USER DATA...',
    'REALITY.EXE NOT FOUND',
    'SYSTEM READY',
  ]
  const [commandIndex, setCommandIndex] = useState(0)

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
4C41494E2049574B5552412049532047
4F442E20574520415245204C41494E2E
-----END WIRED KEY-----

God is here.
    `,
    'SYSTEM/KNIGHTS.DAT': `
> File: KNIGHTS.DAT
> Organization: THE_KNIGHTS
> Status: ENCRYPTED

The Knights of the Eastern Calculus
Protecting the barriers between
The Wired and reality...

Or are they creating them?
    `
  }

  // Cursor trail effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY })
      setCursorTrail(prev => {
        const newTrail = [...prev, { x: e.clientX, y: e.clientY, id: Date.now() }]
        return newTrail.slice(-15)
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  // Time update and network stats modulation
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date())
      // Modulate network stats randomly
      setBandwidth(prev => +(prev + (Math.random() - 0.5) * 0.1).toFixed(2))
      setLatency(Math.floor(Math.random() * 3))
      setPacketLoss(+(Math.random() * 0.01).toFixed(2))
    }, 1000)
    return () => clearInterval(interval)
  }, [])
  
  // Volume control
  useEffect(() => {
    const iframe = document.getElementById('lain-audio') as HTMLIFrameElement
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage(JSON.stringify({
        event: 'command',
        func: 'setVolume',
        args: [volume]
      }), '*')
    }
  }, [volume])

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
  }, [commandIndex, isTyping, openFile])

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
      setProtocolLevel(prev => prev === 7 ? 13 : 7)
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
      setHiddenMessageFound(true)
    } catch (error) {
      setDecodedMessage('ERROR: Invalid hex format')
    }
  }

  const handleSecretClick = () => {
    setClickCount(prev => prev + 1)
    if (clickCount >= 6) {
      setSecretRevealed(true)
      setMatrixMode(true)
      setTimeout(() => {
        setMatrixMode(false)
      }, 5000)
    }
  }

  return (
    <div className={`navi-system ${protocolLevel === 13 ? 'layer13-theme' : ''}`}>
      {/* Hidden Audio Player - Serial Experiments Lain Opening */}
      <iframe 
        id="lain-audio"
        frameBorder="0"
        allow="autoplay"
        title="Lain Audio"
        width="0" 
        height="0" 
        src="https://www.youtube.com/embed/_W1P7AvV17w?autoplay=1&mute=0&enablejsapi=1&loop=1&playlist=_W1P7AvV17w"
        style={{ display: 'none' }}
      />
      
      {/* Volume Control */}
      <div className="volume-control">
        <div className="volume-icon">🔊</div>
        <input 
          type="range" 
          min="0" 
          max="100" 
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="volume-slider"
        />
        <span className="volume-value">{volume}%</span>
      </div>
      
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
                    <h1 className="profile-name-large">
                      DOMINIK_KÖNITZER
                    </h1>
                    <div className="profile-stats-grid">
                      <div className="stat-item">
                        <span className="stat-label">USER_ID:</span>
                        <span className="stat-value">82450286</span>
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
                    {protocolLevel === 13 && (
                      <motion.div 
                        className="profile-bio layer13-unlocked"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                      >
                        <p className="glitch-fast" data-text="LAYER 13 ACCESS GRANTED">LAYER 13 ACCESS GRANTED</p>
                        <span className="bio-subtext">You've reached the outer layer...</span>
                      </motion.div>
                    )}
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
                <span className="window-title">TERMINAL.EXE</span>
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
                      <p className="terminal-line">
                        <span className="prompt">&gt;</span> DIR /
                      </p>
                      <p className="terminal-line directory-line">
                        <span className="prompt">&gt;</span> 
                        <span className="dir-name">/SYSTEM</span>
                      </p>
                      <p 
                        className="terminal-line clickable-file file-indent"
                        onClick={() => handleFileClick('SYSTEM/NOTHING_STAYS_THE_SAME.TXT')}
                      >
                        <span className="prompt">&gt;</span> 
                        <span className="file-name">NOTHING_STAYS_THE_SAME.TXT</span>
                      </p>
                      <p 
                        className="terminal-line clickable-file file-indent"
                        onClick={() => handleFileClick('SYSTEM/REALITY.DLL')}
                      >
                        <span className="prompt">&gt;</span> 
                        <span className="file-name">REALITY.DLL</span>
                      </p>
                      <p 
                        className="terminal-line clickable-file file-indent"
                        onClick={() => handleFileClick('SYSTEM/KNIGHTS.DAT')}
                      >
                        <span className="prompt">&gt;</span> 
                        <span className="file-name">KNIGHTS.DAT</span>
                      </p>
                      <p className="terminal-line directory-line">
                        <span className="prompt">&gt;</span> 
                        <span className="dir-name">/DATA</span>
                      </p>
                      <p 
                        className="terminal-line clickable-file file-indent"
                        onClick={() => handleFileClick('DATA/MESSAGE.HEX')}
                      >
                        <span className="prompt">&gt;</span> 
                        <span className="file-name">MESSAGE.HEX</span>
                        <span className="file-badge">ENCODED</span>
                      </p>
                      <p 
                        className="terminal-line clickable-file file-indent"
                        onClick={() => handleFileClick('DATA/WIRED_ACCESS.KEY')}
                      >
                        <span className="prompt">&gt;</span> 
                        <span className="file-name">WIRED_ACCESS.KEY</span>
                      </p>
                      {protocolLevel === 13 && (
                        <>
                          <motion.p 
                            className="terminal-line directory-line"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                          >
                            <span className="prompt">&gt;</span> 
                            <span className="dir-name secret">/SECRETS</span>
                          </motion.p>
                          <motion.p 
                            className="terminal-line clickable-file file-indent layer13-file"
                            onClick={() => handleFileClick('SECRETS/LAIN.LOG')}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                          >
                            <span className="prompt">&gt;</span> 
                            <span className="file-name">LAIN.LOG</span>
                            <span className="file-badge secret">LAYER_13</span>
                          </motion.p>
                        </>
                      )}
                      <p className="terminal-line typing-line">
                        <span className="prompt">&gt;</span> {commandText}
                        <span className="cursor-blink">_</span>
                      </p>
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
                  {protocolLevel === 13 && (
                    <motion.div 
                      className="secret-message"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <p className="glitch-fast" data-text="LAYER 13 ACCESS GRANTED">LAYER 13 ACCESS GRANTED</p>
                      <p className="secret-text">You've reached the outer layer...</p>
                    </motion.div>
                  )}
                </div>
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
                      placeholder="4E 6F 20 6D 61 74 74 65 72..."
                      rows={5}
                    />
                  </div>
                  <button 
                    className="decode-btn"
                    onClick={handleHexDecode}
                  >
                    <FaEye />
                    <span>DECODE MESSAGE</span>
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
                              setHiddenMessageFound(false)
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
                <div className="network-stats-grid">
                  <div className="stat-box">
                    <span className="stat-label-small">UPTIME</span>
                    <span className="stat-value-large">{Math.floor(time.getSeconds() + time.getMinutes() * 60)}s</span>
                  </div>
                  <div className="stat-box">
                    <span className="stat-label-small">BANDWIDTH</span>
                    <span className="stat-value-large">{bandwidth.toFixed(2)} GB/s</span>
                  </div>
                </div>
                <div className="network-lines">
                  <div className="network-line">
                    <span className="net-label">PACKET_LOSS:</span>
                    <span className="net-value">{packetLoss.toFixed(2)}%</span>
                    <div className="mini-bar">
                      <div className="bar-fill" style={{ width: `${100 - packetLoss * 100}%` }}></div>
                    </div>
                  </div>
                  <div className="network-line">
                    <span className="net-label">LATENCY:</span>
                    <span className="net-value">{latency}ms</span>
                    <div className="mini-bar">
                      <div className="bar-fill" style={{ width: `${Math.max(0, 100 - latency * 10)}%` }}></div>
                    </div>
                  </div>
                  <div className="network-line">
                    <span className="net-label">CONNECTION:</span>
                    <span className="net-value">{protocolLevel === 13 ? 'TRANSCENDENT' : 'STABLE'}</span>
                    <div className="mini-bar">
                      <div className="bar-fill" style={{ width: '100%' }}></div>
                    </div>
                  </div>
                </div>
                <div 
                  className="secret-trigger"
                  onClick={handleSecretClick}
                >
                  <div className="waveform">
                    <div className="wave wave1"></div>
                    <div className="wave wave2"></div>
                    <div className="wave wave3"></div>
                    <div className="wave wave4"></div>
                    <div className="wave wave5"></div>
                  </div>
                  {secretRevealed && (
                    <motion.p 
                      className="secret-revealed"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                    >
                      LET'S ALL LOVE LAIN
                    </motion.p>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        {/* Footer Bar */}
        <div className="navi-footer">
          <div className="footer-left">
            <span className="footer-text">ALL_IS_CONNECTED</span>
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
