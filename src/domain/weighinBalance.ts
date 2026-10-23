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
    measuredKg: Math.round((latest.kg - previous.kg) * 10) / 10,
  }
}
