/** Public (non-secret) runtime config. Never put API keys for AI providers here. */
const env = import.meta.env

export const SUPABASE_URL: string | undefined = env.VITE_SUPABASE_URL || undefined
export const SUPABASE_ANON_KEY: string | undefined = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || undefined
export const VAPID_PUBLIC_KEY: string | undefined = env.VITE_VAPID_PUBLIC_KEY || undefined

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** Where the analyze endpoint lives: explicit → Supabase functions → local dev server. */
export const API_BASE: string = (env.VITE_API_BASE as string | undefined) || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '/api')

/**
 * Single-owner mode: the app has exactly one user and no login. All rows in
 * Supabase belong to this id, so every device you open the app on shares the
 * same data. (Change the RLS policies + this id to go multi-user later.)
 */
export const OWNER_ID: string = (env.VITE_OWNER_ID as string | undefined) || '00000000-0000-4000-8000-000000000001'
