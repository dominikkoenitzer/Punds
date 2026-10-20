import type { RealmPart, Tier } from '../types'

// The gentle red rain around the camera.

export const rainParts: ((tier: Tier) => Promise<RealmPart> | RealmPart)[] = []
