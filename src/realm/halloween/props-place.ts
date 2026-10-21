import { EMA_RACK, groundHeight, pathWeight, STEPS, TERRACE_FRONT_Z, TERRACE_Y } from '../layout'

// Where the night's things stand, and the height of whatever they stand on:
// the paving, a stair tread, the terrace or the lawn.

const RISE = TERRACE_Y / STEPS.count
const TREAD = (STEPS.zFront - STEPS.zBack) / STEPS.count

// the top of stair tread i (0 the lowest) and the middle of its depth
export function tread(i: number): { y: number; z: number } {
  return { y: RISE * (i + 1), z: STEPS.zFront - TREAD * i - TREAD / 2 }
}

export function surfaceY(x: number, z: number): number {
  if (Math.abs(x) < STEPS.halfWidth && z < STEPS.zFront && z > STEPS.zBack) {
    const i = Math.min(STEPS.count - 1, Math.floor((STEPS.zFront - z) / TREAD))
    return RISE * (i + 1)
  }
  const paved = pathWeight(x, z) > 0.5
  if (z < TERRACE_FRONT_Z) return paved ? TERRACE_Y + 0.035 : groundHeight(x, z)
  return paved ? groundHeight(0, z) + 0.035 : groundHeight(x, z)
}

// a point in the plaque rack's own frame (x along the rails, z out of its
// front) in the world
export function rackPoint(x: number, z: number): { x: number; z: number } {
  const c = Math.cos(EMA_RACK.rotation)
  const s = Math.sin(EMA_RACK.rotation)
  return { x: EMA_RACK.x + x * c + z * s, z: EMA_RACK.z - x * s + z * c }
}

// the start view's eye, which most carved faces turn to
export const EYE = { x: -0.3, z: 9.6 }

export function yawTo(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z)
}

export interface PumpkinSpot {
  x: number
  z: number
  r: number // equatorial radius, m
  yaw: number // the way the face looks
  phone: boolean
}

const rackL = rackPoint(-1.12, 0.36)
const rackR = rackPoint(1.1, 0.42)
const rackEye = rackPoint(-1.03, 2.16)

// the graves on the lawn west of the path, between it and the pond, in front
// of the terrace wall: in the start view to the left of the path, by the
// fourth lantern
export const GRAVES = {
  slab: { x: -4.25, z: -3.3, yaw: 0.55, lean: [-0.13, 0.05] as const },
  pointed: { x: -5.3, z: -4.35, yaw: 0.35, lean: [0.1, -0.12] as const },
  broken: { x: -6.0, z: -3.45, yaw: 0.85, lean: [-0.06, 0.1] as const },
  // the hand rises in front of the near slab
  hand: { x: -3.9, z: -2.82 },
}

export const GRAVE_PUMPKIN = { x: -3.55, z: -3.55 }

export const PUMPKINS: readonly PumpkinSpot[] = [
  // a step past the second lantern on the left, low in the start view
  { x: -1.9, z: 4.3, r: 0.19, yaw: yawTo(-1.9, 4.3, EYE.x, EYE.z) + 0.25, phone: true },
  // at the rack, one at each post, both looking to its view
  { x: rackL.x, z: rackL.z, r: 0.215, yaw: yawTo(rackL.x, rackL.z, rackEye.x, rackEye.z) + 0.2, phone: true },
  { x: rackR.x, z: rackR.z, r: 0.165, yaw: yawTo(rackR.x, rackR.z, rackEye.x, rackEye.z) - 0.15, phone: false },
  // beside the graves
  { x: GRAVE_PUMPKIN.x, z: GRAVE_PUMPKIN.z, r: 0.17, yaw: yawTo(GRAVE_PUMPKIN.x, GRAVE_PUMPKIN.z, EYE.x, EYE.z) - 0.3, phone: true },
  // at the foot of the fourth lantern on the right
  { x: 1.95, z: -1.42, r: 0.155, yaw: yawTo(1.95, -1.42, EYE.x, EYE.z) - 0.2, phone: false },
  // on the third stair tread, at its left end, and on the terrace at the top
  { x: -1.14, z: tread(2).z, r: 0.122, yaw: 0.15, phone: false },
  { x: 1.86, z: -10.35, r: 0.2, yaw: -0.25, phone: false },
]
