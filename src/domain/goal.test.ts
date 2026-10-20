import { describe, expect, it } from 'vitest'
import { addDays, dayTarget, evaluateGoal, evaluateIntake, intakeRangeFor, isDayFinal, isValidKcalRange, kcalRangeError, phaseOf, toDateKey } from './goal'
import { summarizeDay } from './day'

const final = (eaten: number, burned: number) => evaluateGoal({ eaten, burned, hasFood: true, dayFinal: true })

describe('goal status (spec examples)', () => {
  it('burned 2200, eaten 2000 → deficit 200 → success', () => {
    const r = final(2000, 2200)
    expect(r.deficit).toBe(200)
    expect(r.status).toBe('success')
    expect(r.title).toBe('היעד הושג')
  })
  it('burned 2200, eaten 2150 → deficit 50 → almost', () => {
    const r = final(2150, 2200)
    expect(r.status).toBe('almost')
    expect(r.detail).toContain('50')
  })
  it('burned 2200, eaten 2300 → −100 → surplus', () => {
    const r = final(2300, 2200)
    expect(r.deficit).toBe(-100)
    expect(r.status).toBe('surplus')
  })
  it('burned 2200, eaten 1800 → 400 → deficit larger than target', () => {
    const r = final(1800, 2200)
    expect(r.status).toBe('over')
    expect(r.title).toBe('הגירעון גדול מהיעד')
  })
})

describe('goal boundaries', () => {
  it.each([
    [100, 'success'],
    [300, 'success'],
    [99, 'almost'],
    [0, 'almost'],
    [-1, 'surplus'],
    [301, 'over'],
  ])('deficit %i → %s', (deficit, status) => {
    expect(final(2000 - deficit, 2000).status).toBe(status)
  })
})

describe('day in progress', () => {
  it('a large deficit mid-day means room to eat, not a warning', () => {
    const r = evaluateGoal({ eaten: 900, burned: 2300, hasFood: true, dayFinal: false })
    expect(r.status).toBe('room')
    expect(r.roomMin).toBe(1100)
    expect(r.roomMax).toBe(1300)
  })
  it('no food yet → empty with the eating budget', () => {
    const r = evaluateGoal({ eaten: 0, burned: 2300, hasFood: false, dayFinal: false })
    expect(r.status).toBe('empty')
    expect(r.roomMin).toBe(2000)
    expect(r.roomMax).toBe(2200)
  })
  it('isDayFinal: past days final, today final only in the evening', () => {
    const noon = new Date(2026, 9, 6, 12, 0)
    const night = new Date(2026, 9, 6, 21, 0)
    expect(isDayFinal('2026-10-05', noon)).toBe(true)
    expect(isDayFinal('2026-10-06', noon)).toBe(false)
    expect(isDayFinal('2026-10-06', night)).toBe(true)
  })
})

