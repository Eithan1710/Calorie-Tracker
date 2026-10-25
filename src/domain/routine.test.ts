import { describe, expect, it } from 'vitest'
import { healthDeviceOf, routineEnergy } from './routine'
import { dayEnergy } from './expenditure'

const p = { sex: 'male' as const, age: 20, heightCm: 162, weightKg: 60 }
const health = { active_kcal: 410, resting_kcal: 1550, health_as_of: '2026-10-25T12:00:00+02:00' }
const day = (phoneOnly: boolean, h: typeof health | null = health) =>
  dayEnergy({ date: '2026-10-24', profile: p, steps: 7415, workouts: [], health: h, intake: { protein_g: 0, carbs_g: 0, fat_g: 0 }, phoneOnly, now: new Date('2026-10-25T12:00:00+02:00') })

describe('daily routine (getting up, teeth, shower, dressing)', () => {
  it('is calculated from METs: (MET − 1) × kg × hours', () => {
    // Saturday: bed 2.3·60·3/60 = 6.9 · grooming 1·60·6/60 = 6 · shower 1·60·10/60 = 10 · dressing 1.5·60·6/60 = 9
    const sat = routineEnergy({ weightKg: 60 }, '2026-10-24')
    expect(sat.kcal).toBeCloseTo(31.9, 1)
    expect(sat.items.map((a) => a.id)).toEqual(['bed', 'grooming', 'shower', 'dressing'])
    expect(routineEnergy({ weightKg: 90 }, '2026-10-24').kcal).toBeCloseTo(31.9 * 1.5, 1) // scales with body weight
  })

  it('office: 9 h at a computer (MET 1.5) on Sunday–Thursday only', () => {
    const sun = routineEnergy({ weightKg: 60 }, '2026-10-25')
    expect(sun.items.map((a) => a.id)).toContain('office')
    expect(sun.kcal).toBeCloseTo(31.9 + 0.5 * 60 * 9, 1) // + 270
    expect(routineEnergy({ weightKg: 60 }, '2026-10-29').items.some((a) => a.id === 'office')).toBe(true) // Thursday
    expect(routineEnergy({ weightKg: 60 }, '2026-10-30').items.some((a) => a.id === 'office')).toBe(false) // Friday
    expect(routineEnergy({ weightKg: 60 }, '2026-10-31').items.some((a) => a.id === 'office')).toBe(false) // Saturday
  })

  it('"so far": office hours count as they pass (08:00–17:00), the short routine from the start', () => {
    const at = (h: number) => routineEnergy({ weightKg: 60 }, '2026-10-25', h * 60).soFar
    expect(at(7)).toBeCloseTo(31.9, 1)
    expect(at(12.5)).toBeCloseTo(31.9 + 270 * 0.5, 1)
    expect(at(18)).toBeCloseTo(301.9, 1)
  })

  it('is added on top of Active Energy from an iPhone alone — once', () => {
    const phone = day(true)
    const watch = day(false)
    expect(phone.routine).toBe(32)
    expect(watch.routine).toBe(0)
    expect(phone.total - watch.total).toBe(32)
    expect(phone.soFar - watch.soFar).toBe(32)
    // Apple's numbers themselves are untouched
    expect(phone.active.kcal).toBe(410)
    expect(phone.resting.fullDay).toBe(1550)
  })

  it('is never added in the estimate model (its baseline-movement term already covers it)', () => {
    const est = day(true, null)
    expect(est.mode).toBe('estimate')
    expect(est.routine).toBe(0)
    expect(est.total).toBe(day(false, null).total)
  })

  it('device: the setting wins; otherwise a workout from an Apple Watch means a watch', () => {
    expect(healthDeviceOf({}, [])).toBe('phone')
    expect(healthDeviceOf({}, [{ source_app: 'Hevy' }])).toBe('phone')
    expect(healthDeviceOf({}, [{ source_app: 'Apple Watch' }])).toBe('watch')
    expect(healthDeviceOf({ healthDevice: 'phone' }, [{ source_app: 'Apple Watch' }])).toBe('phone')
    expect(healthDeviceOf({ healthDevice: 'watch' }, [])).toBe('watch')
  })
})
