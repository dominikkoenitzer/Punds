import { useEffect, useState } from 'react'
import type { Realm } from '../realm/realm'

// `?debug`: what the garden chose on this device and what its frames cost, read twice a second.
export default function QualityOverlay({ realm }: { realm: () => Realm | null }) {
  const [text, setText] = useState('')
  useEffect(() => {
    const id = window.setInterval(() => {
      const r = realm()
      if (!r) {
        setText('no scene')
        return
      }
      const q = r.qualityInfo
      const c = r.renderer.domElement
      const f = r.frameStats()
      setText(
        [
          `${q.tier} level, scale ${q.scale.toFixed(2)}, ${c.width}x${c.height} at ${q.dpr.toFixed(2)}x`,
          `window p75 ${q.window.p75} of ${q.window.budget} ms (${q.cost})`,
          `frames ${f.avg.toFixed(1)} ms average, p95 ${f.p95.toFixed(1)} ms`,
        ].join('\n'),
      )
    }, 500)
    return () => window.clearInterval(id)
  }, [realm])
  return text ? (
    <pre className="sando-debug" aria-hidden="true" data-testid="quality">
      {text}
    </pre>
  ) : null
}
