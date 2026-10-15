import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { MockSupabase, MOCK_URL } from '../e2e/mockSupabase'
import { analysis, item } from '../e2e/helpers'

/**
 * Diagnostics, same scenario before and after a change:
 *  - nav: every dock button is the element under its own centre and does its job
 *    (after load, after scrolling, after a sheet was opened/closed, while a toast shows)
 *  - startup: repeat launches of the installed app (service worker warm), mobile CPU/network
 *    throttling on Chromium: time to first paint and to a usable camera button
 *  - photo: client-side overhead from picking a 12 MP photo to the result on screen
 *    (the AI call itself is mocked here; measured separately against the real API)
 */

const OUT = 'perf-out'
mkdirSync(OUT, { recursive: true })
const save = (name: string, data: unknown) => writeFileSync(`${OUT}/${name}.json`, JSON.stringify(data, null, 2))
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

const RESULT = analysis([item('a', 'שקשוקה', 300, { kcal: 120, protein_g: 7, fat_g: 8, carbs_g: 5 })], { title: 'שקשוקה' })

async function throttle(page: Page, projectName: string) {
  if (!projectName.includes('chromium')) return false
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  // "Fast 4G"-like: 150 ms RTT, ~9 Mbps down
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_125_000, uploadThroughput: 375_000 })
  return true
}

const logs: string[] = []
test.beforeEach(async ({ page }, info) => {
  logs.length = 0
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`))
  info.setTimeout(90_000)
})
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) {
    await page.screenshot({ path: `${OUT}/fail-${info.project.name}-${info.title.slice(0, 20).replace(/\W+/g, '_')}.png` }).catch(() => {})
    writeFileSync(`${OUT}/fail-${info.project.name}-${info.title.slice(0, 20).replace(/\W+/g, '_')}.txt`, `${info.error?.message ?? ''}\n\n${logs.join('\n')}\n\nBODY:\n${await page.locator('body').innerText().catch(() => '')}`)
  }
})

test('boot: the app renders (login screen) and reports no errors', async ({ page }, info) => {
  const sb = new MockSupabase()
  await sb.install(page.context())
  await page.goto('/')
  await page.waitForTimeout(4000)
  await page.screenshot({ path: `${OUT}/boot-${info.project.name}.png` })
  writeFileSync(`${OUT}/boot-${info.project.name}.txt`, `${logs.join('\n')}\n\nBODY:\n${await page.locator('body').innerText()}`)
  await expect(page.getByLabel('שם משתמש')).toBeVisible()
})

async function signIn(page: Page, sb: MockSupabase) {
  sb.addUser('perf', '123456')
  await sb.install(page.context())
  await page.goto('/')
  await page.getByLabel('שם משתמש').fill('perf')
  await page.getByLabel('סיסמה', { exact: true }).fill('123456')
  await page.getByRole('button', { name: 'כניסה' }).click()
  await page.getByLabel('גיל').fill('30')
  await page.getByLabel('גובה').fill('162')
  await page.getByLabel('משקל').fill('61')
  await page.getByRole('button', { name: 'בוא נתחיל' }).click()
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
}

/** What is actually under the centre of every dock button (catches overlays / pointer-events bugs). */
async function hitTest(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="ניווט ראשי"]')
    if (!nav) return [{ error: 'no nav' }]
    return [...nav.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect()
      const x = r.left + r.width / 2, y = r.top + r.height / 2
      const hit = document.elementFromPoint(x, y)
      const owner = hit?.closest('button')
      return {
        button: b.getAttribute('aria-label') || b.textContent?.trim(),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
        hitIsButton: owner === b,
        hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.getAttribute('class') ?? '').slice(0, 60)}` : null,
      }
    })
  })
}

