import { dayNum } from './weight'

/**
 * Creatine and the scale. Creatine monohydrate draws water into the muscles: body weight goes up
 * by ~1–2% of body mass in the weeks after starting (a meta-analysis of supplementation studies:
 * ~0.6–1 kg on average; most with a loading phase), then stays there while it is taken. It is
 * water, not fat — so over those weeks the scale rises while the calorie balance doesn't move.
 *   • 3–5 g a day (no loading): muscle creatine is saturated in ~4 weeks (Hultman et al. 1996:
 *     3 g/day ≈ 28 days) → modelled as 1 − e^(−t/9 d) (95% by day 28).
 *   • loading (~20 g a day for 5–7 days): saturated within a week → 1 − e^(−t/2 d).
 *   • after stopping, the extra water leaves over ~4 weeks (same curve, downwards); breaks in between
 *     drain it part-way, and taking it again refills from there.
 * Size: 1.3% of body weight (≈ 0.8 kg at 60 kg), ±50% — people differ a lot (some gain nothing).
 */
export interface CreatineBreak {
  /** first day not taken, "YYYY-MM-DD" */
  from: string
  /** last day not taken */
  to: string
}

export interface Creatine {
  /** first day taken, "YYYY-MM-DD" */
  start: string
  /** started with a loading phase (~20 g/day) */
  loading?: boolean
  /** pauses between start and now (stopped, then took it again) — oldest first */
  breaks?: CreatineBreak[]
  /** last day taken, when stopped */
  stop?: string
}

export const CREATINE_WATER_FRACTION = 0.013
export const CREATINE_WATER_UNCERTAINTY = 0.5
export const MAX_CREATINE_BREAKS = 20
const TAU_DAYS = { maintenance: 9, loading: 2, washout: 9 }

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

const breaksValid = (c: Creatine) => {
  const b = c.breaks
  if (b === undefined) return true
  if (!Array.isArray(b) || b.length > MAX_CREATINE_BREAKS) return false
  let after = c.start
  for (const x of b) {
    if (!x || typeof x !== 'object' || !isDate(x.from) || !isDate(x.to)) return false
    // inside the taking period, in order, not overlapping
    if (x.from <= after || x.to < x.from) return false
    if (c.stop && x.to >= c.stop) return false
    after = x.to
  }
  return true
}

export const isValidCreatine = (c: unknown): c is Creatine =>
  !!c &&
  typeof c === 'object' &&
  isDate((c as Creatine).start) &&
  ((c as Creatine).loading === undefined || typeof (c as Creatine).loading === 'boolean') &&
  ((c as Creatine).stop === undefined || (isDate((c as Creatine).stop) && (c as Creatine).stop! >= (c as Creatine).start)) &&
  breaksValid(c as Creatine)

/** The full extra water once saturated, kg. */
export const creatineFullKg = (bodyKg: number) => Math.round(bodyKg * CREATINE_WATER_FRACTION * 100) / 100

/** The days it was taken, as [first day, day after the last) in day numbers; the last may be open. */
function onPeriods(c: Creatine): { from: number; until: number; tau: number }[] {
  const out: { from: number; until: number; tau: number }[] = []
  let from = dayNum(c.start)
  let tau = c.loading ? TAU_DAYS.loading : TAU_DAYS.maintenance
  for (const b of c.breaks ?? []) {
    out.push({ from, until: dayNum(b.from), tau })
    from = dayNum(b.to) + 1
    tau = TAU_DAYS.maintenance // a restart is a normal daily dose
  }
  out.push({ from, until: c.stop ? dayNum(c.stop) + 1 : Infinity, tau })
  return out
}

/**
 * Extra water from creatine on `date` (morning weigh-in), kg — 0 before the start.
 * Fills towards full while taken (1 − e^(−t/τ)) and drains while not (e^(−t/τ)), from wherever it was:
 * after a short break it is still mostly there; after a long one it starts again from near zero.
 */
export function creatineWaterKg(c: Creatine | null | undefined, date: string, bodyKg: number): number {
  if (!isValidCreatine(c) || date <= c.start) return 0
  const d = dayNum(date)
  let level = 0 // share of the full effect
  let t = dayNum(c.start)
  for (const p of onPeriods(c)) {
    if (d <= p.from) return bodyKg * CREATINE_WATER_FRACTION * level * Math.exp(-(d - t) / TAU_DAYS.washout)
    level *= Math.exp(-(p.from - t) / TAU_DAYS.washout)
    const end = Math.min(d, p.until)
    level = 1 - (1 - level) * Math.exp(-(end - p.from) / p.tau)
    t = end
    if (d <= p.until) return bodyKg * CREATINE_WATER_FRACTION * level
  }
  return bodyKg * CREATINE_WATER_FRACTION * level * Math.exp(-(d - t) / TAU_DAYS.washout)
}

/** "I'm taking it again" on `today`: the days since the stop become a break. */
export function resumeCreatine(c: Creatine, today: string): Creatine {
  const { stop, ...rest } = c
  if (!stop) return c
  const from = addDay(stop, 1)
  const to = addDay(today, -1)
  if (from > to) return rest // stopped and restarted the same/next day: no gap
  return { ...rest, breaks: [...(c.breaks ?? []), { from, to }].slice(-MAX_CREATINE_BREAKS) }
}

/** The latest day it was (re)started — the start, or the day after the last break. */
export const creatineLastStart = (c: Creatine) => {
  const b = c.breaks?.at(-1)
  return b ? addDay(b.to, 1) : c.start
}

/** First day from `today` on which the effect is ~complete (≥95%), or null if already there / stopped. */
export function creatineFullBy(c: Creatine, today: string): string | null {
  if (c.stop && c.stop < today) return null
  for (let i = 0; i <= 60; i++) {
    const day = addDay(today, i)
    if (creatineProgress(c, day) >= 0.95) return i === 0 ? null : day
  }
  return null
}

function addDay(key: string, n: number): string {
  return new Date((dayNum(key) + n) * 86_400_000).toISOString().slice(0, 10)
}

/** Share of the full effect reached on `date` (0–1), for "about 80% of the way there". */
export function creatineProgress(c: Creatine | null | undefined, date: string): number {
  return creatineWaterKg(c, date, 100) / (100 * CREATINE_WATER_FRACTION)
}
