/**
 * Apple Health → מאזן ingest payload (sent by an iOS Shortcuts automation).
 * Pure, runtime-agnostic parsing + validation, shared by the edge function and tests.
 *
 *   {
 *     "steps": 7842,                                  // any subset of the fields below
 *     "active_kcal": 512.3,                           // Apple "Active Energy", sum for the day
 *     "resting_kcal": 1203.4,                         // Apple "Resting Energy", sum for the day
 *     "date": "2026-10-11",                           // optional; default = today (Asia/Jerusalem); also "today" / "yesterday"
 *     "as_of": "2026-10-11T21:15:00+03:00",           // optional; when the totals were read
 *     "energy_unit": "kcal",                          // optional; "kJ" is converted
 *     "workouts": [{ "type": "Running", "start": "…", "end": "…", "duration_min": 32,
 *                    "distance_km": 5.1, "kcal": 340, "source": "Strava" }],
 *     "active_samples":  [{ "start": "2026-10-11T00:00:00+03:00", "end": "…", "kcal": 412.5, "source": "Apple Watch" }],
 *     "resting_samples": [ …same shape… ]
 *   }
 *
 * Shortcuts sends numbers in many shapes ("7,842", "512.3 kcal", "5.1 km", "00:32:10"),
 * so every numeric field is parsed leniently, then range-checked.
 *
 * Two ways to send energy:
 *  • Aggregate totals (active_kcal / resting_kcal) — one snapshot of ONE day (`date`,
 *    default today). Idempotent: a newer snapshot replaces an older one. The server can't
 *    tell which day the energy in an aggregate belongs to, so it is filed under `date`.
 *  • Timestamped samples (active_samples / resting_samples) — raw Health samples or
 *    Shortcuts' grouped buckets (Group by Day/Hour). Each sample is filed under the local
 *    calendar day of its START time, so one request may carry yesterday and today. Each
 *    gets a stable key (the sample's own id if sent, else hash of kind|start|end|source):
 *    re-sending updates it instead of adding it again. Day totals are then recomputed
 *    from the stored samples (see mz_ingest_health_samples).
 */

export type HealthWorkoutType = 'run' | 'walk' | 'strength' | 'cycling' | 'swimming' | 'other'

export interface ParsedWorkout {
  /** deterministic key: same workout sent again → same row */
  external_id: string
  type: HealthWorkoutType
  title: string
  started_at: string
  ended_at: string | null
  /** local calendar day of the start, in the user's time zone */
  date: string
  duration_min: number | null
  distance_km: number | null
  /** workout active energy reported by Apple Health (kcal), if any */
  kcal: number | null
  source_app: string | null
}

export type EnergyKind = 'active' | 'resting'

export interface ParsedSample {
  /** stable identity: the sample's own id when sent, else sha256(kind|start|end|source) */
  key: string
  /** local calendar day (day-boundary time zone) of the sample's start */
  date: string
  start: string
  end: string
  kcal: number
  source: string | null
}

export interface SampleStats {
  received: number
  accepted: number
  /** same key twice in one request (the last one wins) */
  duplicates_in_request: number
  invalid_timestamp: number
  invalid_value: number
  out_of_range: number
  /** accepted samples per local day */
  days: Record<string, { samples: number; kcal: number }>
}

export interface ParsedIngest {
  date: string
  steps: number | null
  active_kcal: number | null
  resting_kcal: number | null
  as_of: string
  workouts: ParsedWorkout[]
  samples: Record<EnergyKind, ParsedSample[]>
  sample_stats: Partial<Record<EnergyKind, SampleStats>>
  warnings: string[]
}

export type IngestResult = { ok: true; value: ParsedIngest } | { ok: false; error: string }

export const LIMITS = {
  steps: 150_000,
  active_kcal: 8_000,
  resting_kcal: 5_000,
  workout_kcal: 5_000,
  distance_km: 500,
  duration_min: 1_440,
  workouts: 30,
  /** how far back a day / workout may be (re-sending yesterday's final totals is fine) */
  past_days: 14,
  /** energy samples per kind per request (raw samples for two days stay well below) */
  samples: 3_000,
  /** one sample / bucket: a whole day of active energy fits */
  sample_kcal: 8_000,
  /** a sample (or a Group-by-Day bucket) may span a DST day of 25 h, not more */
  sample_span_hours: 25,
}

