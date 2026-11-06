import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { seasons } from './tools/seasons.mjs'

export default defineConfig({
  plugins: [react(), seasons()],
  // the bake worker shares the core parts, and with them season.ts
  worker: {
    plugins: () => [seasons()],
  },
  server: {
    port: 1000,
    host: true,
  },
})
