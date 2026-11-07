import { describe, expect, it } from 'vitest'
import { fiberOf, summarizeDay } from './day'
import type { FoodEntry } from '../data/types'

const entry = (items: { calories: number; grams: number; fiber?: number }[]): FoodEntry =>
  ({
    id: 'e',
    date: '2026-11-07',
    status: 'ok',
    items: items.map((i, n) => ({ id: `i${n}`, name: 'x', grams: i.grams, calories: i.calories, protein_g: 0, fat_g: 0, carbs_g: 0, per100: { kcal: (i.calories * 100) / i.grams, protein_g: 0, fat_g: 0, carbs_g: 0, ...(i.fiber !== undefined ? { fiber_g: i.fiber } : {}) }, source: 'db', confidence: 0.9, assumptions: [] })),
    totals: { calories: items.reduce((s, i) => s + i.calories, 0), protein_g: 0, fat_g: 0, carbs_g: 0 },
  }) as unknown as FoodEntry

describe('fibre from the foods that have it', () => {
  it('by hand: 150 g lentils at 7.9 g/100 g + 60 g bread at 6 g/100 g = 11.85 + 3.6 = 15.45 g', () => {
    const f = fiberOf([entry([{ calories: 174, grams: 150, fiber: 7.9 }, { calories: 150, grams: 60, fiber: 6 }])])
    expect(f.grams).toBeCloseTo(15.45, 6)
    expect(f.coverage).toBe(1)
  })
  it('an item without a fibre value lowers the coverage (by calories), never adds a guess', () => {
    const f = fiberOf([entry([{ calories: 100, grams: 100, fiber: 5 }, { calories: 300, grams: 200 }])])
    expect(f.grams).toBe(5)
    expect(f.coverage).toBe(0.25)
  })
  it('summarizeDay carries it', () => {
    const s = summarizeDay({ date: '2026-11-07', food: [entry([{ calories: 174, grams: 150, fiber: 7.9 }])], exercises: [], steps: 0, profile: null, proteinTarget: 100 })
    expect(s.fiber).toBe(12)
    expect(s.fiberCoverage).toBe(1)
  })
})

describe('a past day is costed with the weight of that time', () => {
  const profile = { sex: 'male' as const, age: 20, heightCm: 160, weightKg: 70 }
  const w = (date: string, kg: number, deleted = false) => ({ date, weight_kg: kg, created_at: '', updated_at: '', ...(deleted ? { deleted: true } : {}) })
  const weights = { '2026-10-20': w('2026-10-20', 60), '2026-11-03': w('2026-11-03', 70) }
  it('before the latest weigh-in: the weigh-in on or before the day; from it on: the profile', async () => {
    const { profileOnDate } = await import('./day')
    expect(profileOnDate(profile, weights as never, '2026-10-25')!.weightKg).toBe(60)
    expect(profileOnDate(profile, weights as never, '2026-11-03')!.weightKg).toBe(70)
    expect(profileOnDate(profile, weights as never, '2026-11-07')!.weightKg).toBe(70)
    expect(profileOnDate(profile, weights as never, '2026-10-01')!.weightKg).toBe(70) // before any weigh-in
    expect(profileOnDate(profile, { ...weights, '2026-11-03': w('2026-11-03', 70, true) } as never, '2026-10-25')!.weightKg).toBe(70) // 10-20 is now the latest
  })
})
