import { describe, expect, it } from 'vitest'
import { addDays, bandFrom, bandLabel, bandParts, customBandError, dayTarget, evaluateGoal, intakeRangeFor, isDayFinal, phaseOf, toDateKey } from './goal'

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

describe('surplus wording follows its size (and works for past days)', () => {
  it('+100 is a small surplus; +1,391 is not', () => {
    const small = final(2300, 2200)
    expect(small.title).toBe('עודף קלורי קטן')
    expect(small.detail).toContain('מחר מאזנים')
    // the day from the app: 3,490 eaten, 2,099 burned, target deficit 350–400
    const big = evaluateGoal({ eaten: 3490, burned: 2099, hasFood: true, dayFinal: true, target: { min: 350, max: 400 } })
    expect(big.status).toBe('surplus')
    expect(big.title).toBe('עודף קלורי')
    expect(big.title).not.toContain('קטן')
    expect(big.detail).toContain('1,391')
    expect(big.detail).toContain('1,741') // away from the target band
    expect(big.title + big.detail).not.toContain('היום')
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

describe('day in progress: food already past the budget', () => {
  // the case from the app: band 350–400, 19:18, burn so far projected 1,804, eaten 1,626 → deficit 178
  it('says "over today\'s budget by 172", never "172 calories missing" (which reads as "eat more")', () => {
    const r = evaluateGoal({ eaten: 1626, burned: 1804, hasFood: true, dayFinal: false, target: { min: 350, max: 400 } })
    expect(r.status).toBe('over_budget')
    expect(r.title).toBe('מעל התקציב להיום')
    expect(r.detail).toContain('172')
    expect(r.detail).toContain('מעבר לתקציב')
    expect(r.detail).not.toContain('חסרות')
  })
  it('the same numbers once the day is over: the deficit came out 172 short', () => {
    const r = evaluateGoal({ eaten: 1626, burned: 1804, hasFood: true, dayFinal: true, target: { min: 350, max: 400 } })
    expect(r.status).toBe('almost')
    expect(r.detail).toContain('172')
    expect(r.detail).toContain('קטן')
  })
  it('in the band, or with room left, nothing changes', () => {
    expect(evaluateGoal({ eaten: 1430, burned: 1804, hasFood: true, dayFinal: false, target: { min: 350, max: 400 } }).status).toBe('success')
    expect(evaluateGoal({ eaten: 1200, burned: 1804, hasFood: true, dayFinal: false, target: { min: 350, max: 400 } }).status).toBe('room')
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

describe('custom deficit / surplus band', () => {
  const day = (eaten: number, burned: number, target: { min: number; max: number }) => evaluateGoal({ eaten, burned, hasFood: true, dayFinal: true, target })

  it('deficit 200–300: the whole band is the target', () => {
    const band = bandFrom('deficit', 200, 300)
    expect(band).toEqual({ min: 200, max: 300 })
    expect(day(2300, 2500, band).status).toBe('success') // 200, edge
    expect(day(2250, 2500, band).status).toBe('success') // 250
    expect(day(2200, 2500, band).status).toBe('success') // 300, edge
    expect(day(2350, 2500, band).status).toBe('almost') // 150 — short of the band
    expect(day(2600, 2500, band).status).toBe('surplus')
    expect(day(2100, 2500, band).status).toBe('over') // 400 — more than asked for
  })

  it('surplus 200–400 is stored negative and judged the same way', () => {
    const band = bandFrom('surplus', 200, 400)
    expect(band).toEqual({ min: -400, max: -200 })
    expect(day(2700, 2500, band).status).toBe('success') // +200
    expect(day(2900, 2500, band).status).toBe('success') // +400
    expect(day(3000, 2500, band)).toMatchObject({ status: 'surplus', title: 'יותר מהעודף שתכננת' }) // +500
    expect(day(3000, 2500, band).detail).toContain('100')
    expect(day(2500, 2500, band)).toMatchObject({ status: 'almost', title: 'כמעט שם' }) // balance 0: short of the surplus
    expect(day(2500, 2500, band).detail).toContain('200')
    // day still going: room to eat up to the band
    expect(evaluateGoal({ eaten: 2500, burned: 2500, hasFood: true, dayFinal: false, target: band })).toMatchObject({ status: 'room', roomMin: 200, roomMax: 400 })
  })

  it('typed parts ↔ band round-trip, labels', () => {
    expect(bandParts({ min: 200, max: 300 })).toEqual({ dir: 'deficit', from: 200, to: 300 })
    expect(bandParts({ min: -400, max: -200 })).toEqual({ dir: 'surplus', from: 200, to: 400 })
    expect(bandLabel({ min: 200, max: 300 })).toContain('גירעון')
    expect(bandLabel({ min: 200, max: 300 })).toContain('200–300')
    expect(bandLabel({ min: -400, max: -200 })).toContain('עודף')
    expect(bandLabel({ min: -400, max: -200 })).toContain('200–400')
    expect(bandLabel({ min: -100, max: 100 })).toContain('מאזן')
  })

  it('validation: numbers, positive, from < to, sane limits', () => {
    expect(customBandError('deficit', 200, 300)).toBe(null)
    expect(customBandError('deficit', 0, 300)).toBe(null)
    expect(customBandError('surplus', 200, 400)).toBe(null)
    expect(customBandError('deficit', '', 300)).toMatch(/צריך/)
    expect(customBandError('deficit', 300, 200)).toMatch(/נמוך/)
    expect(customBandError('deficit', 300, 300)).toMatch(/נמוך/)
    expect(customBandError('deficit', -50, 300)).toMatch(/חיוביים/)
    expect(customBandError('deficit', 200, 1200)).toMatch(/גירעון של עד/)
    expect(customBandError('surplus', 200, 700)).toMatch(/עודף של עד/)
    expect(customBandError('deficit', NaN, 300)).toMatch(/צריך/)
  })

  it('mode decides the band; the custom band survives switching and phase changes', () => {
    const custom = { min: 200, max: 300 }
    expect(dayTarget({ calorieMode: 'custom', customDeficit: custom, deficitTarget: { min: 100, max: 300 } })).toEqual(custom)
    // automatic mode ignores the saved band but does not need it removed
    expect(dayTarget({ calorieMode: 'auto', customDeficit: custom, deficitTarget: { min: 300, max: 500 } })).toEqual({ min: 300, max: 500 })
    // older settings (no mode) = automatic, as before
    expect(dayTarget({ deficitTarget: { min: 100, max: 300 } })).toEqual({ min: 100, max: 300 })
    // custom without a valid band falls back to the phase instead of judging against nothing
    expect(dayTarget({ calorieMode: 'custom', customDeficit: { min: 300, max: 200 }, deficitTarget: { min: 100, max: 300 } })).toEqual({ min: 100, max: 300 })
    expect(dayTarget({ calorieMode: 'custom', deficitTarget: { min: 100, max: 300 } })).toEqual({ min: 100, max: 300 })
  })

  it('phase: stored, or derived from the band of older settings', () => {
    expect(phaseOf({ goalPhase: 'gain', deficitTarget: { min: 100, max: 300 } })).toBe('gain')
    expect(phaseOf({ deficitTarget: { min: 300, max: 500 } })).toBe('cut')
    expect(phaseOf({ deficitTarget: { min: 1, max: 2 } })).toBe('recomp')
  })

  it('what the band means in food today: burned − band', () => {
    expect(intakeRangeFor({ min: 200, max: 300 }, 2500)).toEqual({ min: 2200, max: 2300 })
    expect(intakeRangeFor({ min: -400, max: -200 }, 2500)).toEqual({ min: 2700, max: 2900 })
    expect(intakeRangeFor({ min: 200, max: 300 }, null)).toBe(null)
  })
})