/** Calendar-day boundaries for health data (the app is used in Israel). */
export const DAY_TZ = 'Asia/Jerusalem'

// ── lenient numbers ──────────────────────────────────────────────────────────

/** "7,842" · "1.203,4" · "512.3 kcal" · 512.3 → number; null if not a number. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  let s = v.trim().replace(/[  \s]/g, '')
  const m = s.match(/-?[\d.,]+/)
  if (!m) return null
  s = m[0]
  const hasComma = s.includes(','), hasDot = s.includes('.')
  if (hasComma && hasDot) {
    // the last separator is the decimal one
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (hasComma) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Energy in kcal; "kJ" (in the value or as the unit) is converted. Apple shows kcal as "Cal". */
export function parseEnergy(v: unknown, unit?: string | null): number | null {
  const n = parseNumber(v)
  if (n === null) return null
  const kj = /kj/i.test(String(unit ?? '')) || (typeof v === 'string' && /kj/i.test(v))
  return kj ? n / 4.184 : n
}

/** Distance in km from "5.1 km", "5100 m", "3.2 mi", 5.1 */
export function parseDistanceKm(v: unknown): number | null {
  const n = parseNumber(v)
  if (n === null) return null
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  if (/\bmi\b|mile/.test(s)) return n * 1.609344
  if (/(^|[\d\s])m\b|meter|מטר/.test(s) && !/km|ק״מ|ק"מ/.test(s)) return n / 1000
  return n
}

/** Minutes from 32, "32 min", "00:32:10", "1:05:00", "1920 s", "1.5 hr" */
export function parseDurationMin(v: unknown): number | null {
  if (typeof v === 'string' && /^\s*\d{1,2}:\d{2}(:\d{2})?\s*$/.test(v)) {
    const p = v.trim().split(':').map(Number)
    return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p[0] + p[1] / 60
  }
  const n = parseNumber(v)
  if (n === null) return null
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  if (/\bh(r|our)?s?\b|שע/.test(s)) return n * 60
  if (/\bs(ec)?(ond)?s?\b|שנ/.test(s)) return n / 60
  return n
}

/** ISO 8601 (as produced by Shortcuts' "Format Date → ISO 8601") or anything Date.parse accepts. */
export function parseInstant(v: unknown): Date | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const d = new Date(typeof v === 'number' ? v : v.trim())
  return Number.isNaN(d.getTime()) ? null : d
}

// ── dates in the user's zone ─────────────────────────────────────────────────

export function localDateKey(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
}

/** UTC instant of local midnight starting `day` in `tz` (DST-aware). */
export function zonedMidnight(day: string, tz: string): Date {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const offset = (t: number) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t
  }
  const naive = Date.parse(`${day}T00:00:00Z`)
  let t = naive - offset(naive)
  t = naive - offset(t)
  return new Date(t)
}

export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

// ── workout types (Apple Health names in English and Hebrew) ────────────────

const TYPE_RULES: [RegExp, HealthWorkoutType][] = [
  [/run|jog|ריצ/i, 'run'],
  [/walk|hik|הליכ|טיול/i, 'walk'],
  [/strength|weight|lift|crossfit|functional|core|כוח|משקול|פונקציונלי/i, 'strength'],
  [/cycl|bike|biking|spin|אופני|רכיב/i, 'cycling'],
  [/swim|שחי/i, 'swimming'],
]

