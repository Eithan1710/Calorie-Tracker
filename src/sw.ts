/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope

// What this service worker caches — and what it never does:
//  • Precache: only the app's own built files (HTML, JS, CSS, fonts, icons), versioned
//    by content hash. Old versions are deleted on activation (cleanupOutdatedCaches).
//  • No runtime caching at all: requests to Supabase (data, auth, photos via signed URLs)
//    and to the AI endpoint go straight to the network and are never stored here.
//    Personal data lives only where it did before — the per-account IndexedDB and Supabase —
//    so the SW can never show stale nutrition numbers or leak one user's data to another.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/api\//] }))

// Updates: the page asks the new version to take over when it's safe (see main.tsx)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})
// control pages opened before this SW finished installing (first visit)
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Daily reminder via Web Push (sent by the send-reminders edge function)
self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; url?: string } = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Calorie Tracker', {
      body: payload.body ?? 'לא שכחת לעדכן את היום? 🥗',
      tag: 'daily-reminder',
      icon: new URL('pwa-192.png', self.registration.scope).href,
      badge: new URL('badge-72.png', self.registration.scope).href,
      lang: 'he',
      dir: 'rtl',
      // relative to the app's scope so it works under a sub-path (GitHub Pages)
      data: { url: new URL(payload.url ?? './?add=1', self.registration.scope).href },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data?.url as string) ?? self.registration.scope
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of all) {
        if ('focus' in c) {
          await (c as WindowClient).navigate(url).catch(() => undefined)
          return (c as WindowClient).focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
