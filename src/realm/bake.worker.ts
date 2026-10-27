import { JOBS, transferables, type JobName } from './bakeJobs'
import type { Tier } from './types'

// One background thread of the build: it runs the jobs it is sent, one at a
// time, and hands each result over without copying it.

interface Request {
  id: number
  job: JobName
  tier: Tier
}

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, job, tier } = e.data
  try {
    const t0 = performance.now()
    const result = JOBS[job](tier)
    self.postMessage({ id, result, ms: performance.now() - t0, end: performance.timeOrigin + performance.now() }, { transfer: transferables(result) })
  } catch (err) {
    self.postMessage({ id, error: String(err) })
  }
}
