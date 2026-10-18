import { JOBS, type JobName, type JobResult } from './bakeJobs'
import type { Tier } from './types'

// The build's heavy, pure work runs in background threads from the first
// moment of the load, while the page waits for its images, so the page's own
// thread only assembles the parts. The jobs are queued in the order the build
// needs them and each worker takes the next one when it is free. The page
// runs a job itself when the build needs it before a worker has taken it,
// when no worker can start, or when it fails in one; the result is the same
// either way.

const ORDER: JobName[] = ['far', 'noise', 'atlas-blossom', 'cherry', 'atlas-maple', 'maples', 'atlas-cedar', 'grove', 'grass']

interface Job {
  name: JobName
  tier: Tier
  started: boolean
  done: Promise<unknown>
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

const jobs = new Map<string, Job>()
const queue: Job[] = []

function key(name: JobName, tier: Tier): string {
  return `${name}-${tier}`
}

export function startBakes(tier: Tier): void {
  if (typeof Worker === 'undefined') return
  for (const name of ORDER) {
    if (jobs.has(key(name, tier))) continue
    let resolve: (v: unknown) => void = () => {}
    let reject: (e: unknown) => void = () => {}
    const done = new Promise<unknown>((res, rej) => {
      resolve = res
      reject = rej
    })
    // nobody may be waiting when a job fails; that is not an error
    done.catch(() => {})
    const job: Job = { name, tier, started: false, done, resolve, reject }
    jobs.set(key(name, tier), job)
    queue.push(job)
  }
  const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1, queue.length))
  const running = new Map<number, Job>()
  const workers: Worker[] = []
  let nextId = 0
  const feed = (w: Worker) => {
    const job = queue.shift()
    if (!job) {
      w.terminate()
      return
    }
    const id = nextId++
    job.started = true
    running.set(id, job)
    w.postMessage({ id, job: job.name, tier: job.tier })
  }
  const fail = () => {
    for (const job of [...running.values(), ...queue.splice(0)]) job.reject(new Error('no worker'))
    running.clear()
    for (const w of workers) w.terminate()
  }
  try {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
        const job = running.get(e.data.id)
        running.delete(e.data.id)
        if (e.data.error !== undefined) job?.reject(new Error(e.data.error))
        else job?.resolve(e.data.result)
        feed(w)
      }
      // a worker that cannot load: the page runs every job instead
      w.onerror = (e) => {
        e.preventDefault()
        fail()
      }
      workers.push(w)
    }
  } catch {
    fail()
    return
  }
  for (const w of workers) feed(w)
}

// the result of a job: from a worker if one has taken it, else made here
export async function baked<K extends JobName>(name: K, tier: Tier): Promise<JobResult<K>> {
  const job = jobs.get(key(name, tier))
  jobs.delete(key(name, tier))
  const queued = job ? queue.indexOf(job) : -1
  if (queued >= 0) queue.splice(queued, 1)
  else if (job?.started) {
    try {
      return (await job.done) as JobResult<K>
    } catch {
      // made here below
    }
  }
  return JOBS[name](tier) as JobResult<K>
}
