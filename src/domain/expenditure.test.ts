import { describe, expect, it } from 'vitest'
import { bmrMifflinStJeor, dailyBurn, workoutEstimate, type Profile } from './energy'
import { dayEnergy, findDuplicates, foodTef, projectResting, type DayWorkout } from './expenditure'
import type { FoodEntry } from '../data/types'
import { summarizeDay } from './day'

// the user's own numbers: ~61 kg, 162 cm (age assumed 25 for the tests)
const me: Profile = { sex: 'male', age: 25, heightCm: 162, weightKg: 61 }
const BMR = bmrMifflinStJeor(me) // 10·61 + 6.25·162 − 5·25 + 5 = 1502.5
const at = (d: string, hm: string) => {
  const [y, m, day] = d.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  return new Date(y, m - 1, day, h, mi)
}
const iso = (d: string, hm: string) => at(d, hm).toISOString()
const D = '2026-10-11'

const run = (id: string, o: Partial<DayWorkout> = {}): DayWorkout => ({
  id, origin: 'apple_health', input: { type: 'run', durationMin: 30, distanceKm: 5 },
  startedAt: iso(D, '18:00'), endedAt: iso(D, '18:30'), reportedKcal: 330, sourceApp: 'Apple Watch', ...o,
})
const strength = (id: string, o: Partial<DayWorkout> = {}): DayWorkout => ({
  id, origin: 'manual', input: { type: 'strength', durationMin: 60, intensity: 'moderate' }, ...o,
})

describe('BMR for the user profile', () => {
  it('Mifflin-St Jeor', () => expect(BMR).toBeCloseTo(1502.5, 1))
})

describe('estimate mode (no Apple Health energy)', () => {
  it('is exactly the original model when there are no imported workouts', () => {
    const workouts = [strength('s1')]
    const e = dayEnergy({ date: D, profile: me, steps: 8000, workouts, now: at(D, '21:00') })
    const legacy = dailyBurn(me, 8000, workouts.map((w) => w.input))
    expect(e.mode).toBe('estimate')
    expect(e.total).toBe(legacy.total)
    expect(e.estimate).toEqual(legacy)
    // the rows on screen add up to the total
    expect(Math.abs(e.resting.kcal + e.active.kcal + e.tef - e.total)).toBeLessThanOrEqual(2)
  })

  it('a day with steps but no energy fields stays an estimate', () => {
    const e = dayEnergy({ date: D, profile: me, steps: 5000, workouts: [], health: { active_kcal: null, resting_kcal: null }, now: at(D, '21:00') })
    expect(e.mode).toBe('estimate')
  })

  it('an imported workout counts once, with its own Apple energy', () => {
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [run('r1')], now: at(D, '21:00') })
    expect(e.estimate.exercise).toBe(330)
    expect(e.workouts[0]).toMatchObject({ kcalSource: 'imported', counting: 'added', kcal: 330 })
  })

  it('steps taken during an imported run are not counted again', () => {
    const withRun = dayEnergy({ date: D, profile: me, steps: 10000, workouts: [run('r1')], now: at(D, '21:00') })
    expect(withRun.estimate.stepsCounted).toBeLessThan(10000)
  })
})

