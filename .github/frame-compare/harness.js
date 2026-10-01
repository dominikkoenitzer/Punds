// Runs in the page before the site's own scripts, right after Playwright's
// fake clock is installed (paused, so the page sees no time pass on its own).
// It pins down everything else that would make two runs of the same build
// draw different pixels, and gives capture.mjs a way to step the clock one
// timer at a time and read each frame straight off the canvas.
;(() => {
  const fc = {
    frames: 0,
    randomCalls: 0,
    completionQueries: 0,
    timersFired: 0,
    firstFrameTick: null,
    lastFrameTick: null,
    sceneRaf: null,
    sceneCallback: null,
    pace: null,
    wants: [],
    captures: [],
    errors: [],
    parallelCompileStandIn: false,
    initError: null,
  }
  window.__fc = fc

  const pw = globalThis.__pwClock
  if (!pw || !pw.controller) {
    fc.initError = 'the fake clock is not installed ahead of the harness'
    return
  }
  const clock = pw.controller
  // the browser's own timer, which the fake clock leaves alone
  const realSetTimeout = pw.builtins.setTimeout
  for (const name of ['_firstTimer', '_callFirstTimer', '_advanceNow']) {
    if (typeof clock[name] !== 'function') fc.initError = `the fake clock has no ${name}()`
  }
  if (!(clock._timers instanceof Map) || typeof clock._now !== 'object') {
    fc.initError = 'the fake clock keeps its timers differently than this harness expects'
  }

  // One fixed sequence (mulberry32), so every random placement, texture and
  // bloom flicker repeats exactly. Counted, so two runs can show they drew the
  // same number of values.
  let seed = 0x5eed1234
  Math.random = function random() {
    fc.randomCalls++
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  // The ambient hum's analyser runs on the audio thread's clock, not the fake
  // one, and its level feeds the bloom. With no AudioContext the level stays 0,
  // as it does for every visitor who has not clicked yet.
  window.AudioContext = undefined
  window.webkitAudioContext = undefined

  // compileAsync() polls COMPLETION_STATUS_KHR on a 10 ms timer, so the fake
  // time that passes before the first frame would depend on how fast the GPU
  // links each program. Answering "complete" lets it resolve on its first
  // check. A program that is not linked yet still blocks on first use, so no
  // pixel changes; only the waiting goes. Where the browser lacks
  // KHR_parallel_shader_compile, three.js would start with a 10 ms timer
  // instead, so a stand-in object keeps it on the same path. three.js reads
  // the extension for nothing else.
  const COMPLETION_STATUS_KHR = 0x91b1
  for (const Ctx of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!Ctx) continue
    const getProgramParameter = Ctx.prototype.getProgramParameter
    Ctx.prototype.getProgramParameter = function (program, pname) {
      if (pname === COMPLETION_STATUS_KHR) {
        fc.completionQueries++
        return true
      }
      return getProgramParameter.call(this, program, pname)
    }
    const getExtension = Ctx.prototype.getExtension
    Ctx.prototype.getExtension = function (name) {
      const ext = getExtension.call(this, name)
      if (ext === null && name === 'KHR_parallel_shader_compile') {
        fc.parallelCompileStandIn = true
        return { COMPLETION_STATUS_KHR }
      }
      return ext
    }
  }

  function canvas() {
    return document.querySelector('.copland-canvas canvas')
  }

  // Called in a microtask queued at the start of a scene frame, so it runs
  // once that frame has drawn and before the browser presents (and clears)
  // the drawing buffer.
  function frameDone(tick) {
    const frame = fc.frames++
    if (fc.firstFrameTick === null) fc.firstFrameTick = tick
    let png = null
    const take = (label, note) => {
      png ??= canvas().toDataURL('image/png')
      fc.captures.push({ label, note, frame, tick, randomCalls: fc.randomCalls, png })
    }
    if (frame === 0) take('first-frame', 'the first frame the scene draws')
    while (fc.wants.length && tick >= fc.wants[0].tick) {
      const want = fc.wants.shift()
      take(want.label, want.note)
    }
    if (frame % 50 === 0) console.log(`[fc] frame ${frame} at ${tick} ms`)
  }

  // The scene's loop asks for its next frame first thing in every frame. Its
  // first request is the first one made once its canvas is on the page, in
  // main (canvas added in the constructor) and in the branch (canvas added
  // right before the first frame) alike.
  const fakeRaf = window.requestAnimationFrame
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    const id = fakeRaf(callback)
    if (fc.sceneCallback === null && canvas()) fc.sceneCallback = callback
    if (callback === fc.sceneCallback) {
      const tick = clock._now.ticks
      fc.sceneRaf = id
      fc.lastFrameTick = tick
      if (fc.pace !== null) clock._timers.get(id).callAt = tick + fc.pace
      queueMicrotask(() => frameDone(tick))
    }
    return id
  }

  const hop = () =>
    new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel()
      port1.onmessage = () => {
        port1.close()
        resolve()
      }
      port2.postMessage(null)
    })

  // Lets whatever a timer or an input event set off (a React render, then its
  // effects, each a message task) finish before the next timer fires, so a
  // phase change always reaches the scene before the same frame.
  async function settle() {
    for (let i = 0; i < 8; i++) await hop()
    await new Promise((resolve) => realSetTimeout(resolve, 0))
    for (let i = 0; i < 4; i++) await hop()
  }

  // Move the scene's pending frame to where the current pacing puts it: the
  // browser's 16 ms grid, or `pace` ms after the last frame.
  function retimeSceneFrame() {
    const timer = fc.sceneRaf !== null ? clock._timers.get(fc.sceneRaf) : undefined
    if (!timer) return
    const from = fc.lastFrameTick
    timer.callAt = from + (fc.pace !== null ? fc.pace : 16 - (from % 16))
  }

  // Fire every timer due up to `until`, one at a time in the clock's own
  // order, settling after each, then stop the clock at `until`.
  async function run(until, pace, wants) {
    fc.pace = pace
    retimeSceneFrame()
    fc.wants.push(...wants)
    fc.wants.sort((a, b) => a.tick - b.tick)
    while (clock._firstTimer(until)) {
      const result = await clock._callFirstTimer(until)
      fc.timersFired++
      if (result && result.error) fc.errors.push(String(result.error.stack || result.error))
      await settle()
    }
    clock._advanceNow(until)
    await settle()
    return state(true)
  }

  function state(withCaptures) {
    return {
      now: clock._now.ticks,
      frames: fc.frames,
      firstFrameTick: fc.firstFrameTick,
      randomCalls: fc.randomCalls,
      timersFired: fc.timersFired,
      completionQueries: fc.completionQueries,
      parallelCompileStandIn: fc.parallelCompileStandIn,
      pendingTimers: clock._timers.size,
      wants: fc.wants.map((w) => w.label),
      errors: fc.errors.slice(),
      captures: withCaptures ? fc.captures.splice(0) : [],
    }
  }

  fc.settle = settle
  fc.run = run
  fc.state = state
})()
