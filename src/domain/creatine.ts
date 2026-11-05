import { dayNum } from './weight'

/**
 * Creatine and the scale. Creatine monohydrate draws water into the muscles: body weight goes up
 * by ~1–2% of body mass in the weeks after starting (a meta-analysis of supplementation studies:
 * ~0.6–1 kg on average; most with a loading phase), then stays there while it is taken. It is
 * water, not fat — so over those weeks the scale rises while the calorie balance doesn't move.
 *   • 3–5 g a day (no loading): muscle creatine is saturated in ~4 weeks (Hultman et al. 1996:
 *     3 g/day ≈ 28 days) → modelled as 1 − e^(−t/9 d) (95% by day 28).
 *   • loading (~20 g a day for 5–7 days): saturated within a week → 1 − e^(−t/2 d).
 *   • after stopping, the extra water leaves over ~4 weeks (same curve, downwards).
 * Size: 1.3% of body weight (≈ 0.8 kg at 60 kg), ±50% — people differ a lot (some gain nothing).
 */
export interface Creatine {
  /** first day taken, "YYYY-MM-DD" */
  start: string
  /** started with a loading phase (~20 g/day) */
  loading?: boolean
  /** last day taken, when stopped */
  stop?: string
}

export const CREATINE_WATER_FRACTION = 0.013
export const CREATINE_WATER_UNCERTAINTY = 0.5
const TAU_DAYS = { maintenance: 9, loading: 2, washout: 9 }

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
export const isValidCreatine = (c: unknown): c is Creatine =>
  !!c &&
  typeof c === 'object' &&
  isDate((c as Creatine).start) &&
  ((c as Creatine).loading === undefined || typeof (c as Creatine).loading === 'boolean') &&
  ((c as Creatine).stop === undefined || (isDate((c as Creatine).stop) && (c as Creatine).stop! >= (c as Creatine).start))

/** The full extra water once saturated, kg. */
export const creatineFullKg = (bodyKg: number) => Math.round(bodyKg * CREATINE_WATER_FRACTION * 100) / 100

/** Extra water from creatine on `date` (morning weigh-in), kg — 0 before the start. */
export function creatineWaterKg(c: Creatine | null | undefined, date: string, bodyKg: number): number {
  if (!isValidCreatine(c) || date <= c.start) return 0
  const full = bodyKg * CREATINE_WATER_FRACTION
  const tau = c.loading ? TAU_DAYS.loading : TAU_DAYS.maintenance
  const on = (days: number) => full * (1 - Math.exp(-days / tau))
  const t = dayNum(date) - dayNum(c.start)
  if (!c.stop || date <= c.stop) return on(t)
  const atStop = on(dayNum(c.stop) - dayNum(c.start) + 1)
  return atStop * Math.exp(-(dayNum(date) - dayNum(c.stop) - 1) / TAU_DAYS.washout)
}

/** Share of the full effect reached on `date` (0–1), for "about 80% of the way there". */
export function creatineProgress(c: Creatine | null | undefined, date: string): number {
  return creatineWaterKg(c, date, 100) / (100 * CREATINE_WATER_FRACTION)
}