export function workoutType(name: string): HealthWorkoutType {
  for (const [re, t] of TYPE_RULES) if (re.test(name)) return t
  return 'other'
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** RFC-4122-shaped id derived from a hash (stable across re-sends). */
export async function stableUuid(key: string): Promise<string> {
  const h = await sha256Hex(key)
  const v = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Source app from Apple's source name ("Strava", "Hevy", "Apple Watch של איתן" → "Apple Watch"). */
export function normalizeSource(s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null
  const t = s.trim()
  if (/strava/i.test(t)) return 'Strava'
  if (/hevy/i.test(t)) return 'Hevy'
  if (/watch|שעון/i.test(t)) return 'Apple Watch'
  if (/iphone|אייפון/i.test(t)) return 'iPhone'
  return t.slice(0, 40)
}

// ── the payload ─────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const pick = (o: Obj, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  return undefined
}

const ITEM_KEYS = ['start', 'start_date', 'startDate', 'started_at', 'type', 'name']

/**
 * Shortcuts may send a list as an array, a JSON string, a dictionary of dictionaries,
 * or — when "Add to Variable" collected a single item — one bare dictionary.
 */
function asObjList(v: unknown): Obj[] {
  if (Array.isArray(v)) return v.flatMap((x) => (typeof x === 'string' ? asObjList(x) : x && typeof x === 'object' ? [x as Obj] : []))
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return []
    try {
      return asObjList(JSON.parse(t))
    } catch {
      // "Add to Variable" of dictionaries joined as text: one JSON object per line
      const lines = t.split(/\n+/).filter((l) => l.trim().startsWith('{'))
      return lines.length > 1 ? lines.flatMap((l) => asObjList(l)) : []
    }
  }
  if (v && typeof v === 'object') {
    const o = v as Obj
    if (ITEM_KEYS.some((k) => k in o)) return [o]
    return Object.values(o).filter((x): x is Obj => !!x && typeof x === 'object')
  }
  return []
}

const SAMPLE_FIELDS: Record<EnergyKind, string[]> = {
  active: ['active_samples', 'active_energy_samples', 'activeSamples'],
  resting: ['resting_samples', 'resting_energy_samples', 'basal_samples', 'restingSamples'],
}

/**
 * Timestamped energy samples → validated, de-duplicated, each filed under the local day
 * of its start. Invalid ones are counted (for the logs), never guessed.
 */
export async function parseSamples(
  kind: EnergyKind,
  list: Obj[],
  opts: { userId: string; tz: string; now: Date; today: string; unit: string | null },
): Promise<{ samples: ParsedSample[]; stats: SampleStats }> {
  const stats: SampleStats = { received: list.length, accepted: 0, duplicates_in_request: 0, invalid_timestamp: 0, invalid_value: 0, out_of_range: 0, days: {} }
  const byKey = new Map<string, ParsedSample>()
  for (const s of list) {
    const rawStart = pick(s, 'start', 'start_date', 'startDate', 'started_at', 'from')
    let start = parseInstant(rawStart)
    const rawEnd = pick(s, 'end', 'end_date', 'endDate', 'ended_at', 'to')
    let end = rawEnd === undefined ? start : parseInstant(rawEnd)
    // a whole-day bucket sent as {date, kcal}: exactly that local day (DST-aware)
    const rawDay = rawStart === undefined ? pick(s, 'date', 'day') : undefined
    if (rawDay !== undefined) {
      const k = String(rawDay).trim().toLowerCase()
      const day = k === 'today' || k === 'היום' ? opts.today : k === 'yesterday' || k === 'אתמול' ? shiftDay(opts.today, -1) : /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null
      start = day ? zonedMidnight(day, opts.tz) : null
      end = day ? zonedMidnight(shiftDay(day, 1), opts.tz) : null
    }
    if (!start || !end || end.getTime() < start.getTime() || end.getTime() - start.getTime() > LIMITS.sample_span_hours * 3_600_000) {
      stats.invalid_timestamp++
      continue
    }
    const sampleUnit = pick(s, 'unit')
    const kcal = parseEnergy(pick(s, 'kcal', 'value', 'qty', 'quantity', 'energy', 'calories'), typeof sampleUnit === 'string' ? sampleUnit : opts.unit)
    if (kcal === null || kcal < 0 || kcal > LIMITS.sample_kcal) {
      stats.invalid_value++
      continue
    }
    const date = localDateKey(start, opts.tz)
    const ago = dayDiff(opts.today, date)
    // the start must not be in the future; the end may be (today's bucket ends at midnight)
    if (ago < 0 || ago > LIMITS.past_days || start.getTime() > opts.now.getTime() + 5 * 60_000) {
      stats.out_of_range++
      continue
    }
    const rawSource = pick(s, 'source', 'source_app', 'sourceName', 'device')
    const source = typeof rawSource === 'string' && rawSource.trim() ? rawSource.trim().slice(0, 80) : null
    const id = pick(s, 'id', 'uuid', 'sample_id')
    // second precision: Shortcuts' ISO 8601 has no milliseconds, so re-reads produce the same key
    const sec = (d: Date) => new Date(Math.floor(d.getTime() / 1000) * 1000).toISOString()
    const key = id !== undefined && String(id).trim()
      ? `id:${String(id).trim().slice(0, 100)}`
      : await sha256Hex(`${kind}|${sec(start)}|${sec(end)}|${(source ?? '').toLowerCase()}`)
    if (byKey.has(key)) {
      stats.duplicates_in_request++
      byKey.delete(key) // keep the last occurrence, in order
    }
    byKey.set(key, { key, date, start: sec(start), end: sec(end), kcal: Math.round(kcal * 100) / 100, source })
  }
  const samples = [...byKey.values()]
  stats.accepted = samples.length
  for (const x of samples) {
    const d = (stats.days[x.date] ??= { samples: 0, kcal: 0 })
    d.samples++
    d.kcal = Math.round((d.kcal + x.kcal) * 10) / 10
  }
  return { samples, stats }
}

