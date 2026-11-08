import { defineConfig, type Project } from '@playwright/test'

// The built site (dist, `bun run build`) in Chromium, WebKit and Firefox at five screens, served with the headers
// Vercel sends (test/e2e/serve.mjs). Between them the screens cover a pixel density of 1, 2 and 3.
const PORT = Number(process.env.E2E_PORT) || 4620

const SIZES = [
  { name: 'phone-393', use: { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, mobile: true } },
  { name: 'phone-360', use: { viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, hasTouch: true, mobile: true } },
  { name: 'tablet-768', use: { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, hasTouch: true, mobile: true } },
  { name: 'desk-1440', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
  { name: 'desk-2560', use: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 } },
] as const
const ENGINES = ['chromium', 'webkit', 'firefox'] as const

// Firefox has no mobile mode; it gets the same size and touch without it.
const projects: Project[] = ENGINES.flatMap((engine) =>
  SIZES.map(({ name, use: { mobile, ...use } }) => ({
    name: `${engine}-${name}`,
    use: { browserName: engine, ...use, ...(mobile && engine !== 'firefox' ? { isMobile: true } : {}) },
  })),
)

export default defineConfig({
  testDir: 'test/e2e',
  // a software renderer draws the full garden at the screen's own density, one frame in seconds
  timeout: 240_000,
  expect: { timeout: 15_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', scale: 'device', timeout: 60_000 } },
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS) || 2,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}',
  use: { baseURL: `http://127.0.0.1:${PORT}`, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'Europe/Zurich', trace: 'off' },
  projects,
  webServer: {
    command: 'node test/e2e/serve.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
