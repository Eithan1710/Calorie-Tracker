import type { SupabaseClient } from '@supabase/supabase-js'
import { hasSupabase, SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

let client: SupabaseClient | null = null
let loading: Promise<SupabaseClient | null> | null = null

/**
 * Lazily loaded so the app's first paint never waits for the Supabase SDK.
 * No auth session: single-owner mode talks to the mz_ tables with the public key.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!hasSupabase) return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  loading ??= import('@supabase/supabase-js').then(({ createClient }) => {
    client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    return client
  })
  return loading
}