describe('date keys', () => {
  it('formats local dates and adds days across month boundaries', () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('personal targets', () => {
  const at = (eaten: number, burned: number, target: { min: number; max: number }, dayFinal = true) => evaluateGoal({ eaten, burned, hasFood: true, dayFinal, target })

  it('a weight-loss target (300–500) moves the success band', () => {
    expect(at(1800, 2200, { min: 300, max: 500 }).status).toBe('success') // deficit 400
    expect(at(2000, 2200, { min: 300, max: 500 }).status).toBe('almost') // deficit 200
    expect(at(2000, 2200, { min: 100, max: 300 }).status).toBe('success') // same day, default target
  })
  it('maintenance (−100…100) counts a small surplus as on target', () => {
    expect(at(2250, 2200, { min: -100, max: 100 }).status).toBe('success')
    expect(at(2400, 2200, { min: -100, max: 100 }).status).toBe('surplus')
  })
  it('a gain target (200–400 surplus) reports a deficit day as room to eat', () => {
    expect(at(2500, 2200, { min: -400, max: -200 }).status).toBe('success')
    const r = at(2100, 2200, { min: -400, max: -200 }, false)
    expect(r.status).toBe('room')
    expect(r.roomMin).toBe(300)
    expect(r.roomMax).toBe(500)
  })
  it('falls back to 100–300 when the target is invalid', () => {
    expect(at(2000, 2200, { min: 300, max: 100 }).status).toBe('success')
  })
})

// ── custom calorie range ─────────────────────────────────────────────────────

describe('custom calorie range: the whole range is the target', () => {
  const r = { min: 1900, max: 2100 }
  const at = (eaten: number, dayFinal = false, hasFood = true) => evaluateIntake({ eaten, hasFood, dayFinal, range: r })

  it('below / within / above', () => {
    expect(at(1500).status).toBe('room') // the day is still running: room to eat
    expect(at(1500).title).toContain('400–600')
    expect(at(1500, true).status).toBe('below')
    expect(at(1500, true).detail).toContain('400')
    expect(at(1900).status).toBe('success') // the edges are inside
    expect(at(2000).status).toBe('success')
    expect(at(2100).status).toBe('success')
    expect(at(2100, true).status).toBe('success')
    expect(at(2101).status).toBe('above')
    expect(at(2400).detail).toContain('300')
  })

  it('no food yet → shows the range', () => {
    const g = at(0, false, false)
    expect(g).toMatchObject({ status: 'empty', roomMin: 1900, roomMax: 2100 })
    expect(g.detail).toContain('1,900–2,100')
  })

  it('validation: positive numbers, min below max, sane limits', () => {
    expect(kcalRangeError(1900, 2100)).toBe(null)
    expect(kcalRangeError(2100, 1900)).toMatch(/נמוך מהמקסימום/)
    expect(kcalRangeError(2000, 2000)).toMatch(/נמוך מהמקסימום/)
    expect(kcalRangeError(-5, 2000)).toMatch(/חיוביים/)
    expect(kcalRangeError('', 2000)).toMatch(/מינימום ומקסימום/)
    expect(kcalRangeError(100, 300)).toMatch(/טווח אפשרי/)
    expect(kcalRangeError(1900, 9000)).toMatch(/טווח אפשרי/)
    expect(isValidKcalRange({ min: 1900, max: 2100 })).toBe(true)
    expect(isValidKcalRange({ min: 1900 })).toBe(false)
  })

  it('mode decides the target; the custom range survives switching and phase changes', () => {
    const custom = { min: 1900, max: 2100 }
    expect(dayTarget({ calorieMode: 'custom', customKcal: custom, deficitTarget: { min: 100, max: 300 } })).toEqual({ kind: 'intake', min: 1900, max: 2100 })
    // automatic mode ignores the saved range but does not need it removed
    expect(dayTarget({ calorieMode: 'auto', customKcal: custom, deficitTarget: { min: 300, max: 500 } })).toEqual({ kind: 'deficit', min: 300, max: 500 })
    // older settings (no mode) = automatic, as before
    expect(dayTarget({ deficitTarget: { min: 100, max: 300 } })).toEqual({ kind: 'deficit', min: 100, max: 300 })
    // custom without a valid range falls back to automatic instead of judging against nothing
    expect(dayTarget({ calorieMode: 'custom', customKcal: { min: 2100, max: 1900 }, deficitTarget: { min: 100, max: 300 } }).kind).toBe('deficit')
  })

  it('phase: stored, or derived from the band of older settings', () => {
    expect(phaseOf({ goalPhase: 'gain', deficitTarget: { min: 100, max: 300 } })).toBe('gain')
    expect(phaseOf({ deficitTarget: { min: 300, max: 500 } })).toBe('cut')
    expect(phaseOf({ deficitTarget: { min: 1, max: 2 } })).toBe('recomp')
  })

  it('intake range of the day: custom as is; automatic = burned − band', () => {
    expect(intakeRangeFor({ kind: 'intake', min: 1900, max: 2100 }, null)).toEqual({ min: 1900, max: 2100 })
    expect(intakeRangeFor({ kind: 'deficit', min: 100, max: 300 }, 2200)).toEqual({ min: 1900, max: 2100 })
    expect(intakeRangeFor({ kind: 'deficit', min: 100, max: 300 }, null)).toBe(null)
  })

  it('day summary: judged against the custom range even without a burn estimate', () => {
    const food = (kcal: number) => ({ id: String(kcal), date: '2026-10-06', meal: 'lunch' as const, title: 'x', emoji: '', items: [], totals: { calories: kcal, protein_g: 0, fat_g: 0, carbs_g: 0 }, confidence: 1, provider: 'x', status: 'ok' as const, created_at: '', updated_at: '' })
    const day = (kcal: number) => summarizeDay({ date: '2026-10-06', food: [food(kcal)], exercises: [], steps: 0, profile: null, proteinTarget: 120, target: { kind: 'intake', min: 1900, max: 2100 }, now: new Date('2026-10-07T12:00:00') })
    expect(day(2000).goal?.status).toBe('success')
    expect(day(1800).goal?.status).toBe('below')
    expect(day(2300).goal?.status).toBe('above')
    expect(day(2000).intakeRange).toEqual({ min: 1900, max: 2100 })
  })
})
