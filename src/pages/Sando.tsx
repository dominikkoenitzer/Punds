import { useEffect, useRef, useState, type RefObject } from 'react'
import type { CursorState, Realm } from '../realm/realm'
import { diagLevel, startDiag } from '../diagBoot'
import QualityOverlay from './QualityOverlay'
import type { Tier } from '../realm/types'
import { LINKS } from '../links'
import { loadDress, posterFolder } from '../realm/season'
import { refuseSoftware, softwareRenderer } from '../realm/testMode'
import { pressSound } from '../realm/soundSwitch'
import './Sando.css'

// The page is the realm: a full-screen canvas that fades straight into the
// garden. The three.js layer loads through a dynamic import so this shell
// paints first. The links are written out for real below the canvas for
// screen readers and keyboards; without WebGL, or on a device too weak to
// carry the scene, they show over a still picture of the garden.

// asked with the same flag as the scene's own context, so a computer without a
// graphics chip gets the still page at once and no error in its console
function supportsWebGL2(): boolean {
  try {
    const refuse = refuseSoftware()
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: refuse })
    const usable = !!gl && !(refuse && softwareRenderer(gl))
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return usable
  } catch {
    return false
  }
}

declare global {
  interface Window {
    __realm?: Realm
  }
}

// The start view as pictures, each for the screens whose view it matches by
// cropping (keep the media and sizes in step with the preloads in
// index.html). From 17:18 to 12:5, which takes in the 21:9 monitors, the
// scene keeps a vertical field of 40 degrees, so the wide one fills the
// height; below it a horizontal field of 38 degrees until the vertical
// reaches 72 at 0.474, which is the tall one's shape: it fills the width
// above that and the height below.
// A season may have its own set, in its own folder.
const PICTURES = posterFolder()
const POSTERS = [
  { media: '(min-aspect-ratio: 17/18) and (max-aspect-ratio: 12/5)', src: `${PICTURES}/poster-wide.webp`, srcSet: `${PICTURES}/poster-wide.webp 2592w, ${PICTURES}/poster-wide-4k.webp 5184w`, sizes: 'calc(100vh * 12 / 5)' },
  { media: '(max-aspect-ratio: 17/18)', src: `${PICTURES}/poster-tall.webp`, srcSet: `${PICTURES}/poster-tall.webp 948w`, sizes: '100vw' },
]

// resolves once the start picture is on screen (decoded and painted), or at
// once without one
function pictureShown(img: HTMLImageElement | null): Promise<void> {
  if (!img) return Promise.resolve()
  return img
    .decode()
    .catch(() => {})
    .then(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')

// the written page: the links for screen readers and keyboards below the
// canvas, or over the still picture when there is no scene
function Menu({ still, realm }: { still: boolean; realm?: RefObject<Realm | null> }) {
  return (
    <main className={still ? 'sando-fallback' : 'sando-menu'}>
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
              realm?.current?.focusLink(i)
            }}
            onBlur={() => realm?.current?.focusLink(null)}
          >
            {l.name}
          </a>
        ))}
      </nav>
    </main>
  )
}

// what the page shows when the scene itself broke (SceneBoundary)
export function StillPage() {
  return (
    <div className="sando-root">
      <Menu still />
    </div>
  )
}

export default function Sando() {
  const containerRef = useRef<HTMLDivElement>(null)
  const realmRef = useRef<Realm | null>(null)
  const posterRef = useRef<HTMLImageElement>(null)
  const [noScene, setNoScene] = useState(() => !supportsWebGL2())
  // set when this device measured the garden too heavy and builds a lighter one
  const [level, setLevel] = useState<Tier | undefined>(undefined)
  const [sound, setSound] = useState(false)
  // the one hint: shown once the garden is there, gone at the first look
  const [cue, setCue] = useState<'waiting' | 'shown' | 'gone'>('waiting')
  const [load, setLoad] = useState(0)
  // counts the times the scene was built again after the GPU dropped it
  const [rebuilds, setRebuilds] = useState(0)
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
  // a picture of the start view while the scene loads (see .sando-poster)
  const [poster] = useState(() => (typeof window === 'undefined' ? null : POSTERS.find((p) => window.matchMedia(p.media).matches) ?? null))
  // the page's own cursor over the scene: a small soft dot that opens to a
  // faint ring over anything that can be clicked; the names are on the
  // plaques themselves
  const dotRef = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<CursorState>('idle')

  // the diagnostic panel and the page measurements, when the build turns them on (diagBoot.ts)
  useEffect(() => {
    startDiag({
      quality: () => {
        const r = realmRef.current
        if (!r) return { tier: 'still' }
        const q = r.qualityInfo
        return { tier: q.tier, scale: q.scale, dpr: q.dpr, p75: q.window.p75, budget: q.window.budget, cost: q.cost }
      },
      canvas: () => realmRef.current?.renderer.domElement ?? null,
    })
  }, [])

  useEffect(() => {
    if (level) diagLevel(level)
  }, [level])

  useEffect(() => {
    if (noScene) diagLevel('still')
  }, [noScene])

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

  const [realmOf] = useState(() => () => realmRef.current)
  const toggleSound = () => setSound(pressSound(realmRef.current))

  // M switches the sound too; held keys and shortcuts with modifiers do not
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() !== 'm') return
      setSound(pressSound(realmRef.current))
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
        const [{ Realm }, { buildIsland, prepareIsland }, { lighterLevel, rememberLevel }] = await Promise.all([import('../realm/realm'), import('../realm/island'), import('../realm/quality'), loadDress()])
        if (cancelled) return
        realm = new Realm(container, {
          ...(level ? { tier: level } : {}),
          instant: poster !== null,
          shown: pictureShown(posterRef.current),
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          onTooSlow: (over) => {
            if (cancelled || !realm) return
            // far over: one level lighter would not be enough, and every
            // rebuild costs the visitor seconds
            const lighter = over > 4 ? (realm.tier === 'phone' ? null : 'phone') : lighterLevel(realm.tier)
            if (lighter && !new URLSearchParams(location.search).has('tier')) {
              rememberLevel(lighter)
              setLevel(lighter)
            } else {
              setNoScene(true)
            }
          },
          onFail: () => {
            if (!cancelled) setNoScene(true)
          },
          onLost: () => {
            if (cancelled) return
            setSound(false)
            setRebuilds((n) => n + 1)
          },
          onReady: () => {
            window.setTimeout(() => setCue((c) => (c === 'waiting' ? 'shown' : c)), 1200)
          },
          onMove: () => setCue('gone'),
          onLoad: (f) => setLoad(f),
          onCursor: (state) => setCursor(state),
        })
        realmRef.current = realm
        if (new URLSearchParams(location.search).has('debug')) window.__realm = realm
        prepareIsland(realm.tier)
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
  }, [noScene, poster, rebuilds, level])

  return (
    <div className="sando-root">
      <div aria-hidden="true" className="sando-canvas" ref={containerRef} />
      {!noScene && poster && <img ref={posterRef} aria-hidden="true" className="sando-poster" data-done={load >= 1} src={poster.src} srcSet={poster.srcSet} sizes={poster.sizes} alt="" fetchPriority="high" />}
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
        <div aria-hidden="true" className="sando-dot" ref={dotRef} data-state={cursor} data-on="false" />
      )}
      {DEBUG && <QualityOverlay realm={realmOf} />}
      <Menu still={noScene} realm={realmRef} />
    </div>
  )
}