test('nav: dock buttons are hittable and work', async ({ page }, info) => {
  const sb = new MockSupabase()
  await page.route(`${MOCK_URL}/functions/v1/analyze-food`, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(RESULT) }))
  await signIn(page, sb)
  const report: Record<string, unknown> = { viewport: page.viewportSize() }
  const tap = async (name: string) => {
    const b = page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name })
    if (info.project.use.hasTouch) await b.tap({ timeout: 5000 })
    else await b.click({ timeout: 5000 })
  }
  const attempt = async (label: string, fn: () => Promise<void>) => {
    await page.evaluate(() => ((window as unknown as { __ev: string[] }).__ev = []))
    try {
      await fn()
      report[label] = 'ok'
    } catch (e) {
      report[label] = `FAIL: ${(e as Error).message.split('\n')[0]}`
      report[`${label}_events`] = await page.evaluate(() => (window as unknown as { __ev: string[] }).__ev)
      report[`${label}_scrollY`] = await page.evaluate(() => window.scrollY)
      await page.screenshot({ path: `${OUT}/nav-${info.project.name}-${label}.png` })
      await page.keyboard.press('Escape').catch(() => {})
    }
  }
  await page.evaluate(() => {
    const w = window as unknown as { __ev: string[] }
    w.__ev = []
    const d = (e: Event) => {
      const t = e.target as Element | null
      const b = t?.closest?.('button,label')
      w.__ev.push(`${e.type}:${t?.tagName.toLowerCase()}${b ? `→${b.getAttribute('aria-label') ?? b.textContent?.trim().slice(0, 12)}` : ''}${e.defaultPrevented ? ' (prevented)' : ''}`)
    }
    for (const t of ['pointerdown', 'touchstart', 'touchend', 'pointerup', 'click']) document.addEventListener(t, d, { capture: true, passive: true })
    // after React's handlers: was the default prevented / propagation stopped?
    for (const t of ['touchend', 'click']) window.addEventListener(t, (e) => w.__ev.push(`${t}@window${e.defaultPrevented ? ' (prevented)' : ''}`))
  })
  report.hit_initial = await hitTest(page)
  await attempt('history', async () => {
    await tap('היסטוריה')
    await expect(page.getByRole('heading', { name: 'היסטוריה' })).toBeVisible({ timeout: 5000 })
  })
  await attempt('today', async () => {
    await tap('היום')
    await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible({ timeout: 5000 })
  })
  await attempt('add', async () => {
    await tap('הוסף אוכל')
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 })
    await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
  await attempt('camera', async () => {
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 })
    await tap('צלם אוכל')
    await chooser
  })
  await page.evaluate(() => window.scrollTo(0, 3000))
  await page.waitForTimeout(300)
  report.hit_after_scroll = await hitTest(page)
  await attempt('history_after_scroll', async () => {
    await tap('היסטוריה')
    await expect(page.getByRole('heading', { name: 'היסטוריה' })).toBeVisible({ timeout: 5000 })
    await tap('היום')
  })
  // a toast is showing (after adding food)
  await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
  await page.getByLabel('תיאור האוכל').fill('שקשוקה')
  await page.getByRole('button', { name: 'חשב' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
  report.hit_with_toast = await hitTest(page)
  await attempt('history_with_toast', async () => {
    await tap('היסטוריה')
    await expect(page.getByRole('heading', { name: 'היסטוריה' })).toBeVisible({ timeout: 5000 })
    await tap('היום')
  })
  await page.screenshot({ path: `${OUT}/nav-${info.project.name}.png` })
  save(`nav-${info.project.name}`, report)
  // also with a plain click (no touch emulation) in WebKit, to separate touch handling from the button
  if (info.project.use.hasTouch) {
    const b = page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'היסטוריה' })
    await b.click()
    report.history_plain_click = (await page.getByRole('heading', { name: 'היסטוריה' }).isVisible().catch(() => false)) ? 'ok' : 'FAIL'
    save(`nav-${info.project.name}`, report)
  }
})

