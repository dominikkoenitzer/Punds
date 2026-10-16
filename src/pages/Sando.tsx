import { useEffect, useRef, useState } from 'react'
import type { CursorState, Realm } from '../realm/realm'
import { LINKS } from '../links'
import './Sando.css'

// The page is the realm: a full-screen canvas that fades straight into the
// garden. The three.js layer loads through a dynamic import so this shell
// paints first. The links are written out for real below the canvas for
// screen readers and keyboards; without WebGL, or on a device too weak to
// carry the scene, they show over a still picture of the garden.

function supportsWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

declare global {
  interface Window {
    __realm?: Realm
  }
}

export default function Sando() {
  const containerRef = useRef<HTMLDivElement>(null)
  const realmRef = useRef<Realm | null>(null)
  const [noScene, setNoScene] = useState(() => !supportsWebGL2())
  const [sound, setSound] = useState(false)
  // the one hint: shown once the garden is there, gone at the first look
  const [cue, setCue] = useState<'waiting' | 'shown' | 'gone'>('waiting')
  const [load, setLoad] = useState(0)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  // the page's own cursor over the scene: a small soft dot that opens to a
  // ring over anything that can be clicked, with the name where one fits
  const dotRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<{ state: CursorState; label: string | null }>({ state: 'idle', label: null })

  useEffect(() => {
    const el = containerRef.current
    const dot = dotRef.current
    if (!el || !dot) return
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      dot.dataset.on = 'true'
    }
    const leave = () => {
      dot.dataset.on = 'false'
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerleave', leave)
    }
  }, [])

  const toggleSound = () => {
    const next = !(realmRef.current?.sound ?? sound)
    realmRef.current?.setSound(next)
    setSound(next)
  }

  // M switches the sound too; held keys and shortcuts with modifiers do not
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() !== 'm') return
      const next = !(realmRef.current?.sound ?? false)
      realmRef.current?.setSound(next)
      setSound(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || noScene) return
    let realm: Realm | null = null
    let cancelled = false
    void (async () => {
      try {
        const [{ Realm }, { buildIsland }] = await Promise.all([import('../realm/realm'), import('../realm/island')])
        if (cancelled) return
        realm = new Realm(container, {
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          onTooSlow: () => {
            if (!cancelled) setNoScene(true)
          },
          onReady: () => {
            window.setTimeout(() => setCue((c) => (c === 'waiting' ? 'shown' : c)), 1200)
          },
          onMove: () => setCue('gone'),
          onLoad: (f) => setLoad(f),
          onCursor: (state, label) => setCursor({ state, label }),
        })
        realmRef.current = realm
        if (new URLSearchParams(location.search).has('debug')) window.__realm = realm
        await realm.start(buildIsland)
      } catch (err) {
        console.error(err)
        realmRef.current = null
        if (!cancelled) setNoScene(true)
      }
    })()
    return () => {
      cancelled = true
      realm?.dispose()
      realmRef.current = null
    }
  }, [noScene])

  return (
    <div className="sando-root">
      <div aria-hidden="true" className="sando-canvas" ref={containerRef} />
      {!noScene && (
        <div aria-hidden="true" className="sando-load" data-done={load >= 1}>
          <i style={{ transform: `scaleX(${Math.max(0.04, load)})` }} />
        </div>
      )}
      {!noScene && (
        <p aria-hidden="true" className="sando-cue" data-state={cue}>
          {touch ? 'look around · tap to explore' : 'look around · click to explore'}
        </p>
      )}
      {!noScene && (
        <button type="button" className="sando-sound" aria-pressed={sound} onClick={toggleSound}>
          sound
        </button>
      )}
      {!noScene && (
        <div aria-hidden="true" className="sando-dot" ref={dotRef} data-state={cursor.state} data-on="false">
          {cursor.label && <span>{cursor.label}</span>}
        </div>
      )}
      <main className={noScene ? 'sando-fallback' : 'sando-menu'}>
        <h1>Punds</h1>
        <p className="sando-about">A quiet shrine garden on an island above the clouds.</p>
        <nav>
          {LINKS.map((l, i) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              onFocus={() => {
                // a keyboard visitor is taken to the rack and sees the plaque turn
                realmRef.current?.focusLink(i)
              }}
              onBlur={() => realmRef.current?.focusLink(null)}
            >
              {l.name}
            </a>
          ))}
        </nav>
      </main>
    </div>
  )
}
