import type { SupabaseClient } from '@supabase/supabase-js'

/** Env var first (set via `supabase secrets set`), then the `mz_*` Vault secret. */
// deno-lint-ignore no-explicit-any
export async function getSecret(admin: SupabaseClient<any, any, any>, envName: string, vaultName: string): Promise<string | null> {
  const fromEnv = Deno.env.get(envName)
  if (fromEnv) return fromEnv
  const { data, error } = await admin.rpc('mz_get_secret', { secret_name: vaultName })
  return error ? null : ((data as string | null) ?? null)
}

// deno-lint-ignore no-explicit-any
export async function setSecret(admin: SupabaseClient<any, any, any>, vaultName: string, value: string): Promise<boolean> {
  const { error } = await admin.rpc('mz_set_secret', { secret_name: vaultName, secret_value: value })
  return !error
}
