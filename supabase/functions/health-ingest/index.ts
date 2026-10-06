// Supabase Edge Function: POST /functions/v1/health-ingest
// Called by an Apple Shortcuts automation (or Android/Tasker) to push today's steps.
//   Authorization: Bearer <personal token from the app>
//   Body: {"steps": 7842, "date": "2026-10-06"}   (date optional → today in Asia/Jerusalem)
// Only a SHA-256 hash of the token is stored; the token itself never touches the DB.
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { corsHeaders, json, sha256Hex } from '../_shared/http.ts'

const Body = z.object({
  steps: z.coerce.number().int().min(0).max(150000),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  active_kcal: z.coerce.number().min(0).max(10000).optional(),
})

function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!/^mz_[0-9a-f]{48}$/.test(token)) return json({ error: 'invalid token' }, 401)

  let raw: unknown
  try {
    const text = await req.text()
    // Shortcuts sometimes sends the number with locale separators ("7,842")
    raw = JSON.parse(text.replace(/"steps"\s*:\s*"([\d,.\s]+)"/, (_m, n) => `"steps": ${String(n).replace(/[^\d]/g, '')}`))
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  const body = Body.safeParse(raw)
  if (!body.success) return json({ error: 'invalid body' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: owner } = await admin.from('health_ingest_tokens').select('user_id').eq('token_hash', await sha256Hex(token)).maybeSingle()
  if (!owner) return json({ error: 'invalid token' }, 401)

  const { data: profile } = await admin.from('profiles').select('timezone').eq('user_id', owner.user_id).maybeSingle()
  const date = body.data.date ?? todayIn(profile?.timezone ?? 'Asia/Jerusalem')

  const { error } = await admin.from('health_data').upsert(
    { user_id: owner.user_id, date, steps: body.data.steps, active_kcal: body.data.active_kcal ?? null, source: 'shortcut', updated_at: new Date().toISOString() },
    { onConflict: 'user_id,date' },
  )
  if (error) return json({ error: 'write failed' }, 500)
  return json({ ok: true, date, steps: body.data.steps })
})
