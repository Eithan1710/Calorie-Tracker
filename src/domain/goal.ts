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

/** Fitness phase. In automatic mode it decides the deficit band; in custom mode it is kept as a label. */
export type GoalPhase = 'recomp' | 'cut' | 'maintain' | 'gain'

/** The few targets offered in settings — none of them aggressive. */
export const TARGET_PRESETS: { id: GoalPhase; label: string; hint: string; target: DeficitTarget }[] = [
  { id: 'recomp', label: 'ריקומפ', hint: 'גירעון מתון 100–300', target: { min: 100, max: 300 } },
  { id: 'cut', label: 'ירידה במשקל', hint: 'גירעון 300–500', target: { min: 300, max: 500 } },
  { id: 'maintain', label: 'שמירה', hint: 'מאזן אפס, ±100', target: { min: -100, max: 100 } },
  { id: 'gain', label: 'עלייה נקייה', hint: 'עודף 200–400', target: { min: -400, max: -200 } },
]

/**
 * How the daily calorie target is set:
 *  - 'auto'   — the phase's deficit band applied to the day's burn (burned − band), as before;
 *  - 'custom' — a fixed intake range the user chose (e.g. 1,900–2,100 kcal), any phase.
 * Switching modes or phases never erases the saved custom range.
 */
export type CalorieMode = 'auto' | 'custom'

/** A daily intake range in kcal. */
export interface KcalRange {
  min: number
  max: number
}

export const KCAL_LIMITS = { min: 500, max: 8000 }

/** Hebrew error for a custom range, or null when it is valid. */
export function kcalRangeError(min: number | '' | null | undefined, max: number | '' | null | undefined): string | null {
  if (min === '' || max === '' || min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return 'צריך מינימום ומקסימום'
  if (min <= 0 || max <= 0) return 'הערכים צריכים להיות חיוביים'
  if (min < KCAL_LIMITS.min || max > KCAL_LIMITS.max) return `טווח אפשרי: \u2066${KCAL_LIMITS.min}–${KCAL_LIMITS.max.toLocaleString('he-IL')}\u2069 קק״ל`
  if (min >= max) return 'המינימום צריך להיות נמוך מהמקסימום'
  return null
}

export function isValidKcalRange(r: Partial<KcalRange> | null | undefined): r is KcalRange {
  return !!r && kcalRangeError(r.min, r.max) === null
}

/** The phase a user is in: the stored one, or (older settings) the preset matching their band. */
export function phaseOf(s: { goalPhase?: GoalPhase; deficitTarget?: DeficitTarget }): GoalPhase {
  if (s.goalPhase && TARGET_PRESETS.some((t) => t.id === s.goalPhase)) return s.goalPhase
  const t = s.deficitTarget
  return TARGET_PRESETS.find((p) => t && p.target.min === t.min && p.target.max === t.max)?.id ?? 'recomp'
}

/** What a day is judged against. */
export type DayTarget = ({ kind: 'deficit' } & DeficitTarget) | ({ kind: 'intake' } & KcalRange)

/** The target in force for the given settings (custom only when its range is valid). */
export function dayTarget(s: { calorieMode?: CalorieMode; customKcal?: KcalRange; deficitTarget?: DeficitTarget }): DayTarget {
  if (s.calorieMode === 'custom' && isValidKcalRange(s.customKcal)) return { kind: 'intake', min: s.customKcal.min, max: s.customKcal.max }
  const d = isValidTarget(s.deficitTarget) ? s.deficitTarget : DEFAULT_TARGET
  return { kind: 'deficit', min: d.min, max: d.max }
}

/** The day's intake range in kcal: fixed in custom mode, burned − band in automatic mode (null without a burn). */
export function intakeRangeFor(target: DayTarget, burned: number | null | undefined): KcalRange | null {
  if (target.kind === 'intake') return { min: target.min, max: target.max }
  if (!burned || burned <= 0) return null
  return { min: Math.max(0, Math.round(burned - target.max)), max: Math.max(0, Math.round(burned - target.min)) }
}

export function isValidTarget(t: Partial<DeficitTarget> | null | undefined): t is DeficitTarget {
  return !!t && Number.isFinite(t.min) && Number.isFinite(t.max) && t.max! > t.min! && t.min! >= -500 && t.max! <= 1000
}

export type GoalStatus = 'empty' | 'success' | 'almost' | 'surplus' | 'over' | 'room' | 'below' | 'above'

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

/**
 * Custom intake range: the whole range is the target (not its midpoint).
 *   eaten < min → 'room' while the day runs ("אפשר לאכול עוד …"), 'below' once it is over
 *   min ≤ eaten ≤ max → 'success'
 *   eaten > max → 'above'
 */
export function evaluateIntake(opts: { eaten: number; burned?: number | null; hasFood: boolean; dayFinal: boolean; range: KcalRange }): GoalResult {
  const eaten = Math.round(opts.eaten)
  const { min, max } = opts.range
  const deficit = Math.round((opts.burned ?? 0) - eaten)
  const target = `${range(min, max)} קק״ל`
  if (!opts.hasFood) {
    return { status: 'empty', deficit, title: 'עוד לא נרשם אוכל היום', detail: `יעד יומי: ${target}`, roomMin: min, roomMax: max }
  }
  if (eaten > max) {
    return { status: 'above', deficit, title: 'מעל טווח היעד', detail: `${fmt(eaten - max)} קק״ל מעל ${target}` }
  }
  if (eaten >= min) {
    const left = max - eaten
    return { status: 'success', deficit, title: 'בטווח היעד', detail: left > 0 ? `${target} · אפשר עוד עד ${fmt(left)}` : target }
  }
  if (!opts.dayFinal) {
    return { status: 'room', deficit, title: `אפשר לאכול עוד ${range(min - eaten, max - eaten)}`, detail: `קק״ל כדי להגיע ל-${target}`, roomMin: min - eaten, roomMax: max - eaten }
  }
  return { status: 'below', deficit, title: 'מתחת לטווח היעד', detail: `חסרו ${fmt(min - eaten)} קק״ל ל-${target}` }
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
