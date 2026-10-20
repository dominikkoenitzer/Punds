// GPU time per section of the frame, for headless cost checks only (`?debug&gpu`).
// Sections are timed with disjoint timer queries, which cannot nest: each
// begin() closes the open section. Results arrive a few frames late and are
// averaged over the last 120 readings per label.

interface TimerExt {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

export class GpuTimer {
  private gl: WebGL2RenderingContext
  private ext: TimerExt | null
  private open: { label: string; q: WebGLQuery } | null = null
  private pending: { label: string; q: WebGLQuery }[] = []
  private samples = new Map<string, number[]>()

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null
  }

  get available(): boolean {
    return !!this.ext
  }

  begin(label: string): void {
    if (!this.ext) return
    this.end()
    const q = this.gl.createQuery()
    if (!q) return
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
    this.open = { label, q }
  }

  end(): void {
    if (!this.ext || !this.open) return
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.open)
    this.open = null
  }

  // call once a frame, after the last section
  collect(): void {
    if (!this.ext) return
    this.end()
    const gl = this.gl
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean
    while (this.pending.length) {
      const { label, q } = this.pending[0]!
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      this.pending.shift()
      if (!disjoint) {
        const ms = (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6
        const list = this.samples.get(label) ?? []
        list.push(ms)
        if (list.length > 120) list.shift()
        this.samples.set(label, list)
      }
      gl.deleteQuery(q)
    }
  }

  // label -> average milliseconds
  report(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const [label, list] of this.samples) out[label] = list.reduce((a, b) => a + b, 0) / Math.max(1, list.length)
    return out
  }

  reset(): void {
    this.samples.clear()
  }
}

// The GPU time of whole frames, for the quality steps (see quality.ts): one
// query per frame, read back a few frames later. Absent where the browser
// hides the timer; the frame loop then goes by the time between frames.
export class FrameTimer {
  private gl: WebGL2RenderingContext
  private ext: TimerExt | null
  private open: WebGLQuery | null = null
  private pending: WebGLQuery[] = []

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null
  }

  get available(): boolean {
    return !!this.ext
  }

  begin(): void {
    if (!this.ext || this.open || this.pending.length > 4) return
    const q = this.gl.createQuery()
    if (!q) return
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
    this.open = q
  }

  end(): void {
    if (!this.ext || !this.open) return
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.open)
    this.open = null
  }

  // milliseconds of the frames finished since the last call
  collect(into: number[]): void {
    if (!this.ext) return
    const gl = this.gl
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean
    while (this.pending.length) {
      const q = this.pending[0]!
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      this.pending.shift()
      if (!disjoint) into.push((gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6)
      gl.deleteQuery(q)
    }
  }

  dispose(): void {
    if (this.open && this.ext) this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    for (const q of [...this.pending, this.open]) if (q) this.gl.deleteQuery(q)
    this.pending = []
    this.open = null
  }
}
