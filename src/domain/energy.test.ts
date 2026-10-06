import { describe, expect, it } from 'vitest'
import {
  bmrMifflinStJeor,
  dailyBurn,
  estimateWorkoutSteps,
  exerciseNetKcal,
  isValidProfile,
  paceSecPerKm,
  runMetForSpeed,
  stepsNetKcal,
  strideMeters,
  workoutDisplayKcal,
  type Profile,
} from './energy'

const man: Profile = { sex: 'male', age: 30, heightCm: 180, weightKg: 80 }
const woman: Profile = { sex: 'female', age: 35, heightCm: 165, weightKg: 62 }

describe('BMR — Mifflin-St Jeor', () => {
  it('matches the published equation for men', () => {
    // 10·80 + 6.25·180 − 5·30 + 5 = 1780
    expect(bmrMifflinStJeor(man)).toBe(1780)
  })
  it('matches the published equation for women', () => {
    // 10·62 + 6.25·165 − 5·35 − 161 = 1315.25
    expect(bmrMifflinStJeor(woman)).toBeCloseTo(1315.25, 2)
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
  it('uses distance when available (≈0.95 kcal/kg/km net)', () => {
    expect(exerciseNetKcal({ type: 'run', distanceKm: 5, durationMin: 25 }, man)).toBeCloseTo(380, 0)
  })
  it('a 5 km run for a 65 kg runner is ~300 kcal', () => {
    const k = workoutDisplayKcal({ type: 'run', distanceKm: 5, durationMin: 25 }, { ...man, weightKg: 65 })
    expect(k).toBeGreaterThanOrEqual(290)
    expect(k).toBeLessThanOrEqual(320)
  })
  it('falls back to MET when only time is given', () => {
    // moderate MET 9.8 → net 8.8 × 80 × 0.5 h = 352
    expect(exerciseNetKcal({ type: 'run', durationMin: 30 }, man)).toBeCloseTo(352, 0)
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
  it('estimates steps taken during the run', () => {
    expect(estimateWorkoutSteps({ type: 'run', distanceKm: 5, durationMin: 25 }, man)).toBe(4000)
    expect(estimateWorkoutSteps({ type: 'run', distanceKm: 5 }, man)).toBeGreaterThan(3500)
    expect(estimateWorkoutSteps({ type: 'strength', durationMin: 60 }, man)).toBe(0)
  })
})

describe('strength training', () => {
  it('uses (MET − 1) × kg × h', () => {
    // high MET 5.0 → 4 × 80 × 1.25 = 400
    expect(exerciseNetKcal({ type: 'strength', durationMin: 75, intensity: 'high' }, man)).toBeCloseTo(400)
    // moderate 3.5 → 2.5 × 80 × 1 = 200
    expect(exerciseNetKcal({ type: 'strength', durationMin: 60, intensity: 'moderate' }, man)).toBeCloseTo(200)
  })
  it('scales with body weight', () => {
    const light = exerciseNetKcal({ type: 'strength', durationMin: 60 }, { ...man, weightKg: 60 })
    const heavy = exerciseNetKcal({ type: 'strength', durationMin: 60 }, { ...man, weightKg: 90 })
    expect(heavy / light).toBeCloseTo(1.5)
  })
  it('returns 0 without a duration', () => {
    expect(exerciseNetKcal({ type: 'strength' }, man)).toBe(0)
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
