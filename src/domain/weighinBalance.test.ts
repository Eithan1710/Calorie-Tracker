import { describe, expect, it } from 'vitest'
import { balanceBetweenWeighins, balanceVerdict } from './weighinBalance'
import { summarizeDay } from './day'
import { addDays } from './goal'

const profile = { sex: 'male' as const, age: 20, heightCm: 162, weightKg: 60.1 }
const entry = (date: string, kcal: number, p = 100, c = 150, f = 50) => ({
  id: date, date, meal: 'lunch' as const, title: '', emoji: '', items: [], totals: { calories: kcal, protein_g: p, fat_g: f, carbs_g: c },
  confidence: 1, provider: '', status: 'ok' as const, created_at: '', updated_at: '',
})
const day = (date: string, kcal: number | null, health?: { active_kcal: number; resting_kcal: number }) =>
  summarizeDay({
    date, food: kcal === null ? [] : [entry(date, kcal)], exercises: [], steps: 0, profile, proteinTarget: 120,
    health: health ? { ...health, health_as_of: `${addDays(date, 1)}T12:00:00+03:00` } : null, now: new Date('2026-10-23T11:00:00+03:00'),
  })

describe('energy balance between two weigh-ins', () => {
  it('counts the full days from the first weigh-in to the day before the second', () => {
    const days = ['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'].map((d) =>
      day(d, 1600, { active_kcal: 300, resting_kcal: 1500 }),
    )
    const r = balanceBetweenWeighins({ previous: { date: '2026-10-16', kg: 60.1 }, latest: { date: '2026-10-23', kg: 59.2 }, days })!
    expect(r.days).toBe(7)
    expect(r.from).toBe('2026-10-16')
    expect(r.through).toBe('2026-10-22')
    // each day: 1500 + 300 + TEF(100·4·.25 + 150·4·.075 + 50·9·.02 = 100 + 45 + 9 = 154) − 1600 = 354
    expect(r.deficit).toBe(7 * 354)
    expect(r.predictedKg).toBeCloseTo(-(7 * 354) / 7700, 2)
    expect(r.measuredKg).toBe(-0.9)
    expect(r.missingFood).toEqual([])
  })

  it('the same cumulative number as adding up the daily balances (no separate formula)', () => {
    const days = [day('2026-10-16', 2828, { active_kcal: 203.5, resting_kcal: 1524.3 }), day('2026-10-17', 1192, { active_kcal: 332.9, resting_kcal: 1600.4 })]
    const r = balanceBetweenWeighins({ previous: { date: '2026-10-16', kg: 60 }, latest: { date: '2026-10-18', kg: 60 }, days })!
    expect(r.deficit).toBe(Math.round(days.reduce((s, d) => s + d.burned - d.eaten, 0)))
  })

  it('a day without food is reported missing, not treated as 0 kcal eaten', () => {
    const days = [day('2026-10-16', 1600, { active_kcal: 300, resting_kcal: 1500 }), day('2026-10-17', null, { active_kcal: 300, resting_kcal: 1500 })]
    const r = balanceBetweenWeighins({ previous: { date: '2026-10-16', kg: 60 }, latest: { date: '2026-10-18', kg: 59.8 }, days })!
    expect(r.missingFood).toEqual(['2026-10-17'])
    expect(r.counted).toBe(1)
    expect(r.deficit).toBe(354) // only the logged day
  })

  it('flags days whose burn is only the estimate model', () => {
    const days = [day('2026-10-16', 1600), day('2026-10-17', 1600, { active_kcal: 300, resting_kcal: 1500 })]
    const r = balanceBetweenWeighins({ previous: { date: '2026-10-16', kg: 60 }, latest: { date: '2026-10-18', kg: 60 }, days })!
    expect(r.estimatedBurn).toEqual(['2026-10-16'])
  })

  it('nothing to compare for the same day or a reversed order', () => {
    expect(balanceBetweenWeighins({ previous: { date: '2026-10-16', kg: 60 }, latest: { date: '2026-10-16', kg: 60 }, days: [] })).toBe(null)
  })
})

describe('does the scale agree with the numbers?', () => {
  it('2.11 59.95 → 3.11 70.0: +10 kg in a day is a typo, not something to explain with calories', () => {
    expect(balanceVerdict({ predictedKg: -0.09, measuredKg: 10.05, days: 1 })).toEqual({ kind: 'implausible' })
  })
  it('under a week: no verdict (water dominates)', () => {
    expect(balanceVerdict({ predictedKg: -0.2, measuredKg: 0.6, days: 3 })).toEqual({ kind: 'short' })
  })
  it('19.10 60.1 → 31.10 59.5 with a 4,000 kcal deficit: −0.52 predicted vs −0.6 measured → matches', () => {
    const v = balanceVerdict({ predictedKg: -4000 / 7700, measuredKg: -0.6, days: 12 })
    expect(v.kind).toBe('match')
  })
  it('the scale went down far less than predicted → burn overestimated / food under-logged, per day', () => {
    // predicted −1.5 kg in 14 days, scale −0.2: 1.3 kg gap, 0.8 kg beyond the noise → 0.8 × 7,700 / 14 ≈ 440 / day
    const v = balanceVerdict({ predictedKg: -1.5, measuredKg: -0.2, days: 14 })
    expect(v).toEqual({ kind: 'heavier', gapKg: 1.3, kcalPerDay: 440 })
  })
  it('the scale went down more than predicted → lighter', () => {
    const v = balanceVerdict({ predictedKg: -0.2, measuredKg: -1.2, days: 10 })
    expect(v.kind).toBe('lighter')
    expect(v.kind !== 'match' && v.kcalPerDay).toBe(390) // 0.5 kg beyond the noise × 7,700 / 10
  })
  it('keeps the scale to the hundredth', () => {
    const days = [day('2026-10-16', 1600, { active_kcal: 300, resting_kcal: 1500 })]
    expect(balanceBetweenWeighins({ previous: { date: '2026-10-16', kg: 60.1 }, latest: { date: '2026-10-17', kg: 59.65 }, days })!.measuredKg).toBe(-0.45)
  })
})
