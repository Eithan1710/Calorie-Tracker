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
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'] },
      manifest: {
        name: 'מאזן — מעקב קלוריות לריקומפ',
        short_name: 'מאזן',
        description: 'מעקב קלוריות וחלבון מהיר, בעברית',
        lang: 'he',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f5f3ee',
        theme_color: '#f5f3ee',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
  server: { host: true },
})
