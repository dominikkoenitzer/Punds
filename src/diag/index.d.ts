// Types for the parts of this plain JavaScript package that the site calls.
type Scalars = Record<string, string | number | boolean | null>

export function maybeMountDiag(o: {
  app: string
  release: string | null
  endpoint: string
  lang?: 'en' | 'de'
  quality?: () => Scalars
  stats?: () => Scalars
  canvas?: () => HTMLCanvasElement | null
}): boolean | null
export function startVitals(o: { app: string; release: string | null; endpoint: string; quality?: () => Scalars; gpu?: boolean; sample?: number }): void
export function reportTier(tier: Scalars): void
