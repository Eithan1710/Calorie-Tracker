// Renders the app icons (home screen, favicon, notification badge) from one SVG
// design, using the preinstalled Chromium (Playwright): `npm run icons`.
//
// Design: a calorie flame (orange) inside a progress ring (white) on the app's
// dark ink colour — "calories, tracked". Colours are the app's design tokens
// (--ink #17181b, --eaten #e2733d).
import { chromium } from '@playwright/test'
import { existsSync, writeFileSync } from 'node:fs'

const INK = '#17181b'
const FLAME = '#e2733d'

/** The mark on a 64×64 grid, centred at 32,32. */
const mark = (ring = '#fff', flame = FLAME) => `
  <circle cx="32" cy="32" r="21" fill="none" stroke="${ring}" stroke-opacity="0.18" stroke-width="5"/>
  <circle cx="32" cy="32" r="21" fill="none" stroke="${ring}" stroke-width="5" stroke-linecap="round"
          stroke-dasharray="98.9 33" transform="rotate(-90 32 32)"/>
  <path fill="${flame}" d="M32.6 18.5c.9 4.3 3.5 6.7 5.9 9.4 2.3 2.6 3.9 5.2 3.9 8.7 0 5.9-4.6 10-10.4 10s-10.4-4.1-10.4-9.6c0-3.3 1.4-6 3.7-8.3.2 2.4 1.2 4.2 3.1 5.3-.5-5.6 1.4-10.3 4.2-15.5z"/>
  <path fill="#fff" fill-opacity="0.9" d="M32.3 34.6c1.9 1.9 3.6 3.5 3.6 6 0 2.2-1.7 3.8-3.9 3.8s-3.9-1.5-3.9-3.6c0-1.6.8-2.8 2-3.8.3 1 .9 1.6 1.7 1.9-.3-1.5 0-3 .5-4.3z"/>`

/** Full icon; `scale` < 1 shrinks the mark into the maskable safe zone. */
const icon = (radius, scale = 1) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${radius}" fill="${INK}"/>
  <g transform="translate(${32 - 32 * scale} ${32 - 32 * scale}) scale(${scale})">${mark()}</g>
</svg>`

/** Monochrome notification badge (Android uses only the alpha channel). */
const badge = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${mark('#000', '#000')}</svg>`

writeFileSync('public/favicon.svg', icon(14).replace(/\n\s*/g, ''))
console.log('wrote public/favicon.svg')

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync)
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
const page = await browser.newPage()
const jobs = [
  // "any" icons: full-bleed square; Android applies its own mask/rounding
  ['public/pwa-192.png', 192, icon(0)],
  ['public/pwa-512.png', 512, icon(0)],
  // maskable: mark inside the central 80 % safe zone
  ['public/pwa-192-maskable.png', 192, icon(0, 0.78)],
  ['public/pwa-512-maskable.png', 512, icon(0, 0.78)],
  ['public/apple-touch-icon.png', 180, icon(0)],
  ['public/badge-72.png', 72, badge],
]
for (const [file, size, svg] of jobs) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  console.log('wrote', file)
}
await browser.close()
