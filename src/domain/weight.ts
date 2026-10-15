/**
 * Body-weight progress: pure helpers for the weight screen (no UI).
 *
 *  - The axis never exaggerates small changes: the visible range is at least
 *    MIN_SPAN_KG, centred on the data, so a 0.4 kg wobble looks like one.
 *  - The line is a monotone cubic (Fritsch–Carlson): smooth, but it never
 *    overshoots past a real measurement (no invented dips or peaks).
 *  - Only numbers that follow directly from the measurements are produced:
 *    the latest weight and the change since the previous weigh-in.
 */

export interface WeightPoint {
  date: string // YYYY-MM-DD
  kg: number
}

export type WeightRange = '1m' | '3m' | 'all'
export const RANGE_DAYS: Record<WeightRange, number | null> = { '1m': 31, '3m': 92, all: null }

/** smallest visible kg range on the chart (keeps weekly noise looking like noise) */
export const MIN_SPAN_KG = 4

const DAY = 86_400_000
export const dayNum = (key: string) => Math.round(Date.parse(`${key}T12:00:00Z`) / DAY)

/** Points inside the range ending today (all-time = everything). Sorted oldest → newest. */
export function inRange(points: WeightPoint[], range: WeightRange, today: string): WeightPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const days = RANGE_DAYS[range]
  if (days === null) return sorted
  const from = dayNum(today) - days
  return sorted.filter((p) => dayNum(p.date) >= from)
}

export interface WeightSummary {
  latest: WeightPoint | null
  previous: WeightPoint | null
  /** latest − previous, kg (null with fewer than two measurements) */
  change: number | null
}

export function summary(points: WeightPoint[]): WeightSummary {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted.at(-1) ?? null
  const previous = sorted.at(-2) ?? null
  const change = latest && previous ? Math.round((latest.kg - previous.kg) * 10) / 10 : null
  return { latest, previous, change }
}

/** Y axis: [lo, hi] and tick values; at least MIN_SPAN_KG wide, ticks on round kilograms. */
export function yAxis(values: number[]): { lo: number; hi: number; ticks: number[] } {
  if (!values.length) return { lo: 0, hi: MIN_SPAN_KG, ticks: [] }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(MIN_SPAN_KG, (max - min) * 1.25)
  const step = span <= 6 ? 1 : span <= 12 ? 2 : span <= 30 ? 5 : 10
  const mid = (min + max) / 2
  let lo = Math.floor((mid - span / 2) / step) * step
  let hi = Math.ceil((mid + span / 2) / step) * step
  if (hi - lo < MIN_SPAN_KG) hi = lo + Math.ceil(MIN_SPAN_KG / step) * step
  lo = Math.max(0, lo)
  const ticks: number[] = []
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10)
  return { lo, hi, ticks }
}

/** X axis: first/last day shown, and a few evenly spaced date ticks. */
export function xAxis(points: WeightPoint[], range: WeightRange, today: string): { from: number; to: number } {
  const days = RANGE_DAYS[range]
  const to = dayNum(today)
  if (days !== null) return { from: to - days, to }
  if (!points.length) return { from: to - 30, to }
  const first = dayNum(points[0].date)
  // all time: from the first measurement (at least two weeks wide so one point isn't squeezed)
  return { from: Math.min(first, to - 14), to }
}

/** Monotone cubic SVG path through pixel points (x ascending). */
export function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  if (n === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`
  const dx: number[] = [], m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x || 1e-6)
    m.push((pts[i + 1].y - pts[i].y) / (dx[i] || 1e-6))
  }
  const t: number[] = [m[0]]
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]))
  t.push(m[n - 2])
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += `C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

/** Parse a typed weight ("61.4", "61,4") → kg, or null when not a plausible body weight. */
export function parseKg(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  if (!Number.isFinite(n) || n < 20 || n > 400) return null
  return Math.round(n * 10) / 10
}
