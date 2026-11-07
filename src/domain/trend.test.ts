import { describe, expect, it } from 'vitest'
import { measuredExpenditure, trendOn, trendWeights, weeklyRate, type TrendPoint } from './trend'

const day = (i: number) => {
  const d = new Date(Date.UTC(2026, 9, 1 + i, 12))
  return d.toISOString().slice(0, 10)
}

describe('trend weight (10% a day exponential smoothing)', () => {
  it('by hand: 60 then 61 the next day → 60.1; after a 3-day gap → 60 + 0.271', () => {
    expect(trendWeights([{ date: day(0), kg: 60 }, { date: day(1), kg: 61 }]).at(-1)!.trend).toBe(60.1)
    expect(trendWeights([{ date: day(0), kg: 60 }, { date: day(3), kg: 61 }]).at(-1)!.trend).toBeCloseTo(60.27, 2) // 1 − 0.9³ = 0.271
  })
  it('a one-morning +0.75 kg water swing moves the trend only 0.075', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ date: day(i), kg: 60 }))
    pts.push({ date: day(10), kg: 60.75 })
    expect(trendWeights(pts).at(-1)!.trend).toBeCloseTo(60.08, 2)
  })
  it('a steady −0.1 kg/day loss shows as ≈ −0.7 kg/week once the trend has caught up', () => {
    const pts = Array.from({ length: 70 }, (_, i) => ({ date: day(i), kg: 70 - 0.1 * i }))
    expect(weeklyRate(trendWeights(pts))).toBeCloseTo(-0.7, 1)
  })
  it('the trend on a day without a weigh-in is the last one before it', () => {
    const t = trendWeights([{ date: day(0), kg: 60 }, { date: day(5), kg: 60 }])
    expect(trendOn(t, day(3))).toBe(60)
    expect(trendOn(t, day(-1))).toBeNull()
  })
})

describe('expenditure measured from intake and the trend', () => {
  const trend = (start: number, end: number, n: number): TrendPoint[] => [
    { date: day(0), kg: start, trend: start },
    { date: day(n), kg: end, trend: end },
  ]
  const logged = (n: number, eaten = 2000, burned = 2150) => Array.from({ length: n }, (_, i) => ({ date: day(i), eaten, burned, hasFood: true }))

  it('by hand: 21 days at 2,000 kcal, trend 60.0 → 59.4 → 2,000 + 0.6 × 7,700 / 21 = 2,220 kcal/day', () => {
    const m = measuredExpenditure({ trend: trend(60, 59.4, 21), days: logged(21) })!
    expect(m.days).toBe(21)
    expect(m.avgIntake).toBe(2000)
    expect(m.tissueKg).toBe(-0.6)
    expect(m.expenditure).toBe(2220)
    expect(m.plusMinus).toBe(90) // 0.25 kg × 7,700 / 21
    expect(m.appBurn).toBe(2150)
  })
  it('creatine water is taken out: the same 0.6 kg loss under 21 days of creatine water gives the same 2,220', () => {
    const creatine = { start: day(0) }
    // by hand: 1.3% × ~59.8 kg × (1 − e^(−21/9)) ≈ 0.70 kg of water by day 21
    const water = 0.013 * 59.8 * (1 - Math.exp(-21 / 9))
    const m = measuredExpenditure({ trend: trend(60, 59.4 + water, 21), days: logged(21), creatine })!
    expect(m.waterKg).toBeCloseTo(water, 1)
    expect(Math.abs(m.expenditure - 2220)).toBeLessThan(21)
  })
  it('needs 14 consecutive logged days right before the latest weigh-in', () => {
    expect(measuredExpenditure({ trend: trend(60, 59.8, 10), days: logged(10) })).toBeNull()
    const gap = logged(21).map((d, i) => (i === 18 ? { ...d, hasFood: false } : d))
    expect(measuredExpenditure({ trend: trend(60, 59.4, 21), days: gap })).toBeNull() // only 2 days after the gap
  })
})
