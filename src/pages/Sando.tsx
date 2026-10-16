import { useEffect, useRef, useState } from 'react'
import type { Realm } from '../realm/realm'
import { LINKS } from '../links'
import './Sando.css'

// The page is the realm: a full-screen canvas the visitor wakes up in. The
// three.js layer loads through a dynamic import so this shell paints first.
// The links are written out for real below the canvas for screen readers,
// keyboards and browsers without WebGL.

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
      <main className={noScene ? 'sando-fallback' : 'sando-sr'}>
        <h1>Punds</h1>
        <nav>
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.name}
            </a>
          ))}
        </nav>
      </main>
    </div>
  )
}
