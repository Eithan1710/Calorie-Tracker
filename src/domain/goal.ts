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
}): GoalResult {
  const deficit = Math.round(opts.burned - opts.eaten)

  if (!opts.hasFood) {
    return {
      status: 'empty',
      deficit,
      title: 'עוד לא נרשם אוכל היום',
      detail: `אפשר לאכול כ-${range(opts.burned - TARGET_MAX, opts.burned - TARGET_MIN)} קק״ל היום`,
      roomMin: Math.max(0, opts.burned - TARGET_MAX),
      roomMax: Math.max(0, opts.burned - TARGET_MIN),
    }
  }

  if (deficit >= TARGET_MIN && deficit <= TARGET_MAX) {
    return { status: 'success', deficit, title: 'היעד הושג', detail: 'גירעון מתון ובריא — בדיוק בטווח' }
  }

  if (deficit >= 0 && deficit < TARGET_MIN) {
    const missing = TARGET_MIN - deficit
    return { status: 'almost', deficit, title: 'כמעט שם', detail: `חסרות עוד ${fmt(missing)} קלוריות ליעד` }
  }

  if (deficit < 0) {
    return {
      status: 'surplus',
      deficit,
      title: 'עודף קלורי קטן היום',
      detail: `${fmt(-deficit)} קק״ל מעל השריפה · מחר מאזנים`,
    }
  }

  // deficit > TARGET_MAX
  if (!opts.dayFinal) {
    const roomMin = deficit - TARGET_MAX
    const roomMax = deficit - TARGET_MIN
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
    detail: 'לריקומפ עדיף גירעון מתון — אפשר לאכול עוד קצת',
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