export async function parseIngest(raw: unknown, opts: { userId: string; tz: string; now?: Date }): Promise<IngestResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'body must be a JSON object' }
  const o = raw as Obj
  const now = opts.now ?? new Date()
  const today = localDateKey(now, opts.tz)
  const warnings: string[] = []
  const unit = typeof o.energy_unit === 'string' ? o.energy_unit : null

  // day
  let date = today
  const rawDate = pick(o, 'date')
  if (rawDate !== undefined) {
    const s = String(rawDate).trim()
    const kw = s.toLowerCase()
    const d = kw === 'today' || kw === 'היום' ? today : kw === 'yesterday' || kw === 'אתמול' ? shiftDay(today, -1) : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : (() => {
      const inst = parseInstant(s)
      return inst ? localDateKey(inst, opts.tz) : null
    })()
    if (!d) return { ok: false, error: 'invalid date' }
    date = d
  }
  const ago = dayDiff(today, date)
  if (ago < 0) return { ok: false, error: 'date is in the future' }
  if (ago > LIMITS.past_days) return { ok: false, error: `date older than ${LIMITS.past_days} days` }

  // snapshot time: never in the future, never before the start of that day
  let asOf = now
  const rawAsOf = parseInstant(pick(o, 'as_of', 'asOf', 'time'))
  if (rawAsOf) {
    if (rawAsOf.getTime() > now.getTime() + 5 * 60_000) warnings.push('as_of in the future — using the receive time')
    else asOf = rawAsOf
  }
  if (localDateKey(asOf, opts.tz) < date) return { ok: false, error: 'as_of is before the day it describes' }

  const num = (key: string[], max: number, label: string, parse: (v: unknown) => number | null): number | null | 'bad' => {
    const v = pick(o, ...key)
    if (v === undefined) return null
    const n = parse(v)
    if (n === null || n < 0 || n > max) {
      warnings.push(`${label} ignored (out of range)`)
      return 'bad'
    }
    return n
  }
  const steps = num(['steps'], LIMITS.steps, 'steps', parseNumber)
  const active = num(['active_kcal', 'active', 'active_energy'], LIMITS.active_kcal, 'active_kcal', (v) => parseEnergy(v, unit))
  const resting = num(['resting_kcal', 'resting', 'resting_energy', 'basal_kcal'], LIMITS.resting_kcal, 'resting_kcal', (v) => parseEnergy(v, unit))

  // workouts
  const list = asObjList(o.workouts)
  if (list.length > LIMITS.workouts) return { ok: false, error: `at most ${LIMITS.workouts} workouts per request` }
  const workouts: ParsedWorkout[] = []
  const seen = new Set<string>()
  for (const w of list) {
    const start = parseInstant(pick(w, 'start', 'start_date', 'startDate', 'started_at'))
    if (!start) {
      warnings.push('workout without a valid start time skipped')
      continue
    }
    const end = parseInstant(pick(w, 'end', 'end_date', 'endDate', 'ended_at'))
    let duration = parseDurationMin(pick(w, 'duration_min', 'duration', 'minutes'))
    if ((duration === null || duration <= 0) && end) duration = (end.getTime() - start.getTime()) / 60_000
    if (duration !== null && (duration <= 0 || duration > LIMITS.duration_min)) duration = null
    const wDate = localDateKey(start, opts.tz)
    const wAgo = dayDiff(today, wDate)
    if (wAgo < 0 || wAgo > LIMITS.past_days || start.getTime() > now.getTime() + 5 * 60_000) {
      warnings.push('workout outside the accepted date range skipped')
      continue
    }
    const name = String(pick(w, 'type', 'name', 'activity', 'workout_type') ?? 'Workout').trim().slice(0, 60) || 'Workout'
    const type = workoutType(name)
    let distance = parseDistanceKm(pick(w, 'distance_km', 'distance'))
    if (distance !== null && (distance <= 0 || distance > LIMITS.distance_km)) distance = null
    let kcal = parseEnergy(pick(w, 'kcal', 'active_kcal', 'energy', 'calories'), unit)
    if (kcal !== null && (kcal <= 0 || kcal > LIMITS.workout_kcal)) kcal = null
    const source = normalizeSource(pick(w, 'source', 'source_app', 'app'))
    // identity: the same workout re-sent (or sent by a re-run automation) maps to the same row;
    // start to the minute absorbs sub-second differences between reads
    const key = `${opts.userId}|${type}|${start.toISOString().slice(0, 16)}|${source ?? ''}`
    const external_id = await stableUuid(key)
    if (seen.has(external_id)) continue
    seen.add(external_id)
    workouts.push({
      external_id,
      type,
      title: name,
      started_at: start.toISOString(),
      ended_at: end ? end.toISOString() : null,
      date: wDate,
      duration_min: duration === null ? null : Math.round(duration * 10) / 10,
      distance_km: distance === null ? null : Math.round(distance * 100) / 100,
      kcal: kcal === null ? null : Math.round(kcal * 10) / 10,
      source_app: source,
    })
  }

  // timestamped energy samples (each filed under its own day)
  const samples: Record<EnergyKind, ParsedSample[]> = { active: [], resting: [] }
  const sample_stats: Partial<Record<EnergyKind, SampleStats>> = {}
  for (const kind of ['active', 'resting'] as const) {
    const field = SAMPLE_FIELDS[kind].find((k) => o[k] !== undefined && o[k] !== null && o[k] !== '')
    if (!field) continue
    const items = asObjList(o[field])
    if (items.length > LIMITS.samples) return { ok: false, error: `at most ${LIMITS.samples} ${kind} samples per request` }
    const r = await parseSamples(kind, items, { userId: opts.userId, tz: opts.tz, now, today, unit })
    samples[kind] = r.samples
    sample_stats[kind] = r.stats
    const st = r.stats
    if (!st.received) warnings.push(`${field} is empty or not a list of samples`)
    if (st.invalid_timestamp) warnings.push(`${kind} samples: ${st.invalid_timestamp} skipped (missing/invalid start or end)`)
    if (st.invalid_value) warnings.push(`${kind} samples: ${st.invalid_value} skipped (missing/invalid energy value)`)
    if (st.out_of_range) warnings.push(`${kind} samples: ${st.out_of_range} skipped (future or older than ${LIMITS.past_days} days)`)
    if (st.duplicates_in_request) warnings.push(`${kind} samples: ${st.duplicates_in_request} duplicates in the request ignored`)
  }

  const val = (x: number | null | 'bad') => (x === 'bad' ? null : x)
  const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)
  const value: ParsedIngest = {
    date,
    steps: val(steps) === null ? null : Math.round(val(steps)!),
    active_kcal: r1(val(active)),
    resting_kcal: r1(val(resting)),
    as_of: asOf.toISOString(),
    workouts,
    samples,
    sample_stats,
    warnings,
  }
  if (value.steps === null && value.active_kcal === null && value.resting_kcal === null && !workouts.length && !samples.active.length && !samples.resting.length) {
    const sent = Object.values(sample_stats).reduce((n, st) => n + (st?.received ?? 0), 0)
    return { ok: false, error: sent ? `nothing to import: none of the ${sent} samples were valid (${warnings.join('; ')})` : 'nothing to import (send steps, active_kcal, resting_kcal, workouts or *_samples)' }
  }
  return { ok: true, value }
}
