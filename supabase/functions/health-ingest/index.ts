// Supabase Edge Function: POST /functions/v1/health-ingest
// Called by an Apple Shortcuts automation (or Android/Tasker) to push today's Apple Health data.
//   Authorization: Bearer <personal token from the app>
//   Body (any subset): {"steps": 7842, "active_kcal": 512, "resting_kcal": 1203,
//                       "as_of": "<ISO time>", "date": "2026-10-06", "workouts": [...]}
//   See _shared/healthIngest.ts for the full format. The original {"steps": N} still works.
// Only a SHA-256 hash of the token is stored; the token itself never touches the DB.
import { createClient } from '@supabase/supabase-js'
import { corsHeaders, json, sha256Hex } from '../_shared/http.ts'
import { parseIngest } from '../_shared/healthIngest.ts'

const MAX_BODY = 64_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!/^mz_[0-9a-f]{48}$/.test(token)) return json({ error: 'invalid token' }, 401)

  const text = await req.text()
  if (text.length > MAX_BODY) return json({ error: 'body too large' }, 413)
  let raw: unknown
  try {
    // Shortcuts sometimes sends the number with locale separators ("7,842") — handled leniently later
    raw = JSON.parse(text)
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: owner } = await admin.from('mz_health_ingest_tokens').select('user_id').eq('token_hash', await sha256Hex(token)).maybeSingle()
  if (!owner) return json({ error: 'invalid token' }, 401)
  const { data: member } = await admin.from('mz_members').select('user_id').eq('user_id', owner.user_id).maybeSingle()
  if (!member) return json({ error: 'not a member' }, 403)

  const { data: profile } = await admin.from('mz_profiles').select('timezone').eq('user_id', owner.user_id).maybeSingle()
  const tz = profile?.timezone || 'Asia/Jerusalem'

  const parsed = await parseIngest(raw, { userId: owner.user_id, tz })
  if (!parsed.ok) {
    console.warn(JSON.stringify({ fn: 'health-ingest', user: owner.user_id, status: 'rejected', error: parsed.error }))
    return json({ error: parsed.error }, 400)
  }
  const p = parsed.value

  const { data, error } = await admin.rpc('mz_ingest_health', {
    p_user: owner.user_id,
    p_date: p.date,
    p_steps: p.steps,
    p_active: p.active_kcal,
    p_resting: p.resting_kcal,
    p_as_of: p.as_of,
    p_workouts: p.workouts.map((w) => ({
      id: w.external_id, date: w.date, type: w.type, title: w.title, started_at: w.started_at, ended_at: w.ended_at,
      duration_min: w.duration_min, distance_km: w.distance_km, kcal: w.kcal, source_app: w.source_app,
    })),
  })
  if (error) {
    // the database not migrated yet → still accept steps the old way, so the existing automation keeps working
    if (/mz_ingest_health/.test(error.message) && p.steps !== null) {
      const { error: e2 } = await admin.from('mz_health_data').upsert(
        { user_id: owner.user_id, date: p.date, steps: p.steps, source: 'shortcut', updated_at: new Date().toISOString() },
        { onConflict: 'user_id,date' },
      )
      if (!e2) {
        console.warn(JSON.stringify({ fn: 'health-ingest', user: owner.user_id, status: 'steps_only_fallback', reason: 'migration missing' }))
        return json({ ok: true, date: p.date, steps: p.steps, note: 'energy and workouts need the 20261012 migration' })
      }
    }
    console.error(JSON.stringify({ fn: 'health-ingest', user: owner.user_id, status: 'write_failed', error: error.message }))
    return json({ error: 'write failed' }, 500)
  }

  const result = {
    ok: true,
    date: p.date,
    steps: p.steps,
    active_kcal: p.active_kcal,
    resting_kcal: p.resting_kcal,
    as_of: p.as_of,
    workouts: p.workouts.length,
    ...(data as Record<string, unknown>),
    ...(p.warnings.length ? { warnings: p.warnings } : {}),
  }
  console.log(JSON.stringify({ fn: 'health-ingest', user: owner.user_id, status: 'ok', ...result }))
  return json(result)
})
