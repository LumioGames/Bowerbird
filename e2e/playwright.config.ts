import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run the real `bb serve` (packages/cli/dist) on a fresh copy of a fixture library per test file
 * (helpers/server.ts). Build first: `pnpm build`. Screenshot comparison against the prototype serves
 * design/prototype with a local static server (helpers/prototype.ts).
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './.artifacts/test-results',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: './.artifacts/report', open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [{ name: 'chromium' }]
})
