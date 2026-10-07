import { getState, foodForDate, updateSettings } from '../data/store'
import { toDateKey } from '../domain/goal'
import { API_BASE, OWNER_ID, SUPABASE_ANON_KEY, VAPID_PUBLIC_KEY, hasSupabase } from './config'
import { getSupabase } from './supabase'

/**
 * Daily 21:30 reminder — at most one per day, skipped if the evening was already logged.
 *
 * Reality of web notifications:
 *  - A web page cannot schedule an OS notification for later (the Notification
 *    Triggers API was abandoned). Reliable delivery while the app is closed
 *    requires Web Push from a server → implemented with Supabase pg_cron +
 *    the `send-reminders` edge function + VAPID.
 *  - iOS/iPadOS supports Web Push only for PWAs added to the Home Screen (16.4+).
 *  - Without push (no backend / not signed in) we fall back to a local timer
 *    that fires while the app is open or in a background tab, plus an in-app
 *    banner when the app is opened after 21:30 with nothing logged.
 */

export const REMINDER_TEXT = 'לא שכחת לעדכן את היום? 🥗'

export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

export type NotifySupport = 'ok' | 'ios_needs_install' | 'unsupported' | 'denied'

export function notificationSupport(): NotifySupport {
  if (isIOS() && !isStandalone()) return 'ios_needs_install'
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return 'ok'
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

/** The Web Push public key: build-time env, else generated/stored server-side (Vault). */
async function vapidPublicKey(): Promise<string | null> {
  if (VAPID_PUBLIC_KEY) return VAPID_PUBLIC_KEY
  try {
    const res = await fetch(`${API_BASE}/send-reminders?vapid-public-key`, { headers: SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {} })
    if (!res.ok) return null
    return ((await res.json()) as { publicKey?: string }).publicKey ?? null
  } catch {
    return null
  }
}

/** Subscribe to server push (needs the Supabase backend). */
async function subscribePush(): Promise<boolean> {
  if (!hasSupabase || !('PushManager' in window)) return false
  const publicKey = await vapidPublicKey()
  if (!publicKey) return false
  const sb = await getSupabase()
  if (!sb) return false
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
  const j = sub.toJSON()
  const { error } = await sb.from('mz_push_subscriptions').upsert(
    {
      user_id: OWNER_ID,
      endpoint: sub.endpoint,
      p256dh: j.keys?.p256dh,
      auth: j.keys?.auth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      reminder_time: getState().settings.reminderTime,
      enabled: true,
    },
    { onConflict: 'endpoint' },
  )
  return !error
}

async function unsubscribePush() {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager?.getSubscription()
  if (!sub) return
  const sb = await getSupabase()
  await sb?.from('mz_push_subscriptions').update({ enabled: false }).eq('endpoint', sub.endpoint)
  await sub.unsubscribe().catch(() => {})
}

export async function enableReminders(): Promise<{ ok: boolean; push: boolean; message?: string }> {
  const support = notificationSupport()
  if (support === 'ios_needs_install') {
    return { ok: false, push: false, message: 'באייפון התראות עובדות רק אחרי "הוספה למסך הבית" מתפריט השיתוף של ספארי.' }
  }
  if (support === 'unsupported') return { ok: false, push: false, message: 'הדפדפן הזה לא תומך בהתראות.' }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, push: false, message: 'ההתראות חסומות. אפשר להפעיל אותן בהגדרות הדפדפן.' }
  updateSettings({ remindersEnabled: true })
  let push = false
  try {
    push = await subscribePush()
  } catch {
    push = false
  }
  updateSettings({ pushSubscribed: push })
  scheduleLocalReminder()
  return { ok: true, push }
}

export async function disableReminders() {
  updateSettings({ remindersEnabled: false, pushSubscribed: false })
  if (localTimer) clearTimeout(localTimer)
  await unsubscribePush().catch(() => {})
}

/** Evening already logged = something added today after 17:00. */
export function eveningLogged(now = new Date()): boolean {
  const today = toDateKey(now)
  return foodForDate(getState(), today).some((f) => new Date(f.created_at).getHours() >= 17)
}

function reminderAt(now: Date): Date {
  const [h, m] = (getState().settings.reminderTime || '21:30').split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return d
}

/** True when the in-app nudge should show (after reminder time, nothing logged tonight). */
export function shouldShowInAppReminder(now = new Date()): boolean {
  return now >= reminderAt(now) && !eveningLogged(now) && foodForDate(getState(), toDateKey(now)).length < 2
}

let localTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleLocalReminder() {
  if (localTimer) clearTimeout(localTimer)
  const s = getState().settings
  if (!s.remindersEnabled || s.pushSubscribed || !('Notification' in window) || Notification.permission !== 'granted') return
  const now = new Date()
  const at = reminderAt(now)
  const today = toDateKey(now)
  if (now >= at || s.lastReminderDate === today) return
  localTimer = setTimeout(async () => {
    const st = getState().settings
    if (st.lastReminderDate === toDateKey(new Date()) || eveningLogged()) return
    updateSettings({ lastReminderDate: toDateKey(new Date()) })
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('מאזן', { body: REMINDER_TEXT, tag: 'daily-reminder', icon: `${import.meta.env.BASE_URL}pwa-192.png`, badge: `${import.meta.env.BASE_URL}badge-72.png`, lang: 'he', dir: 'rtl', data: { url: `${import.meta.env.BASE_URL}?add=1` } })
    } catch {
      /* ignore */
    }
  }, at.getTime() - now.getTime())
}
