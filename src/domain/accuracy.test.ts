/**
 * Independent checks of the energy model: every expected value here is worked out by hand from a
 * published equation (Mifflin-St Jeor, the ACSM metabolic equations, the Compendium MET equation,
 * macronutrient TEF ranges) — not by calling the function under test with other inputs.
 */
import { describe, expect, it } from 'vitest'
import { bmrMifflinStJeor, dailyBurn, exerciseNetKcal, stepsNetKcal, strideMeters, workoutEstimate } from './energy'
import { dayEnergy, foodTef, projectResting } from './expenditure'

const eithan = { sex: 'male' as const, age: 20, heightCm: 160, weightKg: 60 }
const woman = { sex: 'female' as const, age: 30, heightCm: 165, weightKg: 60 }

describe('BMR — Mifflin-St Jeor by hand', () => {
  it('man 20 y, 160 cm, 60 kg: 10·60 + 6.25·160 − 5·20 + 5 = 1,505', () => expect(bmrMifflinStJeor(eithan)).toBe(1505))
  it('woman 30 y, 165 cm, 60 kg: 600 + 1,031.25 − 150 − 161 = 1,320.25', () => expect(bmrMifflinStJeor(woman)).toBeCloseTo(1320.25, 6))
  it('each kg adds 10 kcal, each cm 6.25, each year −5', () => {
    expect(bmrMifflinStJeor({ ...eithan, weightKg: 61 }) - 1505).toBe(10)
    expect(bmrMifflinStJeor({ ...eithan, heightCm: 162 }) - 1505).toBe(12.5)
    expect(bmrMifflinStJeor({ ...eithan, age: 21 }) - 1505).toBe(-5)
  })
})

describe('walking — ACSM: net VO₂ = 0.1 ml/kg per metre (≈ 0.5 kcal/kg/km at 5 kcal per litre O₂)', () => {
  it('10,000 steps at 160 cm (stride 0.664 m) = 6.64 km → 6.64 × 60 × 0.5 = 199.2 kcal', () => {
    expect(strideMeters(eithan)).toBeCloseTo(0.664, 3)
    // ACSM by hand: 6,640 m × 0.1 ml/kg/m × 60 kg = 39.84 L O₂ × 5 kcal/L
    expect(stepsNetKcal(10_000, eithan)).toBeCloseTo((6640 * 0.1 * 60 * 5) / 1000, 1)
  })
  it('a logged 5 km walk = 5 km of steps (150 kcal net), whatever the time typed', () => {
    expect(exerciseNetKcal({ type: 'walk', distanceKm: 5, durationMin: 60 }, eithan)).toBeCloseTo(150, 6)
    expect(exerciseNetKcal({ type: 'walk', distanceKm: 5, durationMin: 50 }, eithan)).toBeCloseTo(150, 6)
  })
  it('a 30-minute walk by time (MET 3.5): (3.5 × 3.5 × 60 / 200 − 1,505 / 1,440) × 30 ≈ 79 kcal; ACSM at 4.8 km/h gives 72', () => {
    const net = exerciseNetKcal({ type: 'walk', durationMin: 30, intensity: 'moderate' }, eithan)
    expect(net).toBeCloseTo((3.5 * 3.5 * 60) / 200 * 30 - (1505 / 1440) * 30, 6)
    expect(net).toBeGreaterThan(72 * 0.9)
    expect(net).toBeLessThan(72 * 1.2)
  })
})

