/// <reference types="vite/client" />

declare module 'virtual:seasons' {
  import type { Calendar } from './realm/season'
  const seasons: Record<string, Calendar>
  export default seasons
}
