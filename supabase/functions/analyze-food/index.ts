// Supabase Edge Function: POST /functions/v1/analyze-food
// Holds the AI provider keys server-side; the browser never sees them.
import { createClient } from '@supabase/supabase-js'
import { analyzeFood } from '../_shared/pipeline.ts'
import { AnalyzeRequestSchema } from '../_shared/schema.ts'
import { corsHeaders, json } from '../_shared/http.ts'

const env = (k: string) => Deno.env.get(k)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'bad_request', message: 'POST only' }, 405)

  const url = env('SUPABASE_URL')!
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Auth: a signed-in user is required (protects the free AI quota from abuse).
  // Set REQUIRE_AUTH=false only for a private deployment you control.
  let userId: string | null = null
  if (env('REQUIRE_AUTH') !== 'false') {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
    const { data, error } = await admin.auth.getUser(token)
    // anonymous sessions (allowed in a shared project for other apps) don't get the AI quota
    if (error || !data.user || data.user.is_anonymous) return json({ error: 'unauthorized', message: 'צריך להתחבר כדי להשתמש בניתוח החכם.' }, 401)
    const allowed = (env('ALLOWED_EMAILS') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (allowed.length && !allowed.includes((data.user.email ?? '').toLowerCase())) {
      return json({ error: 'unauthorized', message: 'החשבון הזה לא מורשה.' }, 403)
    }
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
