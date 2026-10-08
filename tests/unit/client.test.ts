import { describe, expect, it } from 'vitest'
import { tryLocalCorrection } from '../../src/ui/sheets/Review'
import { liftLabel, liftsFromDrafts, parseDuration } from '../../src/ui/sheets/ExerciseSheet'
import { summarizeDay } from '../../src/domain/day'
import { parseLocally } from '../../supabase/functions/_shared/localParser.ts'
import { fmtBalance } from '../../src/ui/format'
import type { FoodEntry } from '../../src/data/types'

const profile = { sex: 'male' as const, age: 32, heightCm: 178, weightKg: 82 }

function entry(calories: number, protein: number, status: FoodEntry['status'] = 'ok'): FoodEntry {
  return {
    id: crypto.randomUUID(), date: '2026-10-06', meal: 'lunch', title: 't', emoji: '🍽️', items: [],
    totals: { calories, protein_g: protein, fat_g: 10, carbs_g: 20 }, confidence: 0.8, provider: 'local', status,
    created_at: '2026-10-06T10:00:00Z', updated_at: '2026-10-06T10:00:00Z',
  }
}

describe('instant local corrections', () => {
  const base = parseLocally('חזה עוף 180 גרם ו200 גרם אורז וסלט').analysis!

  it('"זה היה 250 גרם אורז" changes only the rice and recalculates', () => {
    const fixed = tryLocalCorrection(base, 'זה היה 250 גרם אורז')!
    const rice = fixed.items.find((i) => i.db_key === 'rice_white_cooked')!
    expect(rice.grams).toBe(250)
    expect(rice.calories).toBe(325)
    expect(fixed.items.find((i) => i.db_key === 'chicken_breast_cooked')!.grams).toBe(180)
    expect(fixed.totals.calories).toBe(base.totals.calories + 65)
  })

  it('defers to the AI for removals, additions, or unknown foods', () => {
    expect(tryLocalCorrection(base, 'בלי האורז')).toBeNull()
    expect(tryLocalCorrection(base, 'הוספתי כף טחינה')).toBeNull()
    expect(tryLocalCorrection(base, '100 גרם קינואה')).toBeNull() // not in the list
    expect(tryLocalCorrection(base, 'היה יותר אורז')).toBeNull() // no amount
  })
})

describe('exercise time input', () => {
  it.each([
    ['25', 25],
    ['25:30', 25.5],
    ['1:05:00', 65],
    ['', null],
    ['abc', null],
  ])('%s → %s', (input, out) => {
    expect(parseDuration(input)).toBe(out)
  })
})

describe('workout weights (optional, tracking only)', () => {
  it('keeps rows with a name or a load, drops empty ones', () => {
    const lifts = liftsFromDrafts([
      { id: '1', name: 'לחיצת חזה', weight: 68, sets: 4, reps: 8 },
      { id: '2', name: '', weight: '', sets: '', reps: '' },
      { id: '3', name: '', weight: 20, sets: '', reps: '' },
      { id: '4', name: ' סקוואט ', weight: -5, sets: '', reps: '' },
    ])
    expect(lifts).toEqual([
      { id: '1', name: 'לחיצת חזה', weight_kg: 68, sets: 4, reps: 8 },
      { id: '3', name: 'תרגיל', weight_kg: 20 },
      { id: '4', name: 'סקוואט' },
    ])
    expect(liftLabel(lifts[0])).toBe('לחיצת חזה 68 ק״ג · 4×8')
  })
})

describe('day summary', () => {
  it('sums only analysed entries; pending ones wait', () => {
    const s = summarizeDay({ date: '2026-10-06', food: [entry(500, 40), entry(700, 50), entry(0, 0, 'pending')], exercises: [], steps: 0, profile, proteinTarget: 120, now: new Date(2026, 9, 6, 22) })
    expect(s.eaten).toBe(1200)
    expect(s.protein).toBe(90)
    expect(s.pendingCount).toBe(1)
    expect(s.proteinMet).toBe(false)
    expect(s.burned).toBe(2053)
    expect(s.goal!.status).toBe('over')
  })

  it('protein target reached at exactly 120 g', () => {
    const s = summarizeDay({ date: '2026-10-06', food: [entry(1900, 120)], exercises: [], steps: 0, profile, proteinTarget: 120 })
    expect(s.proteinMet).toBe(true)
  })

  it('no profile → no burn / goal yet (never guesses)', () => {
    const s = summarizeDay({ date: '2026-10-06', food: [entry(500, 40)], exercises: [], steps: 0, profile: null, proteinTarget: 120 })
    expect(s.burn).toBeNull()
    expect(s.goal).toBeNull()
  })
})

describe('balance formatting', () => {
  it('shows a deficit as negative, surplus as positive', () => {
    expect(fmtBalance(150)).toBe('−150')
    expect(fmtBalance(-100)).toBe('+100')
    expect(fmtBalance(0)).toBe('0')
    expect(fmtBalance(1234)).toBe('−1,234')
  })
})
