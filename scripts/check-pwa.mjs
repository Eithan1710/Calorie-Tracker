// Checks the production build is an installable PWA before it's deployed:
//   node scripts/check-pwa.mjs [distDir]
// Manifest fields Android Chrome requires, icon files that exist with the declared
// sizes, the service worker, and the manifest link in index.html.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = process.argv[2] ?? 'dist'
const errors = []
const check = (ok, msg) => ok || errors.push(msg)

const pngSize = (file) => {
  const b = readFileSync(file)
  if (b.readUInt32BE(0) !== 0x89504e47) return null
  return [b.readUInt32BE(16), b.readUInt32BE(20)]
}

const manifestPath = join(dist, 'manifest.webmanifest')
check(existsSync(manifestPath), `missing ${manifestPath}`)
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
  check(m.name === 'Calorie Tracker', `manifest.name is "${m.name}"`)
  check(m.short_name === 'Calorie Tracker', `manifest.short_name is "${m.short_name}"`)
  check(m.display === 'standalone', `manifest.display is "${m.display}"`)
  check(typeof m.start_url === 'string' && !m.start_url.startsWith('http'), 'manifest.start_url must be relative')
  check(typeof m.scope === 'string', 'manifest.scope missing')
  check(/^#[0-9a-f]{6}$/i.test(m.theme_color ?? '') && /^#[0-9a-f]{6}$/i.test(m.background_color ?? ''), 'theme/background colours missing')
  const icons = m.icons ?? []
  for (const need of ['192x192', '512x512']) {
    check(icons.some((i) => i.sizes === need && (i.purpose ?? 'any').includes('any')), `no "any" icon ${need}`)
  }
  check(icons.some((i) => (i.purpose ?? '').includes('maskable')), 'no maskable icon')
  for (const i of icons) {
    const f = join(dist, i.src)
    if (!existsSync(f)) {
      errors.push(`icon file missing: ${i.src}`)
      continue
    }
    const size = pngSize(f)
    check(size && `${size[0]}x${size[1]}` === i.sizes, `icon ${i.src} is ${size?.join('x')} but declared ${i.sizes}`)
  }
}

check(existsSync(join(dist, 'sw.js')), 'service worker sw.js missing')
const html = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : ''
check(/<link[^>]+rel="manifest"/.test(html), 'index.html has no <link rel="manifest">')
check(html.includes('<title>Calorie Tracker</title>'), 'index.html <title> is not "Calorie Tracker"')

if (errors.length) {
  console.error('PWA check failed:\n - ' + errors.join('\n - '))
  process.exit(1)
}
console.log('PWA check passed: manifest, icons, service worker, manifest link')
