import { describe, expect, it } from 'vitest'
import {
  bmrMifflinStJeor,
  dailyBurn,
  estimateWorkoutSteps,
  exerciseNetKcal,
  isValidProfile,
  KCAL_PER_KG_LIFTED,
  metKcalPerMin,
  muscleMassFactor,
  volumeKcal,
  paceSecPerKm,
  restingKcalPerMin,
  runMetForSpeed,
  stepsNetKcal,
  strideMeters,
  workoutDisplay,
  workoutDisplayKcal,
  workoutEstimate,
  type ExerciseInput,
  type Profile,
} from './energy'

const man: Profile = { sex: 'male', age: 30, heightCm: 180, weightKg: 80 }
const woman: Profile = { sex: 'female', age: 35, heightCm: 165, weightKg: 62 }
const restMan = 1780 / 1440 // kcal/min

describe('BMR — Mifflin-St Jeor', () => {
  it('matches the published equation for men', () => {
    // 10·80 + 6.25·180 − 5·30 + 5 = 1780
    expect(bmrMifflinStJeor(man)).toBe(1780)
  })
  it('matches the published equation for women', () => {
    // 10·62 + 6.25·165 − 5·35 − 161 = 1315.25
    expect(bmrMifflinStJeor(woman)).toBeCloseTo(1315.25, 2)
  })
  it('resting kcal/min is BMR / 1440', () => {
    expect(restingKcalPerMin(man)).toBeCloseTo(restMan, 6)
  })
})

describe('MET equation', () => {
  it('kcal/min = MET × 3.5 × kg / 200', () => {
    expect(metKcalPerMin(5, 80)).toBeCloseTo(7, 6)
    expect(metKcalPerMin(1, 70)).toBeCloseTo(1.225, 6)
  })
})

describe('steps', () => {
  it('uses height-based stride', () => {
    expect(strideMeters(man)).toBeCloseTo(0.747, 3)
  })
  it('costs ~0.5 kcal/kg/km net', () => {
    // 10,000 steps × 0.747 m = 7.47 km × 80 kg × 0.5 = 298.8
    expect(stepsNetKcal(10_000, man)).toBeCloseTo(298.8, 1)
  })
  it('returns 0 for missing / negative steps', () => {
    expect(stepsNetKcal(0, man)).toBe(0)
    expect(stepsNetKcal(-5, man)).toBe(0)
    expect(stepsNetKcal(Number.NaN, man)).toBe(0)
  })
})

describe('running', () => {
  it('with a distance: ~1 kcal/kg/km gross minus this person’s resting energy', () => {
    // 5 km × 80 kg = 400 gross; rest 25 min × 1.236 = 30.9 → 369.1
    expect(exerciseNetKcal({ type: 'run', distanceKm: 5, durationMin: 25 }, man)).toBeCloseTo(400 - 25 * restMan, 1)
  })
  it('a 5 km run for a 65 kg runner is ~300 kcal', () => {
    const k = workoutDisplayKcal({ type: 'run', distanceKm: 5, durationMin: 25 }, { ...man, weightKg: 65 })
    expect(k).toBeGreaterThanOrEqual(290)
    expect(k).toBeLessThanOrEqual(320)
  })
  it('falls back to MET when only time is given', () => {
    // moderate MET 9.8 → 9.8 × 3.5 × 80 / 200 = 13.72 kcal/min × 30 − rest
    expect(exerciseNetKcal({ type: 'run', durationMin: 30 }, man)).toBeCloseTo(13.72 * 30 - 30 * restMan, 1)
  })
  it('computes pace', () => {
    expect(paceSecPerKm({ type: 'run', distanceKm: 5, durationMin: 25 })).toBe(300)
    expect(paceSecPerKm({ type: 'run', distanceKm: 5 })).toBeNull()
  })
  it('interpolates running METs by speed', () => {
    expect(runMetForSpeed(5)).toBe(6)
    expect(runMetForSpeed(9.7)).toBeCloseTo(9.8)
    expect(runMetForSpeed(12)).toBeGreaterThan(11)
    expect(runMetForSpeed(30)).toBe(19)
  })
  it('estimates steps taken during the run or walk', () => {
    expect(estimateWorkoutSteps({ type: 'run', distanceKm: 5, durationMin: 25 }, man)).toBe(4000)
    expect(estimateWorkoutSteps({ type: 'run', distanceKm: 5 }, man)).toBeGreaterThan(3500)
    expect(estimateWorkoutSteps({ type: 'walk', durationMin: 30 }, man)).toBe(3300)
    expect(estimateWorkoutSteps({ type: 'strength', durationMin: 60 }, man)).toBe(0)
  })
})

