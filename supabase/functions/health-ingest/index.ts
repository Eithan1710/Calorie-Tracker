// Supabase Edge Function: POST /functions/v1/health-ingest
// Called by an Apple Shortcuts automation (or Android/Tasker) to push Apple Health data.
//   Authorization: Bearer <personal token from the app>
//   Body (any subset): {"steps": 7842, "active_kcal": 512, "resting_kcal": 1203,
//                       "as_of": "<ISO time>", "date": "2026-10-06" | "yesterday", "workouts": [...],
//                       "active_samples": [{"start", "end", "kcal", "source"}], "resting_samples": [...]}
//   See _shared/healthIngest.ts for the full format. The original {"steps": N} still works.
// Per-day totals (most accurate; each overwrites that day): the body is one or more
//   {"date": "15 Oct 2026 at 0:06" | "2026-10-16", "active_kcal" | "resting_kcal" | "steps": …}
//   objects — back to back as text, one per line, or a JSON array.
// Calendar days are Asia/Jerusalem days (override with the MZ_DAY_TZ secret).
// Only a SHA-256 hash of the token is stored; the token itself never touches the DB.
import { createClient } from '@supabase/supabase-js'
import { corsHeaders, json, sha256Hex } from '../_shared/http.ts'
import { classifyBody, DAY_TZ, parseDailyTotals, parseIngest, type EnergyKind, type ParsedDay } from '../_shared/healthIngest.ts'

// two days of raw samples (~150 bytes each) fit comfortably
const MAX_BODY = 1_000_000

const log = (level: 'log' | 'warn' | 'error', user: string | null, status: string, extra: Record<string, unknown> = {}) =>
  console[level](JSON.stringify({ fn: 'health-ingest', user, status, ...extra }))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? ''
  if (!/^mz_[0-9a-f]{48}$/.test(token)) return json({ error: 'invalid token' }, 401)

  const text = await req.text()
  if (text.length > MAX_BODY) {
    log('warn', null, 'rejected', { error: 'body too large', bytes: text.length })
    return json({ error: 'body too large' }, 413)
  }
  // Shortcuts sometimes sends the number with locale separators ("7,842") — handled leniently later
  const body = classifyBody(text)
  if (body.mode === 'invalid') return json({ error: body.error }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: owner } = await admin.from('mz_health_ingest_tokens').select('user_id').eq('token_hash', await sha256Hex(token)).maybeSingle()
  if (!owner) return json({ error: 'invalid token' }, 401)
  const user = owner.user_id as string
  const { data: member } = await admin.from('mz_members').select('user_id').eq('user_id', user).maybeSingle()
  if (!member) return json({ error: 'not a member' }, 403)

  // day boundaries: Israel's calendar day, for every request (not the phone's or the profile's zone)
  const tz = Deno.env.get('MZ_DAY_TZ') || DAY_TZ

  if (body.mode === 'daily') return ingestDays(admin, user, tz, body.items)

  const parsed = await parseIngest(body.raw, { userId: user, tz })
  if (!parsed.ok) {
    log('warn', user, 'rejected', { error: parsed.error })
    return json({ error: parsed.error }, 400)
  }
  const p = parsed.value
  const warnings = [...p.warnings]

  // 1. timestamped samples first: each filed under its own day, totals recomputed from them
  const samples: Partial<Record<EnergyKind, unknown>> = {}
  for (const kind of ['active', 'resting'] as const) {
    const list = p.samples[kind]
    const stats = p.sample_stats[kind]
    if (!stats) continue
    if (!list.length) {
      samples[kind] = { ...stats, stored: false }
      continue
    }
    const { data, error } = await admin.rpc('mz_ingest_health_samples', {
      p_user: user,
      p_kind: kind,
      p_tz: tz,
      p_as_of: p.as_of,
      p_samples: list.map((s) => ({ key: s.key, start: s.start, end: s.end, kcal: s.kcal, source: s.source })),
    })
    if (error) {
      if (/mz_ingest_health_samples|mz_health_samples/.test(error.message)) {
        // database not migrated yet: keep everything else working, say why samples were not used
        warnings.push(`${kind} samples ignored: the 20261014 migration is not applied yet`)
        log('warn', user, 'samples_skipped', { kind, reason: 'migration missing', received: stats.received })
        samples[kind] = { ...stats, stored: false }
        continue
      }
      log('error', user, 'write_failed', { step: 'samples', kind, error: error.message })
      return json({ error: 'write failed' }, 500)
    }
    const db = data as Record<string, unknown>
    samples[kind] = { ...stats, stored: true, ...db }
    if (Array.isArray(db.capped_days) && db.capped_days.length) warnings.push(`${kind} total capped for ${db.capped_days.join(', ')}`)
    log('log', user, 'samples', {
      kind, received: stats.received, accepted: stats.accepted, duplicates_in_request: stats.duplicates_in_request,
      invalid_timestamp: stats.invalid_timestamp, invalid_value: stats.invalid_value, out_of_range: stats.out_of_range,
      inserted: db.inserted, updated: db.updated, unchanged: db.unchanged, replaced: db.replaced, days: db.days,
    })
  }

  // 2. aggregate snapshot for `date` (steps, totals) + workouts — the original behaviour
  const hasAggregate = p.steps !== null || p.active_kcal !== null || p.resting_kcal !== null || p.workouts.length > 0
  let aggregate: Record<string, unknown> = {}
  if (hasAggregate) {
    const { data, error } = await admin.rpc('mz_ingest_health', {
      p_user: user,
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
          { user_id: user, date: p.date, steps: p.steps, source: 'shortcut', updated_at: new Date().toISOString() },
          { onConflict: 'user_id,date' },
        )
        if (!e2) {
          log('warn', user, 'steps_only_fallback', { reason: 'migration missing' })
          return json({ ok: true, date: p.date, steps: p.steps, note: 'energy and workouts need the 20261012 migration' })
        }
      }
      log('error', user, 'write_failed', { step: 'aggregate', error: error.message })
      return json({ error: 'write failed' }, 500)
    }
    aggregate = (data ?? {}) as Record<string, unknown>
    if (aggregate.active_ignored_samples_day) warnings.push(`active_kcal ignored for ${p.date}: that day's total comes from active_samples`)
    if (aggregate.resting_ignored_samples_day) warnings.push(`resting_kcal ignored for ${p.date}: that day's total comes from resting_samples`)
  }

  const result = {
    ok: true,
    date: p.date,
    steps: p.steps,
    active_kcal: p.active_kcal,
    resting_kcal: p.resting_kcal,
    as_of: p.as_of,
    workouts: p.workouts.length,
    ...aggregate,
    ...(Object.keys(samples).length ? { samples } : {}),
    ...(warnings.length ? { warnings } : {}),
  }
  log('log', user, 'ok', { date: p.date, tz, steps: p.steps, active_kcal: p.active_kcal, resting_kcal: p.resting_kcal, workouts: p.workouts.length, ...aggregate, warnings })
  return json(result)
})

