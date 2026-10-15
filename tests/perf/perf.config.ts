import { defineConfig, devices } from '@playwright/test'

/**
 * Performance + navigation diagnostics (not part of the regular CI suite).
 * Runs the PRODUCTION build (service worker on) against the mocked Supabase.
 *   npx playwright test -c tests/perf/perf.config.ts
 * Results: perf-out/*.json (+ screenshots).
 */
export default defineConfig({
  testDir: '.',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4320', locale: 'he-IL', timezoneId: 'Asia/Jerusalem' },
  projects: [
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 14'] } },
  ],
  webServer: {
    command: 'npx vite build --outDir dist-perf && npx vite preview --outDir dist-perf --port 4320 --strictPort',
    url: 'http://localhost:4320',
    reuseExistingServer: true,
    timeout: 240_000,
    cwd: '../..',
    env: { VITE_CACHE_DIR: 'node_modules/.vite-perf', VITE_SUPABASE_URL: 'https://mock.supabase.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' },
  },
})
