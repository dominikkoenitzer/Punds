// The hidden diagnostic panel (open the page with ?diag) and the page measurements every visit sends, both off unless
// the build names an endpoint in VITE_DIAG_ENDPOINT. The panel posts to <endpoint>/v1/diag after a click and shows the
// code it gets back; the measurements go to <endpoint>/v1/beacon when the page is hidden. No cookies, no stored
// identifier, no user agent string, no address: src/diag/ is the shared package, copied in unchanged.
// Only the error and timing hooks load with the page; the panel and the beacon code come once it has loaded.
import { installCapture } from './diag/capture.js'
import { installVitals } from './diag/measure.js'

const BASE = String(import.meta.env.VITE_DIAG_ENDPOINT ?? '').replace(/\/+$/, '')
const RELEASE = import.meta.env.VITE_RELEASE ? String(import.meta.env.VITE_RELEASE) : null

// imported first in main.tsx, so errors and page timings are kept from the start
if (BASE) {
  installCapture()
  installVitals()
}

export interface DiagSource {
  // the garden's measured quality, as short scalars
  quality: () => Record<string, string | number | boolean | null>
  canvas: () => HTMLCanvasElement | null
}

let started = false

export function startDiag(source: DiagSource): void {
  if (!BASE || started) return
  started = true
  const start = () =>
    import('./diag/index.js').then(({ maybeMountDiag, startVitals }) => {
      maybeMountDiag({ app: 'punds', release: RELEASE, endpoint: `${BASE}/v1/diag`, quality: source.quality, canvas: source.canvas })
      // the page's vitals were kept since the start, so a beacon set up now still reports them
      startVitals({ app: 'punds', release: RELEASE, endpoint: `${BASE}/v1/beacon`, quality: source.quality, gpu: true })
    })
  if (document.readyState === 'complete') void start()
  else addEventListener('load', () => void start(), { once: true })
}

// a lighter garden or the still picture: the beacon carries each change
export function diagLevel(level: string): void {
  if (!BASE) return
  void import('./diag/index.js').then(({ reportTier }) => reportTier({ tier: level }))
}
