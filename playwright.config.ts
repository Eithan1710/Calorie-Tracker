import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const chromiumPath = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => existsSync(p))

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4317',
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    launchOptions: chromiumPath ? { executablePath: chromiumPath } : {},
  },
  projects: [
    { name: 'mobile', testIgnore: /accounts\.spec/, use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'desktop', testIgnore: /accounts\.spec/, use: { viewport: { width: 1280, height: 860 } } },
    // accounts: the app built against a (mocked) Supabase backend → login, sync, isolation, photo upload
    { name: 'accounts', testMatch: /accounts\.spec/, use: { baseURL: 'http://localhost:4318', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  ],
  webServer: [
    {
      // dev server: includes the local /api/analyze-food (no AI keys → deterministic parser); local mode, no login
      command: 'npx vite --port 4317 --strictPort',
      url: 'http://localhost:4317',
      reuseExistingServer: true,
      env: { GEMINI_API_KEY: '', GROQ_API_KEY: '', OPENROUTER_API_KEY: '' },
    },
    {
      command: 'npx vite --port 4318 --strictPort',
      url: 'http://localhost:4318',
      reuseExistingServer: true,
      env: { VITE_CACHE_DIR: 'node_modules/.vite-accounts', VITE_SUPABASE_URL: 'https://mock.supabase.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', GEMINI_API_KEY: '', GROQ_API_KEY: '', OPENROUTER_API_KEY: '' },
    },
  ],
})
