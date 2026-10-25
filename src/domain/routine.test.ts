import { describe, expect, it } from 'vitest'
import { healthDeviceOf, routineEnergy } from './routine'
import { dayEnergy } from './expenditure'

const p = { sex: 'male' as const, age: 20, heightCm: 162, weightKg: 60 }
const health = { active_kcal: 410, resting_kcal: 1550, health_as_of: '2026-10-26T12:00:00+02:00' }
const day = (phoneOnly: boolean, h: typeof health | null = health) =>
  dayEnergy({ date: '2026-10-25', profile: p, steps: 7415, workouts: [], health: h, intake: { protein_g: 0, carbs_g: 0, fat_g: 0 }, phoneOnly, now: new Date('2026-10-26T12:00:00+02:00') })

describe('daily routine (getting up, teeth, shower, dressing)', () => {
  it('is calculated from METs: (MET − 1) × kg × hours', () => {
    const r = routineEnergy({ weightKg: 60 })
    // bed 2.3·60·3/60 = 6.9 · grooming 1·60·6/60 = 6 · shower 1·60·10/60 = 10 · dressing 1.5·60·6/60 = 9
    expect(r.kcal).toBeCloseTo(31.9, 1)
    expect(r.items.map((a) => a.id)).toEqual(['bed', 'grooming', 'shower', 'dressing'])
    expect(routineEnergy({ weightKg: 90 }).kcal).toBeCloseTo(31.9 * 1.5, 1) // scales with body weight
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