describe('Apple Health mode', () => {
  it('complete past day: total = resting + active; workouts are inside active, never added', () => {
    const e = dayEnergy({
      date: D, profile: me, steps: 9000, workouts: [run('r1'), strength('s1')],
      health: { resting_kcal: 1480, active_kcal: 620, health_as_of: iso('2026-10-12', '00:10') },
      now: at('2026-10-12', '09:00'),
    })
    expect(e.mode).toBe('health')
    expect(e.partial).toBe(false)
    expect(e.total).toBe(2100)
    expect(e.soFar).toBe(2100)
    expect(e.tef).toBe(0)
    expect(e.workouts.find((w) => w.id === 'r1')?.counting).toBe('included_in_active')
    expect(e.workouts.find((w) => w.id === 's1')?.counting).toBe('included_in_active')
  })

  it('no BMR is added on top of Apple resting energy', () => {
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [], health: { resting_kcal: 1480, active_kcal: 0, health_as_of: iso(D, '23:55') }, now: at('2026-10-12', '08:00') })
    expect(e.total).toBe(1480)
  })

  it('partial day: resting projected to 24 h, active as measured so far', () => {
    const e = dayEnergy({ date: D, profile: me, steps: 4000, workouts: [], health: { resting_kcal: 750, active_kcal: 300, health_as_of: iso(D, '12:00') }, now: at(D, '12:10') })
    expect(e.partial).toBe(true)
    expect(e.coverageMinutes).toBe(720)
    expect(e.resting.fullDay).toBe(1500)
    expect(e.soFar).toBe(1050)
    expect(e.total).toBe(1800)
  })

  it('early-morning projection is blended with BMR (not 24× a tiny sample)', () => {
    expect(projectResting(125, 120, BMR)).toBeCloseTo(0.5 * 1500 + 0.5 * BMR, 6)
    expect(projectResting(10, 0, BMR)).toBe(BMR)
    expect(projectResting(1480, 23 * 60 + 30, BMR)).toBe(1480)
  })

  it('a manual workout marked "not measured by Apple Health" is added; nothing else is', () => {
    const outside = strength('s2', { outsideHealth: true })
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [outside, strength('s3')], health: { resting_kcal: 1480, active_kcal: 400, health_as_of: iso(D, '23:59') }, now: at('2026-10-12', '08:00') })
    const est = Math.round(workoutEstimate(outside.input, me).net)
    expect(e.extra).toBe(est)
    expect(e.total).toBe(1480 + 400 + est)
    expect(e.workouts.find((w) => w.id === 's3')?.counting).toBe('included_in_active')
  })

  it('missing resting energy is filled with the BMR estimate (and labelled so)', () => {
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [], health: { active_kcal: 500, health_as_of: iso(D, '23:59') }, now: at('2026-10-12', '08:00') })
    expect(e.resting.source).toBe('estimate')
    expect(e.active.source).toBe('apple')
    expect(e.total).toBe(Math.round(BMR + 500))
  })

  it('missing active energy is estimated from steps and workouts (no double counting)', () => {
    const e = dayEnergy({ date: D, profile: me, steps: 6000, workouts: [run('r1')], health: { resting_kcal: 1480, health_as_of: iso(D, '23:59') }, now: at('2026-10-12', '08:00') })
    expect(e.active.source).toBe('estimate')
    expect(e.workouts[0].counting).toBe('added')
    expect(e.active.kcal).toBe(Math.round(e.estimate.baseline + e.estimate.steps + 330))
  })

  it('summarizeDay uses the Apple total for the balance', () => {
    const s = summarizeDay({
      date: D, food: [], exercises: [], steps: 0, profile: me, proteinTarget: 120,
      health: { resting_kcal: 1480, active_kcal: 620, health_as_of: iso(D, '23:58') }, now: at('2026-10-12', '08:00'),
    })
    expect(s.burned).toBe(2100)
    expect(s.energy?.mode).toBe('health')
  })
})