test('startup: repeat launches (installed app, warm service worker)', async ({ page }, info) => {
  const sb = new MockSupabase()
  await signIn(page, sb)
  // wait for the service worker to take control, so reloads are real "repeat visits"
  await page.evaluate(async () => {
    const r = await navigator.serviceWorker?.ready
    return Boolean(r)
  }).catch(() => false)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await page.addInitScript(() => {
    const w = window as unknown as { __mz: Record<string, number> }
    w.__mz = {}
    const mark = (k: string) => (w.__mz[k] ??= performance.now())
    new MutationObserver(() => {
      const root = document.getElementById('root')
      if (root && root.children.length) mark('root_child')
      if (document.querySelector('main')) mark('main')
      const cam = document.querySelector('[aria-label="צלם אוכל"]') as HTMLButtonElement | null
      if (cam && !cam.disabled) mark('camera_ready')
    }).observe(document, { childList: true, subtree: true })
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) (w.__mz.longtask_ms ??= 0), (w.__mz.longtask_ms += e.duration)
      }).observe({ type: 'longtask', buffered: true })
    } catch { /* not supported */ }
  })
  const throttled = await throttle(page, info.project.name)
  const runs: Record<string, number>[] = []
  for (let i = 0; i < 5; i++) {
    const requests: string[] = []
    const onReq = (r: { url: () => string }) => requests.push(r.url())
    page.on('request', onReq)
    await page.reload()
    await page.waitForFunction(() => (window as unknown as { __mz: Record<string, number> }).__mz?.camera_ready, null, { timeout: 30_000 })
    await page.waitForTimeout(1500)
    page.off('request', onReq)
    const m = await page.evaluate(() => {
      const w = window as unknown as { __mz: Record<string, number> }
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      return {
        fcp,
        dom_content_loaded: nav?.domContentLoadedEventEnd ?? null,
        root_child: w.__mz.root_child ?? null,
        camera_ready: w.__mz.camera_ready ?? null,
        longtask_ms: w.__mz.longtask_ms ?? 0,
        js_kb_transferred: Math.round(res.filter((r) => r.name.endsWith('.js')).reduce((s, r) => s + r.transferSize, 0) / 1024),
        js_kb_decoded: Math.round(res.filter((r) => r.name.endsWith('.js')).reduce((s, r) => s + r.decodedBodySize, 0) / 1024),
      }
    })
    runs.push({ ...m, requests_during_start: requests.length } as unknown as Record<string, number>)
    if (i === 0) save(`startup-requests-${info.project.name}`, requests.map((u) => u.replace(/\?.*/, '')))
  }
  const med = (k: string) => median(runs.map((r) => Number(r[k] ?? NaN)).filter((n) => !Number.isNaN(n)))
  save(`startup-${info.project.name}`, {
    throttled: throttled ? 'CPU 4x, 150 ms RTT, 9 Mbps' : 'none (WebKit cannot be throttled)',
    median: { fcp: med('fcp'), root_child: med('root_child'), camera_ready: med('camera_ready'), longtask_ms: med('longtask_ms'), js_kb_decoded: med('js_kb_decoded') },
    runs,
  })
})

test('photo: client overhead from picking a 12 MP photo to the result', async ({ page }, info) => {
  const sb = new MockSupabase()
  let sentAt = 0, bodyBytes = 0
  await signIn(page, sb)
  await page.route(`${MOCK_URL}/functions/v1/analyze-food`, async (r) => {
    sentAt = Date.now()
    bodyBytes = r.request().postDataBuffer()?.length ?? 0
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(RESULT) })
  })
  await throttle(page, info.project.name)
  // a realistic 4032×3024 JPEG made in the page (noise + gradient so it doesn't compress to nothing)
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 4032
    c.height = 3024
    const g = c.getContext('2d')!
    const grd = g.createLinearGradient(0, 0, 4032, 3024)
    grd.addColorStop(0, '#c33'), grd.addColorStop(1, '#fd5')
    g.fillStyle = grd
    g.fillRect(0, 0, 4032, 3024)
    for (let i = 0; i < 40000; i++) {
      g.fillStyle = `hsl(${Math.random() * 360} 60% 50%)`
      g.fillRect(Math.random() * 4032, Math.random() * 3024, 8 + Math.random() * 30, 8 + Math.random() * 30)
    }
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.92))
    const buf = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return btoa(s)
  })
  const buffer = Buffer.from(b64, 'base64')
  const runs = []
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    await page.getByTestId('dock-photo-input').setInputFiles({ name: 'IMG_0001.jpg', mimeType: 'image/jpeg', buffer })
    await expect(page.getByRole('heading', { name: 'זה נראה נכון?' })).toBeVisible({ timeout: 30_000 })
    const shown = Date.now()
    runs.push({ photo_mb: +(buffer.length / 1e6).toFixed(1), select_to_request_ms: sentAt - t0, response_to_result_ms: shown - sentAt, request_kb: Math.round(bodyBytes / 1024) })
    await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  save(`photo-${info.project.name}`, { runs })
})

