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
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } } },
  ],
  webServer: {
    // dev server: includes the local /api/analyze-food (no AI keys → deterministic parser)
    command: 'npx vite --port 4317 --strictPort',
    url: 'http://localhost:4317',
    reuseExistingServer: true,
    env: { GEMINI_API_KEY: '', GROQ_API_KEY: '', OPENROUTER_API_KEY: '' },
  },
})
