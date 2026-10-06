/** Public (non-secret) runtime config. Never put API keys for AI providers here. */
const env = import.meta.env

export const SUPABASE_URL: string | undefined = env.VITE_SUPABASE_URL || undefined
export const SUPABASE_ANON_KEY: string | undefined = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || undefined
export const VAPID_PUBLIC_KEY: string | undefined = env.VITE_VAPID_PUBLIC_KEY || undefined

export const hasSupabase = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

/** Where the analyze endpoint lives: explicit → Supabase functions → local dev server. */
export const API_BASE: string = (env.VITE_API_BASE as string | undefined) || (SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '/api')
