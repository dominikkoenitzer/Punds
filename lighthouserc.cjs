// Lighthouse budgets for the built site, served with Vercel's headers (test/e2e/serve.mjs).
// LHCI_FORM=desktop measures the desktop form; anything else the phone form.
// A runner without a graphics chip gets the still page (the garden refuses a software renderer), so these numbers
// hold the page, its pictures and its scripts to account; the garden's own frame costs are measured on real
// devices, not here.
const desktop = process.env.LHCI_FORM === 'desktop'

module.exports = {
  ci: {
    collect: {
      startServerCommand: 'node test/e2e/serve.mjs',
      startServerReadyPattern: 'listening',
      url: ['http://127.0.0.1:4620/?season=none'],
      numberOfRuns: 3,
      settings: {
        ...(desktop ? { preset: 'desktop' } : {}),
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: desktop ? 0.95 : 0.9 }],
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:best-practices': ['error', { minScore: 1 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
      },
    },
    upload: { target: 'filesystem', outputDir: '.lighthouseci' },
  },
}
