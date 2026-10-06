import { setSteps } from '../data/store'
import { toDateKey } from '../domain/goal'
import { getSupabase } from './supabase'
import { SUPABASE_URL } from './config'

/**
 * Apple Health bridge.
 *
 * A web app / PWA cannot read HealthKit — Apple exposes it only to native apps.
 * Two practical bridges, both driven by the free Apple "Shortcuts" app:
 *
 *  A) Background (recommended, needs Supabase): a Shortcuts *Personal Automation*
 *     (e.g. daily 12:00 / 18:00 / 21:15) runs "Find Health Samples → Steps → today",
 *     sums them and POSTs {date, steps} to the `health-ingest` edge function with a
 *     personal token. The app pulls it on next open. No app needs to be open.
 *
 *  B) Open-with-URL (no backend): the shortcut opens
 *     https://<app>/?steps=7842&date=2026-10-06 and the app imports it.
 *     Caveat: on iOS, links open in Safari, whose storage is separate from the
 *     home-screen PWA. B therefore suits Safari-tab / Android / desktop usage.
 *
 * Manual entry always works.
 */

export function ingestFromUrl(loc: Location = window.location): { steps: number; date: string } | null {
  const params = new URLSearchParams(loc.search)
  const raw = params.get('steps')
  if (raw === null) return null
  const steps = Number(String(raw).replace(/[^\d.]/g, ''))
  const dateParam = params.get('date')
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : toDateKey(new Date())
  params.delete('steps')
  params.delete('date')
  const clean = `${loc.pathname}${params.toString() ? `?${params}` : ''}${loc.hash}`
  try {
    window.history.replaceState(null, '', clean)
  } catch {
    /* ignore */
  }
  if (!Number.isFinite(steps) || steps < 0 || steps > 150_000) return null
  setSteps(date, steps, 'url')
  return { steps: Math.round(steps), date }
}

export const HEALTH_INGEST_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/health-ingest` : null

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Creates (or rotates) the personal token used by the Shortcut. Only the hash is stored server-side. */
export async function createIngestToken(): Promise<string | null> {
  const sb = await getSupabase()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  const uid = data.session?.user.id
  if (!uid) return null
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  const token = 'mz_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  const { error } = await sb.from('health_ingest_tokens').upsert({ user_id: uid, token_hash: await sha256Hex(token), created_at: new Date().toISOString() })
  return error ? null : token
}