describe('digestion energy (TEF) in Apple Health mode', () => {
  it('per macro: protein 25%, carbs 7.5%, fat 2% of their calories', () => {
    // 28.5 g protein (114 kcal) → 28.5; 59.1 g carbs (236.4) → 17.7; 23.2 g fat (208.8) → 4.2
    expect(foodTef({ protein_g: 28.5, carbs_g: 59.1, fat_g: 23.2 })).toBeCloseTo(50.4, 1)
    expect(foodTef(null)).toBe(0)
    expect(foodTef({ protein_g: -5, carbs_g: Number.NaN, fat_g: 10 })).toBeCloseTo(1.8, 5)
  })

  it('is added on top of Apple resting + active, so protein-heavy days burn more', () => {
    const health = { resting_kcal: 1480, active_kcal: 620, health_as_of: iso(D, '23:58') }
    const now = at('2026-10-12', '08:00')
    const none = dayEnergy({ date: D, profile: me, steps: 0, workouts: [], health, now })
    const protein = dayEnergy({ date: D, profile: me, steps: 0, workouts: [], health, intake: { protein_g: 200, carbs_g: 0, fat_g: 0 }, now })
    const fat = dayEnergy({ date: D, profile: me, steps: 0, workouts: [], health, intake: { protein_g: 0, carbs_g: 0, fat_g: 89 }, now })
    expect(none.total).toBe(2100)
    expect(protein.tef).toBe(200)
    expect(protein.total).toBe(2300)
    expect(fat.tef).toBe(16) // ~800 kcal of fat → only 2%
    expect(protein.soFar - none.soFar).toBe(200)
  })

  it('summarizeDay passes the logged macros', () => {
    const food = [{ status: 'ok', totals: { calories: 574, protein_g: 28.5, carbs_g: 59.1, fat_g: 23.2 } }] as unknown as FoodEntry[]
    const s = summarizeDay({
      date: D, food, exercises: [], steps: 0, profile: me, proteinTarget: 120,
      health: { resting_kcal: 1480, active_kcal: 620, health_as_of: iso(D, '23:58') }, now: at('2026-10-12', '08:00'),
    })
    expect(s.energy?.tef).toBe(50)
    expect(s.burned).toBe(2150)
  })
})

describe('duplicates', () => {
  it('the same run from the watch and from Strava is counted once (the richer record wins)', () => {
    const watch = run('w')
    const strava = run('s', { sourceApp: 'Strava', reportedKcal: 320, startedAt: iso(D, '18:01'), endedAt: iso(D, '18:31') })
    const dup = findDuplicates([watch, strava])
    expect(dup.get('s')).toBe('w')
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [watch, strava], now: at(D, '21:00') })
    expect(e.workoutKcal).toBe(330)
    expect(e.estimate.exercise).toBe(330)
  })

  it('back-to-back workouts that do not overlap are both kept', () => {
    const a = run('a')
    const b = run('b', { startedAt: iso(D, '18:40'), endedAt: iso(D, '19:10') })
    expect(findDuplicates([a, b]).size).toBe(0)
  })

  it('a manual entry of an imported workout is not counted twice', () => {
    const imported = run('imp')
    const manual: DayWorkout = { id: 'man', origin: 'manual', input: { type: 'run', durationMin: 32, distanceKm: 5 } }
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [imported, manual], now: at(D, '21:00') })
    expect(e.workouts.find((w) => w.id === 'man')?.counting).toBe('duplicate')
    expect(e.estimate.exercise).toBe(330)
  })

  it('different kinds of workouts at the same time are not merged', () => {
    const a = run('a')
    const b: DayWorkout = { ...run('b'), input: { type: 'strength', durationMin: 30 }, reportedKcal: 120, sourceApp: 'Hevy' }
    expect(findDuplicates([a, b]).size).toBe(0)
  })
})

describe('honest workout numbers', () => {
  it('strength without a duration has no estimate (shown as "not enough data")', () => {
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [{ id: 'x', origin: 'apple_health', input: { type: 'strength' }, sourceApp: 'Hevy' }], now: at(D, '21:00') })
    expect(e.workouts[0]).toMatchObject({ kcal: null, kcalSource: 'none' })
    expect(e.workoutKcal).toBeNull()
  })
  it('imported Hevy strength without Apple energy is estimated from duration × MET, not from kg lifted', () => {
    const w: DayWorkout = { id: 'h', origin: 'apple_health', input: { type: 'strength', durationMin: 60, volumeKg: 8000 }, sourceApp: 'Hevy' }
    const e = dayEnergy({ date: D, profile: me, steps: 0, workouts: [w], now: at(D, '21:00') })
    expect(e.workouts[0].kcalSource).toBe('estimated')
    // 60 min, 5.0 MET, 61 kg: (5 × 3.5 × 61 / 200 − 1502.5 / 1440) × 60 ≈ 258, + 8,000 kg × 0.0059 ≈ 47
    expect(e.workouts[0].kcal).toBe(Math.round(workoutEstimate(w.input, me).net / 10) * 10)
  })
})
