import { getState } from '../data/store'
import { getSupabase } from './supabase'

/**
 * Error monitoring: unexpected client errors are sent to mz_client_errors (insert-only for the
 * signed-in member; read from the Supabase dashboard). No food, health or personal data — only
 * the error message, a trimmed stack, the screen and the app version. Deduplicated and capped so a
 * crash loop can't flood the table.
 */
const MAX_PER_SESSION = 10
const sent = new Set<string>()
let count = 0

export function reportError(err: unknown, where = 'window'): void {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err)?.slice(0, 300) ?? 'unknown')
    const message = String(e.message || e.name || 'error').slice(0, 300)
    // a browser extension or a cancelled request is not our bug
    if (/ResizeObserver loop|AbortError|Load failed|Failed to fetch|NetworkError/i.test(message)) return
    const key = `${where}:${message}`
    if (sent.has(key) || count >= MAX_PER_SESSION) return
    sent.add(key)
    count++
    const userId = getState().userId
    if (!userId) return
    const row = {
      user_id: userId,
      message,
      stack: (e.stack ?? '').split('\n').slice(0, 8).join('\n').slice(0, 1500),
      where_: where.slice(0, 40),
      path: location.pathname.slice(0, 120),
      app_version: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev',
      user_agent: navigator.userAgent.slice(0, 200),
    }
    void getSupabase().then((sb) => sb?.from('mz_client_errors').insert(row).then(() => {}, () => {}))
  } catch {
    // monitoring must never cause an error itself
  }
}

export function initErrorReporting(): void {
  window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message, 'window'))
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, 'promise'))
}
