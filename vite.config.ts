import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execFileSync } from 'node:child_process'
import { apiPlugin } from './dev/apiPlugin'

// keep the edge-function copy of the nutrition skill in sync with SKILL.md
execFileSync(process.execPath, ['scripts/sync-skill.mjs'], { stdio: 'inherit' })

// GitHub Pages serves the app under /<repo>/ — set VITE_BASE=/Calorie-Tracker/ there
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  // separate dep caches when two dev servers run side by side (e2e: local mode + accounts mode)
  cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
  plugins: [
    react(),
    tailwindcss(),
    apiPlugin(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // updates are applied by main.tsx when the app is in the background (never mid-entry)
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      // Installable PWA (Android Chrome "Install app", iOS "Add to Home Screen").
      // Paths are relative so the app works under the GitHub Pages sub-path (/Calorie-Tracker/).
      manifest: {
        id: './',
        name: 'Calorie Tracker',
        short_name: 'Calorie Tracker',
        description: 'מעקב קלוריות, חלבון ואימונים — מהיר ובעברית',
        lang: 'he',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['standalone'],
        orientation: 'portrait',
        // matches the app's --bg token (light theme), so the splash screen blends into the first paint
        background_color: '#f5f3ee',
        theme_color: '#f5f3ee',
        categories: ['health', 'fitness', 'food'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  server: { host: true },
})
