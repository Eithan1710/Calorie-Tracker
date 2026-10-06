// Renders PWA PNG icons from the SVG logo using the preinstalled Chromium (Playwright).
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'

const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync)
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
const page = await browser.newPage()
const logo = (size, pad, rounded) => `
<html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="${rounded ? 18 : 0}" fill="#17181b"/>
  <g transform="translate(${32 - 32 * pad},${32 - 32 * pad}) scale(${pad})">
    <path d="M14 38h36M32 38v10" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
    <circle cx="25" cy="27" r="7" fill="#e2733d"/><circle cx="40" cy="27" r="7" fill="none" stroke="#fff" stroke-width="4"/>
  </g>
</svg></body></html>`
const badge = (size) => `<html><body style="margin:0;background:transparent"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64"><path d="M10 38h44M32 38v12" stroke="#000" stroke-width="5" stroke-linecap="round"/><circle cx="23" cy="25" r="8"/><circle cx="41" cy="25" r="8" fill="none" stroke="#000" stroke-width="5"/></svg></body></html>`
const jobs = [
  ['public/pwa-192.png', 192, logo(192, 1, false)],
  ['public/pwa-512.png', 512, logo(512, 1, false)],
  ['public/pwa-512-maskable.png', 512, logo(512, 0.75, false)],
  ['public/apple-touch-icon.png', 180, logo(180, 1, false)],
  ['public/badge-72.png', 72, badge(72)],
]
for (const [file, size, html] of jobs) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(html)
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
  console.log('wrote', file)
}
await browser.close()