describe('running — measured net cost 0.87 (Cureton/Williams) … 1.0 (ACSM) kcal/kg/km', () => {
  it('5 km in 30 min at 60 kg: between 261 and 300 kcal net', () => {
    const net = exerciseNetKcal({ type: 'run', distanceKm: 5, durationMin: 30 }, eithan)
    expect(net).toBeCloseTo(5 * 60 - (1505 / 1440) * 30, 6) // 300 gross − 31 rest = 269
    expect(net).toBeGreaterThan(0.87 * 5 * 60)
    expect(net).toBeLessThan(1.0 * 5 * 60)
  })
  it('per km nearly independent of speed: 10 km in 50 vs 70 min differ only by the rest during the run', () => {
    const fast = exerciseNetKcal({ type: 'run', distanceKm: 10, durationMin: 50 }, eithan)
    const slow = exerciseNetKcal({ type: 'run', distanceKm: 10, durationMin: 70 }, eithan)
    expect(fast - slow).toBeCloseTo((1505 / 1440) * 20, 6)
    expect(fast / slow).toBeLessThan(1.05)
  })
  it('a heavier runner burns proportionally more for the same distance', () => {
    const a = workoutEstimate({ type: 'run', distanceKm: 5, durationMin: 30 }, eithan).gross
    const b = workoutEstimate({ type: 'run', distanceKm: 5, durationMin: 30 }, { ...eithan, weightKg: 90 }).gross
    expect(b / a).toBeCloseTo(1.5, 6)
  })
})

describe('strength — Compendium session MET', () => {
  it('60 min moderate (02052, MET 5.0) at 60 kg: (5 × 3.5 × 60 / 200 − 1,505 / 1,440) × 60 ≈ 252 kcal', () => {
    expect(exerciseNetKcal({ type: 'strength', durationMin: 60, intensity: 'moderate' }, eithan)).toBeCloseTo(315 - (1505 / 1440) * 60, 6)
  })
})

describe('thermic effect of food — protein 20–30%, carbs 5–10%, fat 0–3% of their energy', () => {
  it('120 g P · 200 g C · 60 g F: 120 + 60 + 10.8 = 190.8 kcal, 10.5% of the 1,820 eaten', () => {
    expect(foodTef({ protein_g: 120, carbs_g: 200, fat_g: 60 })).toBeCloseTo(190.8, 6)
    // whole range by hand: 0.2·480 + 0.05·800 + 0·540 = 136 … 0.3·480 + 0.1·800 + 0.03·540 = 240.2
    const t = foodTef({ protein_g: 120, carbs_g: 200, fat_g: 60 })
    expect(t).toBeGreaterThan(136)
    expect(t).toBeLessThan(240.2)
  })
})

describe('a whole day without Apple Health (estimate model)', () => {
  it('7,000 steps, no workouts: (1,505 + 75.25 + 139.4) × 1.10 ≈ 1,892 — a sedentary-to-light day (PAL ≈ 1.26)', () => {
    const d = dailyBurn(eithan, 7000, [])
    const byHand = (1505 + 1505 * 0.05 + stepsNetKcal(7000, eithan)) * 1.1
    expect(d.total).toBe(Math.round(byHand))
    expect(d.total / 1505).toBeGreaterThan(1.2)
    expect(d.total / 1505).toBeLessThan(1.4)
  })
})

describe('a whole day with Apple Health: nothing counted twice', () => {
  const D = '2026-11-02'
  it('resting + active (Apple) + digestion; the imported run is inside Active Energy, not added', () => {
    const run = { id: 'r', origin: 'apple_health' as const, input: { type: 'run' as const, distanceKm: 5, durationMin: 30 }, reportedKcal: 290, startedAt: `${D}T07:00:00`, endedAt: `${D}T07:30:00` }
    const e = dayEnergy({ date: D, profile: eithan, steps: 10032, workouts: [run], health: { resting_kcal: 1559, active_kcal: 403, health_as_of: `${D}T23:59:00` }, intake: { protein_g: 120, carbs_g: 200, fat_g: 60 }, now: new Date('2026-11-03T08:00:00') })
    expect(e.total).toBe(Math.round(1559 + 403 + 190.8))
    expect(e.workouts[0].counting).toBe('included_in_active')
  })
  it('half a day of resting energy is doubled, not taken as the whole day; 23:30 misses half an hour', () => {
    expect(projectResting(760, 720, 1505)).toBeCloseTo(1520, 6)
    expect(projectResting(1480, 1410, 1505)).toBeCloseTo(1480 * 1440 / 1410, 6)
  })
})
