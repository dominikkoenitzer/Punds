import type { RealmPart, Tier } from '../types'

// Lightning far out in the cloud sea, and now and then a cloud it lights in
// the shape of a ghost. Drives the shared state in state.ts.

export const stormParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = []

// what the cloud sea wears (read by Skyscape)
export const clouds: unknown = undefined
