import type { Plugin } from 'vite'

export interface Calendar {
  from: [number, number]
  to: [number, number]
  priority: number
  poster: boolean
}

export const SEASONS_DIR: string
export const POSTERS_DIR: string
export const POSTERS: string[]
export function calendarProblems(calendar: unknown): string[]
export function readSeasons(root: string): Record<string, Calendar>
export function seasonsJson(seasons: Record<string, Calendar>): string
export function seasons(): Plugin
