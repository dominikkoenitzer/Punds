import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { FaGithub, FaPaypal, FaGlobe } from 'react-icons/fa'
import './Home.css'

const Home = () => {
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 })
  const [cursorTrail, setCursorTrail] = useState<Array<{ x: number; y: number; id: number }>>([])
  const [time, setTime] = useState(new Date())
  const [commandText, setCommandText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  
  const commands = [
    'INITIALIZING NAVI SYSTEM...',
    'CONNECTING TO THE WIRED...',
    'LOADING USER DATA...',
    'REALITY.EXE NOT FOUND',
    'SYSTEM READY',
  ]
  const [commandIndex, setCommandIndex] = useState(0)

  // Cursor trail effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setCursorPos({ x: e.clientX, y: e.clientY })
      
      setCursorTrail(prev => {
        const newTrail = [...prev, { x: e.clientX, y: e.clientY, id: Date.now() }]
        return newTrail.slice(-15) // Keep last 15 positions
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

  // Typing effect
  useEffect(() => {
    if (!isTyping && commandIndex < commands.length) {
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
  }, [commandIndex, isTyping])

  return (
    <div className="navi-system">
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
            {/* Window 1: User Profile */}
            <motion.div 
              className="navi-window window-profile"
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
                <div className="profile-image-container">
                  <div className="image-static"></div>
                  <img 
                    src="https://avatars.githubusercontent.com/u/82450286?v=4" 
                    alt="User"
                    className="profile-image glitch-image"
                  />
                  <div className="image-scanline"></div>
                </div>
                <div className="profile-info">
                  <h1 className="profile-name glitch-text" data-text="DOMINIK_KÖNITZER">
                    DOMINIK_KÖNITZER
                  </h1>
                  <p className="profile-id">
                    <span className="label">ID:</span> <span className="value">USER#82450286</span>
                  </p>
                  <p className="profile-status">
                    <span className="label">STATUS:</span> 
                    <span className="value blink-fast">CONNECTED_TO_WIRED</span>
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Window 2: Command Terminal */}
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
                <div className="terminal-lines">
                  <p className="terminal-line">
                    <span className="prompt">&gt;</span> NOTHING_STAYS_THE_SAME.TXT
                  </p>
                  <p className="terminal-line">
                    <span className="prompt">&gt;</span> REALITY.DLL LOADED
                  </p>
                  <p className="terminal-line typing-line">
                    <span className="prompt">&gt;</span> {commandText}
                    <span className="cursor-blink">_</span>
                  </p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Center Column */}
          <div className="column-center">
            {/* Window 3: System Info */}
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
                <span className="window-title">SYSTEM.INFO</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body">
                <div className="system-grid">
                  <div className="system-item">
                    <span className="sys-label">PROTOCOL</span>
                    <span className="sys-value">IPv7</span>
                  </div>
                  <div className="system-item">
                    <span className="sys-label">LAYER</span>
                    <span className="sys-value blink-slow">07</span>
                  </div>
                  <div className="system-item">
                    <span className="sys-label">NODE</span>
                    <span className="sys-value">THE_WIRED</span>
                  </div>
                  <div className="system-item">
                    <span className="sys-label">PRESENCE</span>
                    <span className="sys-value blink-fast">OMNIPRESENT</span>
                  </div>
                </div>
                
                {/* ASCII Art */}
                <div className="ascii-art">
                  <pre>{`
    ▲▼▲▼▲▼▲▼▲▼▲▼▲▼▲▼
    ▼ CLOSE THE  ▲
    ▲  WORLD,    ▼
    ▼  OPEN THE  ▲
    ▲   nExt     ▼
    ▼▲▼▲▼▲▼▲▼▲▼▲▼▲▼▲
                  `}</pre>
                </div>
              </div>
            </motion.div>

            {/* Window 4: Message */}
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
                <span className="window-title">MESSAGE.LOG</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body message-body">
                <p className="message-text glitch-subtle">
                  "No matter where you are, everyone is always connected."
                </p>
                <p className="message-author">— Lain Iwakura</p>
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

            {/* Window 6: Network Status */}
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
                <span className="window-title">NETWORK.STATUS</span>
                <span className="window-status blink-slow">●</span>
              </div>
              <div className="window-body network-body">
                <div className="network-lines">
                  <div className="network-line">
                    <span className="net-label">PACKET_LOSS:</span>
                    <span className="net-value">0.00%</span>
                  </div>
                  <div className="network-line">
                    <span className="net-label">LATENCY:</span>
                    <span className="net-value blink-slow">0ms</span>
                  </div>
                  <div className="network-line">
                    <span className="net-label">CONNECTION:</span>
                    <span className="net-value">STABLE</span>
                  </div>
                </div>
                <div className="waveform">
                  <div className="wave wave1"></div>
                  <div className="wave wave2"></div>
                  <div className="wave wave3"></div>
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
            <span className="footer-text">© 2025 D.K.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Home