describe('strength training', () => {
  const session = (o: Partial<ExerciseInput> = {}): ExerciseInput => ({ type: 'strength', durationMin: 60, intensity: 'moderate', ...o })

  it('uses Compendium session METs: (MET × 3.5 × kg / 200 − resting) × minutes', () => {
    // moderate, standard rests → 5.0 MET → 7.0 kcal/min gross
    expect(exerciseNetKcal(session(), man)).toBeCloseTo((7.0 - restMan) * 60, 1)
    // vigorous → 6.0 MET → 8.4 kcal/min
    expect(exerciseNetKcal(session({ durationMin: 75, intensity: 'high' }), man)).toBeCloseTo((8.4 - restMan) * 75, 1)
  })

  it('a typical 60–75 min session lands in a realistic range (not "1 workout = X")', () => {
    const k = exerciseNetKcal(session({ durationMin: 75 }), man)
    expect(k).toBeGreaterThan(300)
    expect(k).toBeLessThan(550)
  })

  it('intensity matters: light < moderate < vigorous', () => {
    const l = exerciseNetKcal(session({ intensity: 'low' }), man)
    const m = exerciseNetKcal(session({ intensity: 'moderate' }), man)
    const h = exerciseNetKcal(session({ intensity: 'high' }), man)
    expect(l).toBeLessThan(m)
    expect(m).toBeLessThan(h)
  })

  it('short rests (supersets / circuit) are denser than standard rests', () => {
    expect(exerciseNetKcal(session({ rest: 'short' }), man)).toBeGreaterThan(exerciseNetKcal(session({ rest: 'standard' }), man))
    expect(exerciseNetKcal(session({ rest: 'short', intensity: 'high' }), man)).toBeGreaterThan(exerciseNetKcal(session({ intensity: 'high' }), man))
  })

  it('scales with duration', () => {
    const a = exerciseNetKcal(session({ durationMin: 30 }), man)
    const b = exerciseNetKcal(session({ durationMin: 90 }), man)
    expect(b / a).toBeCloseTo(3, 6)
  })

  it('scales with the user’s body weight', () => {
    const light = exerciseNetKcal(session(), { ...man, weightKg: 60 })
    const heavy = exerciseNetKcal(session(), { ...man, weightKg: 90 })
    expect(heavy).toBeGreaterThan(light)
    expect(heavy / light).toBeGreaterThan(1.4)
    expect(heavy / light).toBeLessThan(1.6)
  })

  it('uses age and sex through the person’s own resting rate', () => {
    const young = workoutEstimate(session(), man)
    const older = workoutEstimate(session(), { ...man, age: 60 })
    const female = workoutEstimate(session(), { ...man, sex: 'female' })
    expect(older.gross).toBeCloseTo(young.gross, 6) // same work
    expect(older.net).toBeGreaterThan(young.net) // lower RMR → more of it is "above rest"
    expect(female.net).toBeGreaterThan(young.net)
  })

  it('muscle groups scale the session by active muscle mass (bounded ±10%)', () => {
    const base = exerciseNetKcal(session(), man)
    const legs = exerciseNetKcal(session({ muscles: ['legs', 'shoulders'] }), man)
    const upper = exerciseNetKcal(session({ muscles: ['chest', 'back'] }), man)
    const small = exerciseNetKcal(session({ muscles: ['arms', 'core'] }), man)
    expect(muscleMassFactor(['legs'])).toBe(1.1)
    expect(muscleMassFactor(['arms', 'shoulders'])).toBe(0.9)
    expect(upper).toBeCloseTo(base, 6)
    expect(legs).toBeGreaterThan(base)
    expect(small).toBeLessThan(base)
    expect(legs / base).toBeLessThan(1.15)
    expect(small / base).toBeGreaterThan(0.85)
  })

  it('total volume adds its mechanical work: ≈0.0059 kcal per kg lifted', () => {
    expect(KCAL_PER_KG_LIFTED).toBeCloseTo((9.81 * 0.5) / 0.2 / 4184, 9)
    const base = exerciseNetKcal(session(), man)
    const v8 = workoutEstimate(session({ volumeKg: 8000 }), man)
    expect(v8.fromVolume).toBeCloseTo(8000 * KCAL_PER_KG_LIFTED, 6)
    expect(v8.fromVolume).toBeGreaterThan(40)
    expect(v8.fromVolume).toBeLessThan(55)
    expect(v8.net - base).toBeCloseTo(v8.fromVolume, 6)
    // doubling the load lifted does not double the workout — it's an add-on to the session estimate
    const v16 = exerciseNetKcal(session({ volumeKg: 16000 }), man)
    expect(v16 / v8.net).toBeLessThan(1.15)
  })

  it('volume is ignored for non-strength workouts and nonsense values', () => {
    expect(exerciseNetKcal({ type: 'cycling', durationMin: 60, volumeKg: 8000 }, man)).toBe(exerciseNetKcal({ type: 'cycling', durationMin: 60 }, man))
    expect(volumeKcal(-5)).toBe(0)
    expect(volumeKcal(Number.NaN)).toBe(0)
    expect(volumeKcal(10_000_000)).toBeCloseTo(volumeKcal(200_000), 6)
  })

  it('older per-exercise entries (lifts) do not change the estimate', () => {
    expect(exerciseNetKcal(session({ lifts: [{ id: 'a', name: 'bench', weight_kg: 100, sets: 4, reps: 3 }] }), man)).toBe(exerciseNetKcal(session(), man))
  })

  it('returns 0 without a duration', () => {
    expect(exerciseNetKcal({ type: 'strength' }, man)).toBe(0)
  })
})

