import { chromium } from '@playwright/test'
import { writeFileSync, mkdirSync } from 'node:fs'
const url = 'https://eithan1710.github.io/Calorie-Tracker/'
mkdirSync('out', { recursive: true })
const log = []
const b = await chromium.launch()
for (const [name, opts] of [['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }], ['desktop', { viewport: { width: 1280, height: 860 } }]]) {
  const ctx = await b.newContext({ ...opts, locale: 'he-IL', timezoneId: 'Asia/Jerusalem' })
  const p = await ctx.newPage()
  p.on('console', (m) => log.push(`[${name}] console.${m.type()}: ${m.text()}`))
  p.on('pageerror', (e) => log.push(`[${name}] PAGEERROR: ${e.stack || e.message}`))
  p.on('requestfailed', (r) => log.push(`[${name}] REQFAIL ${r.url()} ${r.failure()?.errorText}`))
  const js = []
  p.on('response', async (r) => { if (r.status() >= 400) log.push(`[${name}] HTTP ${r.status()} ${r.url()}`); else if (r.url().endsWith('.js')) js.push(r.text().catch(() => '')) })
  await p.goto(url, { waitUntil: 'networkidle' }).catch((e) => log.push(`goto ${e}`))
  await p.waitForTimeout(3000)
  log.push(`[${name}] body text: ${(await p.locator('body').innerText()).slice(0, 300).replace(/\n/g, ' | ')}`)
  const html = await p.content()
  log.push(`[${name}] scripts: ${[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).join(', ')}`)
  const bodies = await Promise.all(js)
  const has = (t) => bodies.some((b) => b.includes(t))
  log.push(`[${name}] js files: ${bodies.length} · custom_deficit_min: ${has('custom_deficit_min')} · kcal_min: ${has('kcal_min')} · surplus text: ${has('יותר מהעודף שתכננת')}`)
  await p.screenshot({ path: `out/${name}.png` })
  await ctx.close()
}
await b.close()
writeFileSync('out/log.txt', log.join('\n'))
console.log(log.join('\n'))
