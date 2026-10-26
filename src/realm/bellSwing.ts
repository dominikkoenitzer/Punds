// A ring of the shrine bell as motion: the pull swings the long rope from the
// bell's foot, and the bell rocks on its hanger a beat behind, following the
// rope at its own quicker pace; both die away. Angles are in radians about
// the hall's cross axis, negative toward the visitor.

const ROPE_RATE = 2.3 // a rope of about two metres, as a pendulum
const ROPE_DAMP = 0.1
const BELL_RATE = 8.5 // the short bell on its hanger
const BELL_DAMP = 0.07
const BELL_FOLLOW = 0.3 // how far the bell leans after the rope
const PULL = 0.5 // the rope's speed from one pull
const LIMIT = 0.5
const REST = 2e-3 // a few millimetres at the tail: still to the eye

export class BellSwing {
  rope = 0
  bell = 0
  private ropeV = 0
  private bellV = 0

  // a pull toward the visitor; with reduced motion only a small sway
  ring(motion = 1): void {
    this.ropeV -= PULL * (motion > 0 ? 1 : 0.35)
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
      this.bellV += (-BELL_RATE * BELL_RATE * (this.bell - target) - 2 * BELL_DAMP * BELL_RATE * this.bellV) * h
      this.bell += this.bellV * h
    }
    // pulls in quick turn swing it higher, never over the hanger
    this.rope = Math.max(-LIMIT, Math.min(LIMIT, this.rope))
    this.bell = Math.max(-LIMIT, Math.min(LIMIT, this.bell))
  }
}