describe('uncertainty & display', () => {
  it('every estimate comes with a range around it', () => {
    const e = workoutEstimate({ type: 'strength', durationMin: 60 }, man)
    expect(e.low).toBeLessThan(e.net)
    expect(e.high).toBeGreaterThan(e.net)
    const run = workoutEstimate({ type: 'run', distanceKm: 5, durationMin: 25 }, man)
    expect((run.high - run.low) / run.net).toBeLessThan((e.high - e.low) / e.net) // distance-based running is tighter
  })
  it('display values are rounded to 10 kcal (no false precision)', () => {
    const d = workoutDisplay({ type: 'strength', durationMin: 47, intensity: 'high' }, woman)
    for (const v of [d.kcal, d.low, d.high, d.gross]) expect(v % 10).toBe(0)
  })
  it('other activities use their MET tables', () => {
    const walk = exerciseNetKcal({ type: 'walk', durationMin: 60, intensity: 'moderate' }, man)
    const bike = exerciseNetKcal({ type: 'cycling', durationMin: 60, intensity: 'moderate' }, man)
    expect(walk).toBeGreaterThan(100)
    expect(bike).toBeGreaterThan(walk)
  })
})

describe('daily burn', () => {
  it('sedentary day is close to BMR × 1.2', () => {
    const b = dailyBurn(man, 3000, [])
    expect(b.total / 1780).toBeGreaterThan(1.17)
    expect(b.total / 1780).toBeLessThan(1.27)
  })
  it('active day (12k steps) is close to BMR × 1.375', () => {
    const b = dailyBurn(man, 12_000, [])
    expect(b.total / 1780).toBeGreaterThan(1.3)
    expect(b.total / 1780).toBeLessThan(1.45)
  })
  it('breakdown adds up', () => {
    const b = dailyBurn(man, 8000, [{ type: 'strength', durationMin: 60, intensity: 'moderate' }])
    expect(Math.abs(b.bmr + b.baseline + b.steps + b.exercise + b.tef - b.total)).toBeLessThanOrEqual(2)
  })
  it('changing body weight changes the daily total', () => {
    const a = dailyBurn(man, 8000, [{ type: 'strength', durationMin: 60 }])
    const b = dailyBurn({ ...man, weightKg: 90 }, 8000, [{ type: 'strength', durationMin: 60 }])
    expect(b.total - a.total).toBeGreaterThan(150)
  })
  it('does not double count steps taken during a run', () => {
    const run = { type: 'run' as const, distanceKm: 5, durationMin: 25 }
    const withRun = dailyBurn(man, 12_000, [run])
    const noRun = dailyBurn(man, 12_000, [])
    // run steps (4000) removed from step energy
    expect(withRun.stepsCounted).toBe(8000)
    // so the increase is smaller than the run's own net cost
    const runOnly = exerciseNetKcal(run, man) * 1.1
    expect(withRun.total - noRun.total).toBeLessThan(runOnly)
    expect(withRun.total - noRun.total).toBeGreaterThan(0)
  })
  it('never counts negative steps when a run exceeds logged steps', () => {
    const b = dailyBurn(man, 1000, [{ type: 'run', distanceKm: 10, durationMin: 50 }])
    expect(b.stepsCounted).toBe(0)
    expect(b.steps).toBe(0)
  })
  it('TEF is ~10% of the activity-inclusive total', () => {
    const b = dailyBurn(woman, 7000, [])
    expect(b.tef / (b.total - b.tef)).toBeCloseTo(0.1, 2)
  })
})

describe('profile validation', () => {
  it('accepts a sane profile and rejects junk', () => {
    expect(isValidProfile(man)).toBe(true)
    expect(isValidProfile({ ...man, age: 5 })).toBe(false)
    expect(isValidProfile({ ...man, heightCm: 1.8 })).toBe(false)
    expect(isValidProfile(null)).toBe(false)
  })
})
