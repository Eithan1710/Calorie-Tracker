// Supabase Edge Function: POST /functions/v1/analyze-food
// Holds the AI provider keys server-side; the browser never sees them.
import { createClient } from '@supabase/supabase-js'
import { analyzeFood } from '../_shared/pipeline.ts'
import { AnalyzeRequestSchema } from '../_shared/schema.ts'
import { corsHeaders, json } from '../_shared/http.ts'
import { getSecret } from '../_shared/secrets.ts'

// AI keys: function env vars first, else Vault (synced from GitHub secrets by
// .github/workflows/sync-ai-keys.yml through the mz-config function).
const VAULT_KEYS: Record<string, string> = {
  GEMINI_API_KEY: 'mz_gemini_api_key',
  GROQ_API_KEY: 'mz_groq_api_key',
  OPENROUTER_API_KEY: 'mz_openrouter_api_key',
  USDA_FDC_API_KEY: 'mz_usda_fdc_api_key',
}
let vaultCache: { at: number; values: Record<string, string> } | null = null

// deno-lint-ignore no-explicit-any
async function loadKeys(admin: any): Promise<Record<string, string>> {
  if (vaultCache && Date.now() - vaultCache.at < 5 * 60_000) return vaultCache.values
  const values: Record<string, string> = {}
  await Promise.all(
    Object.entries(VAULT_KEYS).map(async ([k, vaultName]) => {
      const v = await getSecret(admin, k, vaultName)
      if (v) values[k] = v
    }),
  )
  vaultCache = { at: Date.now(), values }
  return values
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'bad_request', message: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const keys = await loadKeys(admin)
  const env = (k: string) => keys[k] ?? Deno.env.get(k)

  // Single-owner mode (default): the app has one user and no login, so the
  // endpoint is open and everything is attributed to MZ_OWNER_ID.
  // Set REQUIRE_AUTH=true later to require a Supabase session instead.
  let userId: string | null = env('MZ_OWNER_ID') ?? '00000000-0000-4000-8000-000000000001'
  if (env('REQUIRE_AUTH') === 'true') {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user) return json({ error: 'unauthorized', message: 'צריך להתחבר כדי להשתמש בניתוח החכם.' }, 401)
    userId = data.user.id
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request', message: 'משהו בבקשה לא תקין. נסה שוב.' }, 400)
  }
  const parsed = AnalyzeRequestSchema.safeParse(body)
  if (!parsed.success) return json({ error: 'bad_request', message: 'משהו בבקשה לא תקין. נסה שוב.' }, 400)

  const result = await analyzeFood(parsed.data, {
    env,
    log: (entry) => {
      if (!userId) return
      // fire-and-forget; never store images, and only a truncated text
      admin.from('mz_ai_analysis_logs').insert({
        user_id: userId,
        input_kind: parsed.data.image ? 'photo' : parsed.data.mode === 'correct' ? 'correction' : 'text',
        input_text: (parsed.data.correction ?? parsed.data.text ?? '').slice(0, 200),
        provider: entry.provider,
        model: entry.model ?? null,
        success: entry.ok,
        error_code: entry.error ?? null,
        latency_ms: entry.latency_ms,
        attempts: entry.attempts,
      }).then(() => {}, () => {})
    },
  })

  if (result.ok) return json(result.analysis)
  const status = result.error === 'unavailable' ? 503 : 422
  return json({ error: result.error, message: result.message, clarification: result.clarification ?? null }, status)
})
