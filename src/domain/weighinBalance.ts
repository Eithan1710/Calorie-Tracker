import type { DaySummary } from './day'

/**
 * Energy balance between two weigh-ins, from the same daily numbers the app shows.
 *
 * Window: weigh-ins are assumed to be taken in the morning, so the energy that can show up
 * on the later scale reading is what happened from the earlier weigh-in's day up to the day
 * BEFORE the later one: [from, to − 1]. (A 7-day gap = 7 full days.)
 *
 * The prediction converts the cumulative balance with ~7,700 kcal per kg of body fat — a
 * rough figure for fat tissue only. Short-term scale weight also moves with water, glycogen
 * and gut contents, so the comparison is a sanity check, never a correction.
 */
export const KCAL_PER_KG_FAT = 7700

export interface WeighinBalance {
  from: string
  /** last day counted (the day before the later weigh-in) */
  through: string
  days: number
  /** days with logged food and a burn figure */
  counted: number
  /** days in the window with no food logged — the balance can't be trusted then */
  missingFood: string[]
  /** days whose burn is the estimate model (no Apple Health energy) */
  estimatedBurn: string[]
  /** Σ (burned − eaten) over the counted days, kcal; positive = deficit */
  deficit: number
  /** what that deficit means as body fat, kg (negative = loss) */
  predictedKg: number
  /** the scale change between the two weigh-ins, kg */
  measuredKg: number
}

export function balanceBetweenWeighins(opts: {
  previous: { date: string; kg: number }
  latest: { date: string; kg: number }
  /** one summary per day in [previous.date, latest.date − 1] */
  days: DaySummary[]
}): WeighinBalance | null {
  const { previous, latest } = opts
  if (latest.date <= previous.date) return null
  const window = opts.days.filter((d) => d.date >= previous.date && d.date < latest.date).sort((a, b) => a.date.localeCompare(b.date))
  if (!window.length) return null
  const counted = window.filter((d) => d.hasFood && d.energy)
  const deficit = Math.round(counted.reduce((s, d) => s + (d.burned - d.eaten), 0))
  return {
    from: previous.date,
    through: window.at(-1)!.date,
    days: window.length,
    counted: counted.length,
    missingFood: window.filter((d) => !d.hasFood).map((d) => d.date),
    estimatedBurn: counted.filter((d) => d.energy?.mode === 'estimate').map((d) => d.date),
    deficit,
    predictedKg: Math.round((-deficit / KCAL_PER_KG_FAT) * 100) / 100,
    measuredKg: Math.round((latest.kg - previous.kg) * 100) / 100,
  }
}

/**
 * Does the scale agree with the calorie numbers? A single weigh-in can be off by ~0.5 kg of water,
 * glycogen and gut contents, so a gap up to that is "matches". Beyond it, the gap is turned back
 * into kcal per day — how far off the daily numbers would have to be to explain the scale.
 */
export const SCALE_NOISE_KG = 0.5

export type BalanceVerdict =
  | { kind: 'match'; gapKg: number }
  /** the scale went down less (or up more) than the balance predicts: burn overestimated or food under-logged */
  | { kind: 'heavier'; gapKg: number; kcalPerDay: number }
  /** the scale went down more than predicted: burn underestimated, or water */
  | { kind: 'lighter'; gapKg: number; kcalPerDay: number }

export function balanceVerdict(r: Pick<WeighinBalance, 'predictedKg' | 'measuredKg' | 'days'>): BalanceVerdict {
  const gapKg = Math.round((r.measuredKg - r.predictedKg) * 100) / 100
  if (Math.abs(gapKg) <= SCALE_NOISE_KG) return { kind: 'match', gapKg }
  // only the part beyond the scale's noise is something the numbers have to explain
  const beyond = Math.abs(gapKg) - SCALE_NOISE_KG
  const kcalPerDay = Math.round((beyond * KCAL_PER_KG_FAT) / Math.max(1, r.days) / 10) * 10
  return gapKg > 0 ? { kind: 'heavier', gapKg, kcalPerDay } : { kind: 'lighter', gapKg, kcalPerDay }
}
