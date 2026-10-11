/**
 * Apple Health → מאזן ingest payload (sent by an iOS Shortcuts automation).
 * Pure, runtime-agnostic parsing + validation, shared by the edge function and tests.
 *
 *   {
 *     "steps": 7842,                                  // any subset of the fields below
 *     "active_kcal": 512.3,                           // Apple "Active Energy", sum for the day
 *     "resting_kcal": 1203.4,                         // Apple "Resting Energy", sum for the day
 *     "date": "2026-10-11",                           // optional; default = today in the user's time zone
 *     "as_of": "2026-10-11T21:15:00+03:00",           // optional; when the totals were read
 *     "energy_unit": "kcal",                          // optional; "kJ" is converted
 *     "workouts": [{ "type": "Running", "start": "…", "end": "…", "duration_min": 32,
 *                    "distance_km": 5.1, "kcal": 340, "source": "Strava" }]
 *   }
 *
 * Shortcuts sends numbers in many shapes ("7,842", "512.3 kcal", "5.1 km", "00:32:10"),
 * so every numeric field is parsed leniently, then range-checked.
 * Daily totals are idempotent snapshots: a newer snapshot replaces an older one, so
 * re-running the automation never adds anything twice.
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

export interface ParsedIngest {
  date: string
  steps: number | null
  active_kcal: number | null
  resting_kcal: number | null
  as_of: string
  workouts: ParsedWorkout[]
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
}

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

/** Shortcuts may send the list as an array, a JSON string, or a dictionary of dictionaries. */
function asWorkoutList(v: unknown): Obj[] {
  if (Array.isArray(v)) return v.filter((x): x is Obj => !!x && typeof x === 'object')
  if (typeof v === 'string') {
    try {
      return asWorkoutList(JSON.parse(v))
    } catch {
      return []
    }
  }
  if (v && typeof v === 'object') return Object.values(v as Obj).filter((x): x is Obj => !!x && typeof x === 'object')
  return []
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
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : (() => {
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
  const list = asWorkoutList(o.workouts)
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

  const val = (x: number | null | 'bad') => (x === 'bad' ? null : x)
  const r1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10)
  const value: ParsedIngest = {
    date,
    steps: val(steps) === null ? null : Math.round(val(steps)!),
    active_kcal: r1(val(active)),
    resting_kcal: r1(val(resting)),
    as_of: asOf.toISOString(),
    workouts,
    warnings,
  }
  if (value.steps === null && value.active_kcal === null && value.resting_kcal === null && !workouts.length) {
    return { ok: false, error: 'nothing to import (send steps, active_kcal, resting_kcal or workouts)' }
  }
  return { ok: true, value }
}
