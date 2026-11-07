import { dayNum } from './weight'
import { creatineWaterKg, type Creatine } from './creatine'
import { KCAL_PER_KG_FAT } from './weighinBalance'

/**
 * Trend weight and an expenditure estimate measured from it.
 *
 * Trend: an exponentially smoothed average of the weigh-ins, the method of Hacker's Diet / Happy
 * Scale / MacroFactor — each day the trend moves 10% of the way towards the scale (α = 0.1/day; a
 * gap of d days moves it 1 − 0.9^d of the way). It ignores day-to-day water swings (±0.5–1 kg)
 * and follows the real change with a lag of about a week.
 *
 * Measured expenditure: over a window of logged days,
 *     expenditure ≈ average intake − Δ(trend − creatine water) × 7,700 kcal/kg ÷ days
 * — the same idea as MacroFactor's adaptive expenditure: what the body must have burned for the
 * weight to move the way it did, given what was eaten. It needs ≥ 14 days with food logged on
 * every day; its error is mostly the trend's (≈ ±0.25 kg over the window), shown as a ± range.
 */
export const TREND_ALPHA = 0.1

export interface TrendPoint {
  date: string
  kg: number
  trend: number
}

/** Trend for each weigh-in (input in any order; output by date). */
export function trendWeights(points: { date: string; kg: number }[]): TrendPoint[] {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : 1))
  const out: TrendPoint[] = []
  let t: number | null = null
  let prev: string | null = null
  for (const p of sorted) {
    if (t === null || prev === null) t = p.kg
    else {
      const a = 1 - Math.pow(1 - TREND_ALPHA, Math.max(1, dayNum(p.date) - dayNum(prev)))
      t = t + a * (p.kg - t)
    }
    prev = p.date
    out.push({ date: p.date, kg: p.kg, trend: Math.round(t * 100) / 100 })
  }
  return out
}

/** The trend on any day: carried forward from the last weigh-in on or before it (null before the first). */
export function trendOn(trend: TrendPoint[], date: string): number | null {
  let v: number | null = null
  for (const p of trend) {
    if (p.date > date) break
    v = p.trend
  }
  return v
}

/** Trend change per week over the last `days` days (needs a weigh-in at least `days` before the last). */
export function weeklyRate(trend: TrendPoint[], days = 14): number | null {
  const last = trend.at(-1)
  if (!last || trend.length < 3) return null
  const start = trendOn(trend, shift(last.date, -days))
  if (start === null) return null
  return Math.round(((last.trend - start) / days) * 7 * 100) / 100
}

export const MIN_EXPENDITURE_DAYS = 14
/** trend uncertainty over the window (kg), for the ± of the measured expenditure */
export const TREND_ERROR_KG = 0.25

export interface MeasuredExpenditure {
  from: string
  /** last day counted (the day before the end weigh-in's trend) */
  through: string
  days: number
  avgIntake: number
  /** trend change minus creatine water, kg (negative = lost) */
  tissueKg: number
  /** creatine water gained over the window, kg (already removed from tissueKg) */
  waterKg: number
  /** kcal/day the body must have used */
  expenditure: number
  /** ± kcal/day from the trend's own error */
  plusMinus: number
  /** the app's own average burn over the same days, for comparison */
  appBurn: number
}

/**
 * Expenditure measured from intake and the trend over the last `windowDays` logged days ending
 * the day before the latest weigh-in. Null when there isn't enough data (fewer than 14 consecutive
 * logged days, or no trend at the window's start).
 */
export function measuredExpenditure(opts: {
  trend: TrendPoint[]
  /** the days before the latest weigh-in, newest last: eaten / burned / hasFood */
  days: { date: string; eaten: number; burned: number; hasFood: boolean }[]
  creatine?: Creatine | null
  windowDays?: number
}): MeasuredExpenditure | null {
  const last = opts.trend.at(-1)
  if (!last) return null
  const want = opts.windowDays ?? 21
  // the logged days right before the latest weigh-in (stop at the first day without food)
  const before = opts.days.filter((d) => d.date < last.date).sort((a, b) => (a.date < b.date ? -1 : 1))
  const run: typeof before = []
  for (let i = before.length - 1; i >= 0 && run.length < want; i--) {
    const d = before[i]
    const expected = shift(last.date, -(run.length + 1))
    if (d.date !== expected || !d.hasFood) break
    run.unshift(d)
  }
  if (run.length < MIN_EXPENDITURE_DAYS) return null
  const from = run[0].date
  const startTrend = trendOn(opts.trend, from)
  if (startTrend === null) return null
  const n = run.length
  const water = creatineWaterKg(opts.creatine, last.date, last.trend) - creatineWaterKg(opts.creatine, from, startTrend)
  const tissueKg = last.trend - startTrend - water
  const avgIntake = run.reduce((s, d) => s + d.eaten, 0) / n
  const expenditure = avgIntake - (tissueKg * KCAL_PER_KG_FAT) / n
  return {
    from,
    through: run[n - 1].date,
    days: n,
    avgIntake: Math.round(avgIntake),
    tissueKg: Math.round(tissueKg * 100) / 100,
    waterKg: Math.round(water * 100) / 100,
    expenditure: Math.round(expenditure / 10) * 10,
    plusMinus: Math.round((TREND_ERROR_KG * KCAL_PER_KG_FAT) / n / 10) * 10,
    appBurn: Math.round(run.reduce((s, d) => s + d.burned, 0) / n),
  }
}

function shift(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
