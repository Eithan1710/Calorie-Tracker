/**
 * Daily goal: a moderate deficit of 100–300 kcal (burned − eaten).
 *
 *   deficit 100…300  → 'success'   (היעד הושג)
 *   deficit   0…99   → 'almost'    (כמעט — חסרות X קלוריות)
 *   deficit   < 0    → 'surplus'   (עודף קלורי)
 *   deficit   > 300  → 'over'      (הגירעון גדול מהיעד)
 *
 * While the day is still running, "burned" is a full-day projection, so a
 * large deficit at 14:00 simply means there's room to eat — we say that
 * ('room') instead of warning about over-restriction. Only a finished day
 * (or late evening) with a >300 deficit is reported as 'over'.
 */

export const TARGET_MIN = 100
export const TARGET_MAX = 300

/** A personal daily target, as a band of deficit (burned − eaten) in kcal. */
export interface DeficitTarget {
  min: number
  max: number
}

export const DEFAULT_TARGET: DeficitTarget = { min: TARGET_MIN, max: TARGET_MAX }

/** The few targets offered in settings — none of them aggressive. */
export const TARGET_PRESETS: { id: string; label: string; hint: string; target: DeficitTarget }[] = [
  { id: 'recomp', label: 'ריקומפ', hint: 'גירעון מתון 100–300', target: { min: 100, max: 300 } },
  { id: 'cut', label: 'ירידה במשקל', hint: 'גירעון 300–500', target: { min: 300, max: 500 } },
  { id: 'maintain', label: 'שמירה', hint: 'מאזן אפס, ±100', target: { min: -100, max: 100 } },
  { id: 'gain', label: 'עלייה', hint: 'עודף 200–400', target: { min: -400, max: -200 } },
]

export function isValidTarget(t: Partial<DeficitTarget> | null | undefined): t is DeficitTarget {
  return !!t && Number.isFinite(t.min) && Number.isFinite(t.max) && t.max! > t.min! && t.min! >= -500 && t.max! <= 1000
}

export type GoalStatus = 'empty' | 'success' | 'almost' | 'surplus' | 'over' | 'room'

export interface GoalResult {
  status: GoalStatus
  deficit: number
  /** primary line, Hebrew */
  title: string
  /** secondary line, Hebrew (may be empty) */
  detail: string
  /** for 'room': the kcal range still available to stay in target */
  roomMin?: number
  roomMax?: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('he-IL')
/** numeric range isolated as LTR so it reads "1,700–1,900" inside Hebrew text */
export const range = (a: number, b: number) => `\u2066${fmt(a)}–${fmt(b)}\u2069`

/** Evening cut-off after which an unfinished day is judged as final. */
export const EVENING_HOUR = 20

export function evaluateGoal(opts: {
  eaten: number
  burned: number
  hasFood: boolean
  /** true if the day is over (past day) or it's late evening */
  dayFinal: boolean
  /** personal target band; defaults to the original 100–300 kcal deficit */
  target?: DeficitTarget
}): GoalResult {
  const deficit = Math.round(opts.burned - opts.eaten)
  const { min: TMIN, max: TMAX } = isValidTarget(opts.target) ? opts.target : DEFAULT_TARGET

  if (!opts.hasFood) {
    return {
      status: 'empty',
      deficit,
      title: 'עוד לא נרשם אוכל היום',
      detail: `אפשר לאכול כ-${range(opts.burned - TMAX, opts.burned - TMIN)} קק״ל היום`,
      roomMin: Math.max(0, opts.burned - TMAX),
      roomMax: Math.max(0, opts.burned - TMIN),
    }
  }

  if (deficit >= TMIN && deficit <= TMAX) {
    return { status: 'success', deficit, title: 'היעד הושג', detail: TMIN >= 0 ? 'גירעון מתון ובריא — בדיוק בטווח' : 'בדיוק בטווח היעד שלך' }
  }

  if (deficit >= 0 && deficit < TMIN) {
    const missing = TMIN - deficit
    return { status: 'almost', deficit, title: 'כמעט שם', detail: `חסרות עוד ${fmt(missing)} קלוריות ליעד` }
  }

  if (deficit < TMIN) {
    return {
      status: 'surplus',
      deficit,
      title: deficit < 0 ? 'עודף קלורי קטן היום' : 'מעט מעל היעד',
      detail: deficit < 0 ? `${fmt(-deficit)} קק״ל מעל השריפה · מחר מאזנים` : `${fmt(TMIN - deficit)} קק״ל מעל הטווח · מחר מאזנים`,
    }
  }

  // deficit > TMAX
  if (!opts.dayFinal) {
    const roomMin = deficit - TMAX
    const roomMax = deficit - TMIN
    return {
      status: 'room',
      deficit,
      title: `אפשר לאכול עוד ${range(roomMin, roomMax)}`,
      detail: 'קק״ל כדי להישאר בטווח היעד',
      roomMin,
      roomMax,
    }
  }
  return {
    status: 'over',
    deficit,
    title: 'הגירעון גדול מהיעד',
    detail: TMIN >= 100 ? 'לריקומפ עדיף גירעון מתון — אפשר לאכול עוד קצת' : 'אפשר לאכול עוד קצת כדי להגיע ליעד',
  }
}

export function isDayFinal(dateKey: string, now: Date = new Date()): boolean {
  const today = toDateKey(now)
  if (dateKey < today) return true
  if (dateKey > today) return false
  return now.getHours() >= EVENING_HOUR
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}

export function addDays(key: string, delta: number): string {
  const d = fromDateKey(key)
  d.setDate(d.getDate() + delta)
  return toDateKey(d)
}