/** Same 12 MP photo through different decode/resize/encode strategies (in the page, no app code). */
test('prepare variants: decode + resize + encode', async ({ page }, info) => {
  await page.goto('/')
  await throttle(page, info.project.name)
  const res = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 4032
    c.height = 3024
    const g = c.getContext('2d')!
    // photo-like: smooth gradients, a few large shapes, mild grain
    const grd = g.createRadialGradient(2000, 1500, 100, 2000, 1500, 2600)
    grd.addColorStop(0, '#f3e2c4'), grd.addColorStop(0.5, '#c8673a'), grd.addColorStop(1, '#3a2a20')
    g.fillStyle = grd
    g.fillRect(0, 0, 4032, 3024)
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `hsl(${20 + Math.random() * 100} 55% ${30 + Math.random() * 40}%)`
      g.beginPath(); g.ellipse(Math.random() * 4032, Math.random() * 3024, 80 + Math.random() * 400, 60 + Math.random() * 300, Math.random() * 3, 0, 7); g.fill()
    }
    const img = g.getImageData(0, 0, 4032, 3024)
    for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n }
    g.putImageData(img, 0, 0)
    const file = new File([await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9))], 'p.jpg', { type: 'image/jpeg' })
    const b64 = (b: Blob) => new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(',')[1]); f.readAsDataURL(b) })
    const draw = (bm: ImageBitmap, max: number) => {
      const s = Math.min(1, max / Math.max(bm.width, bm.height))
      const cv = document.createElement('canvas')
      cv.width = Math.round(bm.width * s); cv.height = Math.round(bm.height * s)
      const x = cv.getContext('2d')!
      x.imageSmoothingQuality = 'high'
      x.drawImage(bm, 0, 0, cv.width, cv.height)
      bm.close()
      return cv
    }
    const blob = (cv: HTMLCanvasElement, q: number) => new Promise<Blob>((r) => cv.toBlob((b) => r(b!), 'image/jpeg', q))
    const variants: Record<string, () => Promise<number>> = {
      'A old: full decode, 1280, toDataURL': async () => draw(await createImageBitmap(file, { imageOrientation: 'from-image' }), 1280).toDataURL('image/jpeg', 0.8).length,
      'B decode→1024 (resizeWidth high), toBlob': async () => (await b64(await blob(draw(await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: 1024, resizeQuality: 'high' }), 1024), 0.8))).length,
      'C full decode, 1024, toBlob': async () => (await b64(await blob(draw(await createImageBitmap(file, { imageOrientation: 'from-image' }), 1024), 0.8))).length,
      'D full decode, 1024, toDataURL': async () => draw(await createImageBitmap(file, { imageOrientation: 'from-image' }), 1024).toDataURL('image/jpeg', 0.8).length,
      'E decode→1024 (resizeWidth low), toDataURL': async () => draw(await createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: 1024, resizeQuality: 'low' }), 1024).toDataURL('image/jpeg', 0.8).length,
    }
    const out: Record<string, { ms: number[]; b64_kb: number } | string> = { file_mb: (file.size / 1e6).toFixed(2) }
    for (const [k, fn] of Object.entries(variants)) {
      const ms: number[] = []
      let len = 0
      try {
        for (let i = 0; i < 3; i++) { const t = performance.now(); len = await fn(); ms.push(Math.round(performance.now() - t)) }
        out[k] = { ms, b64_kb: Math.round(len / 1024) }
      } catch (e) { out[k] = `error: ${(e as Error).message}` }
    }
    return out
  })
  save(`prepare-${info.project.name}`, res)
})
