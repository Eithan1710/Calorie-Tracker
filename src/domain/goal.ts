/**
 * Daily goal: a moderate deficit of 100–300 kcal (burned − eaten).
 *
 *   deficit 100…300  → 'success'   (היעד הושג)
 *   deficit   0…99   → 'almost'    (day over: the deficit came out X short of the band)
 *                       'over_budget' while the day is still going on: already ate X past today's budget
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
 * How the daily target band is set:
 *  - 'auto'   — the phase's band (recomp 100–300 deficit, cut 300–500, …), as before;
 *  - 'custom' — the user's own band of deficit or surplus, e.g. a deficit of 200–300 kcal.
 * Either way the band is applied to the day's burn, and the whole band counts as the target.
 * Phase and custom band are stored separately: changing one never overwrites the other.
 */
export type CalorieMode = 'auto' | 'custom'
export type BandDirection = 'deficit' | 'surplus'

/** A daily intake range in kcal (the band applied to the day's burn). */
export interface KcalRange {
  min: number
  max: number
}

/** Largest custom band: same bounds the database keeps for the deficit columns (−500…1000). */
export const CUSTOM_LIMITS: Record<BandDirection, number> = { deficit: 1000, surplus: 500 }

/** Hebrew error for a custom band typed as "from–to" kcal of deficit or surplus, or null when valid. */
export function customBandError(dir: BandDirection, from: number | '' | null | undefined, to: number | '' | null | undefined): string | null {
  if (from === '' || to === '' || from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return 'צריך ערך "מ-" וערך "עד"'
  if (from < 0 || to <= 0) return 'הערכים צריכים להיות חיוביים'
  if (from >= to) return 'הערך הראשון צריך להיות נמוך מהשני'
  if (to > CUSTOM_LIMITS[dir]) return `${dir === 'deficit' ? 'גירעון' : 'עודף'} של עד \u2066${CUSTOM_LIMITS[dir].toLocaleString('he-IL')}\u2069 קק״ל`
  return null
}

/** "deficit 200–300" → band {min: 200, max: 300}; "surplus 200–400" → {min: −400, max: −200}. */
export function bandFrom(dir: BandDirection, from: number, to: number): DeficitTarget {
  return dir === 'deficit' ? { min: from, max: to } : { min: -to, max: -from }
}

/** A band as the user types it. Bands that cross zero read as a deficit range from 0. */
export function bandParts(b: DeficitTarget): { dir: BandDirection; from: number; to: number } {
  if (b.max <= 0) return { dir: 'surplus', from: -b.max, to: -b.min }
  return { dir: 'deficit', from: Math.max(0, b.min), to: b.max }
}

/** "גירעון 200–300" / "עודף 200–400" / "מאזן −100…+100" */
export function bandLabel(b: DeficitTarget): string {
  if (b.min >= 0) return `גירעון \u2066${b.min}–${b.max}\u2069`
  if (b.max <= 0) return `עודף \u2066${-b.max}–${-b.min}\u2069`
  return `מאזן \u2066${-b.max >= 0 ? '+' : ''}${b.min}…+${b.max}\u2069`
}

/** The phase a user is in: the stored one, or (older settings) the preset matching their band. */
export function phaseOf(s: { goalPhase?: GoalPhase; deficitTarget?: DeficitTarget }): GoalPhase {
  if (s.goalPhase && TARGET_PRESETS.some((t) => t.id === s.goalPhase)) return s.goalPhase
  const t = s.deficitTarget
  return TARGET_PRESETS.find((p) => t && p.target.min === t.min && p.target.max === t.max)?.id ?? 'recomp'
}

/** The band in force: the custom one in custom mode (when valid), else the phase's. */
export function dayTarget(s: { calorieMode?: CalorieMode; customDeficit?: DeficitTarget; deficitTarget?: DeficitTarget }): DeficitTarget {
  if (s.calorieMode === 'custom' && isValidTarget(s.customDeficit)) return s.customDeficit
  return isValidTarget(s.deficitTarget) ? s.deficitTarget : DEFAULT_TARGET
}

/** What the band means in calories eaten today: burned − band (null without a burn estimate). */
export function intakeRangeFor(band: DeficitTarget, burned: number | null | undefined): KcalRange | null {
  if (!burned || burned <= 0) return null
  return { min: Math.max(0, Math.round(burned - band.max)), max: Math.max(0, Math.round(burned - band.min)) }
}

export function isValidTarget(t: Partial<DeficitTarget> | null | undefined): t is DeficitTarget {
  return !!t && Number.isFinite(t.min) && Number.isFinite(t.max) && t.max! > t.min! && t.min! >= -500 && t.max! <= 1000
}

export type GoalStatus = 'empty' | 'success' | 'almost' | 'over_budget' | 'surplus' | 'over' | 'room'

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

  // a surplus band (lean bulk, or a custom surplus): eating more than planned is "over the band",
  // eating less is "short of it" — never a "big deficit" or a "small surplus"
  if (TMAX <= 0) {
    if (deficit < TMIN) {
      return { status: 'surplus', deficit, title: 'יותר מהעודף שתכננת', detail: `${fmt(TMIN - deficit)} קק״ל מעל הטווח · מחר מאזנים` }
    }
    if (opts.dayFinal) {
      return { status: 'almost', deficit, title: 'כמעט שם', detail: `העודף יצא קטן ב-${fmt(deficit - TMAX)} קק״ל מהיעד` }
    }
  }

  if (deficit >= 0 && deficit < TMIN) {
    const missing = TMIN - deficit
    // Mid-day this means the food so far is already past the day's budget (burned − band): "172
    // calories missing" would read as "eat 172 more" — the opposite. Say what happened instead.
    if (!opts.dayFinal) {
      return {
        status: 'over_budget',
        deficit,
        title: 'מעל התקציב להיום',
        detail: `${fmt(missing)} קק״ל מעבר לתקציב של גירעון ${range(TMIN, TMAX)} · תנועה עד סוף היום תקטין את הפער`,
      }
    }
    return { status: 'almost', deficit, title: 'כמעט שם', detail: `הגירעון יצא קטן ב-${fmt(missing)} קק״ל מהיעד` }
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
    detail: TMIN >= 100 ? 'גירעון גדול מהטווח שבחרת — אפשר לאכול עוד קצת' : 'אפשר לאכול עוד קצת כדי להגיע ליעד',
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
