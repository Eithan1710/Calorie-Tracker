import { expect, test } from '@playwright/test'
import { MockSupabase } from './mockSupabase'

/**
 * The production build served by `vite preview` (service worker active), as Android
 * Chrome sees it. Uses Chrome's own installability check (DevTools protocol).
 */

let consoleErrors: string[] = []
test.beforeEach(async ({ page, context }) => {
  await new MockSupabase().install(context)
  consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text())
  })
})
test.afterEach(() => {
  expect(consoleErrors).toEqual([])
})

test('manifest: name, standalone, scope, colours, icons reachable', async ({ page, request }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const res = await request.get(new URL(href!, page.url()).href)
  expect(res.ok()).toBe(true)
  const m = await res.json()
  expect(m).toMatchObject({ name: 'Calorie Tracker', short_name: 'Calorie Tracker', display: 'standalone', start_url: './', scope: './', lang: 'he', dir: 'rtl' })
  expect(m.theme_color).toMatch(/^#/)
  expect(m.background_color).toMatch(/^#/)
  for (const icon of m.icons) {
    const r = await request.get(new URL(icon.src, new URL(href!, page.url())).href)
    expect(r.ok(), icon.src).toBe(true)
    expect(r.headers()['content-type']).toContain('image/png')
  }
  expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true)
  await expect(page).toHaveTitle('Calorie Tracker')
})

test('service worker registers, controls the page, and Chrome reports no installability errors', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.active?.state))).toBe('activated')
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.scope))).toBe(new URL('/', page.url()).href)
  await page.reload()
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  const cdp = await page.context().newCDPSession(page)
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
  expect(installabilityErrors).toEqual([])
  const manifest = await cdp.send('Page.getAppManifest')
  expect(manifest.errors).toEqual([])
})

test('the service worker caches only the app’s own files — no Supabase data, no personal data', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.active?.state))).toBe('activated')
  await page.reload()
  const cached = await page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      const c = await caches.open(name)
      for (const req of await c.keys()) urls.push(req.url)
    }
    return { urls, origin: location.origin }
  })
  expect(cached.urls.length).toBeGreaterThan(0)
  for (const u of cached.urls) {
    expect(u.startsWith(cached.origin), u).toBe(true)
    expect(u, u).toMatch(/\.(js|css|html|svg|png|woff2|webmanifest)(\?|$)/)
  }
})

test('the installed app still requires login (no page reachable without it)', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toHaveCount(0)
})
