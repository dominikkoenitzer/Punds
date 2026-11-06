// A ring of the shrine bell as motion: the visitor shakes the long rope side
// to side, and the bell rocks on its hanger a beat behind, following the rope
// at its own quicker pace; both die away. Angles are in radians about the
// hall's depth axis.

const ROPE_RATE = 2.3 // a rope of about two metres, as a pendulum
const ROPE_DAMP = 0.1
const BELL_RATE = 8.5 // the short bell on its hanger
const BELL_DAMP = 0.07
const BELL_FOLLOW = 0.3 // how far the bell leans after the rope
const PULL = 0.5 // the rope's speed from one pull
const LIMIT = 0.5
const STRIKE_MIN = 0.02 // slower than this the clapper only touches
const STRIKE_FULL = 0.45 // the bell's speed for the loudest blow
const REST = 2e-3 // a few millimetres at the tail: still to the eye

export class BellSwing {
  rope = 0
  bell = 0
  private ropeV = 0
  private bellV = 0
  private peak = 0
  private strike = 0

  // a pull on the rope toward one side, -1 to 1 (positive swings to +x), as
  // hard as the push; it adds to the swing already there. With reduced motion
  // only a small sway.
  ring(push: number, motion = 1): void {
    this.ropeV += PULL * Math.max(-1, Math.min(1, push)) * (motion > 0 ? 1 : 0.35)
  }

  // the loudest unheard blow of the clapper, 0 to 1, and forgets it
  takeStrike(): number {
    const s = this.strike
    this.strike = 0
    return s
  }

  get moving(): boolean {
    return Math.abs(this.rope) + Math.abs(this.bell) + Math.abs(this.ropeV) + Math.abs(this.bellV) > REST
  }

  step(dt: number): void {
    if (!this.moving) {
      this.rope = this.bell = this.ropeV = this.bellV = 0
      return
    }
    // small fixed steps, so a long frame cannot blow the springs up
    const n = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      this.ropeV += (-ROPE_RATE * ROPE_RATE * this.rope - 2 * ROPE_DAMP * ROPE_RATE * this.ropeV) * h
      this.rope += this.ropeV * h
      const target = this.rope * BELL_FOLLOW
      const before = this.bellV
      this.bellV += (-BELL_RATE * BELL_RATE * (this.bell - target) - 2 * BELL_DAMP * BELL_RATE * this.bellV) * h
      this.bell += this.bellV * h
      // the clapper hits where the bell turns, as hard as it was going
      this.peak = Math.max(this.peak, Math.abs(this.bellV))
      if (before * this.bellV < 0) {
        if (this.peak > STRIKE_MIN) this.strike = Math.max(this.strike, Math.min(1, this.peak / STRIKE_FULL))
        this.peak = 0
      }
    }
    // pulls in quick turn swing it higher, never over the hanger
    this.rope = Math.max(-LIMIT, Math.min(LIMIT, this.rope))
    this.bell = Math.max(-LIMIT, Math.min(LIMIT, this.bell))
  }
}