/** Per-day totals: each day/kind sent overwrites what was stored for that day. */
// deno-lint-ignore no-explicit-any
async function ingestDays(admin: any, user: string, tz: string, items: Record<string, unknown>[]): Promise<Response> {
  const parsed = parseDailyTotals(items, { tz })
  if (!parsed.ok) {
    log('warn', user, 'rejected', { mode: 'daily', error: parsed.error, objects: items.length })
    return json({ error: parsed.error }, 400)
  }
  const { days, received, warnings } = parsed.value
  const rows = days.map((d: ParsedDay) => ({ date: d.date, steps: d.steps, active: d.active_kcal, resting: d.resting_kcal, as_of: d.as_of, final: d.final }))
  const { data, error } = await admin.rpc('mz_ingest_health_days', { p_user: user, p_days: rows })
  let db: Record<string, unknown> = (data ?? {}) as Record<string, unknown>
  if (error) {
    if (!/mz_ingest_health_days/.test(error.message)) {
      log('error', user, 'write_failed', { step: 'days', error: error.message })
      return json({ error: 'write failed' }, 500)
    }
    // database not migrated yet: write each day as a fresh snapshot (newest wins) so nothing is lost
    for (const d of days) {
      const { error: e2 } = await admin.rpc('mz_ingest_health', {
        p_user: user, p_date: d.date, p_steps: d.steps, p_active: d.active_kcal, p_resting: d.resting_kcal, p_as_of: new Date().toISOString(), p_workouts: [],
      })
      if (e2) {
        log('error', user, 'write_failed', { step: 'days_fallback', error: e2.message })
        return json({ error: 'write failed' }, 500)
      }
    }
    warnings.push('day totals stored as snapshots: the 20261016 migration is not applied yet')
    db = {}
  }
  const result = {
    ok: true,
    mode: 'daily',
    objects: received,
    days: Object.fromEntries(days.map((d) => [d.date, {
      ...(d.steps !== null ? { steps: d.steps } : {}),
      ...(d.active_kcal !== null ? { active_kcal: d.active_kcal } : {}),
      ...(d.resting_kcal !== null ? { resting_kcal: d.resting_kcal } : {}),
      final: d.final,
    }])),
    ...('new_days' in db ? { new_days: db.new_days, changed_days: db.changed_days, unchanged_days: db.unchanged_days } : {}),
    ...(warnings.length ? { warnings } : {}),
  }
  // numbers and dates only (no tokens, nothing else about the user)
  log('log', user, 'ok', { mode: 'daily', tz, objects: received, days: db.days ?? result.days, warnings })
  return json(result)
}
