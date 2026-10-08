import type { SupabaseClient } from '@supabase/supabase-js'
import { hasSupabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/** localStorage key of the persisted Supabase session (read synchronously at startup, see auth.ts). */
export const AUTH_STORAGE_KEY = 'maazan-auth'

let client: SupabaseClient | null = null
let loading: Promise<SupabaseClient | null> | null = null

/**
 * Lazily loaded so the app's first paint never waits for the Supabase SDK.
 * The session is persisted in localStorage and refreshed automatically, so a
 * user stays signed in across app restarts (also in the home-screen PWA).
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!hasSupabase) return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_STORAGE_KEY },
    })
    return client
  })
  return loading
}
