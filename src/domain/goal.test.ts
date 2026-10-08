import { describe, expect, it } from 'vitest'
import { addDays, evaluateGoal, isDayFinal, toDateKey } from './goal'

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
