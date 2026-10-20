import { isValidProfile, type DailyBurnBreakdown, type ExerciseInput, type Profile } from './energy'
import { dayEnergy, type DayEnergy, type DayWorkout, type HealthEnergyDay } from './expenditure'
import { DEFAULT_TARGET, evaluateGoal, evaluateIntake, intakeRangeFor, isDayFinal, type DayTarget, type DeficitTarget, type GoalResult, type KcalRange } from './goal'
import type { Exercise, FoodEntry } from '../data/types'

export interface DaySummary {
  date: string
  eaten: number
  protein: number
  fat: number
  carbs: number
  /** the estimate model's breakdown (BMR, steps, workouts, TEF) */
  burn: DailyBurnBreakdown | null
  /** resting / active / workouts / total — Apple Health when available, otherwise the estimate */
  energy: DayEnergy | null
  /** full-day calories burned used for the balance (= energy.total) */
  burned: number
  steps: number
  hasFood: boolean
  pendingCount: number
  goal: GoalResult | null
  /** the day's target intake in kcal (custom range, or burned − band); null when unknown */
  intakeRange: KcalRange | null
  proteinTarget: number
  proteinMet: boolean
  target: DayTarget
}

export function toExerciseInput(e: Exercise): ExerciseInput {
  return { type: e.type, durationMin: e.duration_min, distanceKm: e.distance_km, intensity: e.intensity, rest: e.rest, muscles: e.muscles, volumeKg: e.volume_kg, lifts: e.lifts }
}

export function toDayWorkout(e: Exercise): DayWorkout {
  return {
    id: e.id,
    input: toExerciseInput(e),
    origin: e.origin === 'apple_health' ? 'apple_health' : 'manual',
    startedAt: e.started_at,
    endedAt: e.ended_at,
    reportedKcal: e.reported_kcal,
    outsideHealth: e.outside_health,
    sourceApp: e.source_app,
  }
}

export function summarizeDay(opts: {
  date: string
  food: FoodEntry[]
  exercises: Exercise[]
  steps: number
  /** the day's Apple Health energy snapshot, if any */
  health?: HealthEnergyDay | null
  profile: Profile | null
  proteinTarget: number
  /** what the day is judged against: a deficit band (automatic) or a fixed intake range (custom); default 100–300 deficit */
  target?: DayTarget | DeficitTarget
  now?: Date
}): DaySummary {
  const t = opts.target ?? DEFAULT_TARGET
  const target: DayTarget = 'kind' in t ? (t as DayTarget) : { kind: 'deficit', min: t.min, max: t.max }
  const ok = opts.food.filter((f) => f.status === 'ok')
  const sum = (k: 'calories' | 'protein_g' | 'fat_g' | 'carbs_g') => ok.reduce((s, f) => s + (f.totals[k] ?? 0), 0)
  const eaten = Math.round(sum('calories'))
  const protein = Math.round(sum('protein_g'))
  const intake = { protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g') }
  const energy = isValidProfile(opts.profile)
    ? dayEnergy({ date: opts.date, profile: opts.profile, steps: opts.steps, workouts: opts.exercises.map(toDayWorkout), health: opts.health, intake, now: opts.now })
    : null
  const burn = energy?.estimate ?? null
  const burned = energy?.total ?? 0
  const hasFood = ok.length > 0
  return {
    date: opts.date,
    eaten,
    protein,
    fat: Math.round(sum('fat_g')),
    carbs: Math.round(sum('carbs_g')),
    burn,
    energy,
    burned,
    steps: opts.steps,
    hasFood,
    pendingCount: opts.food.length - ok.length,
    // a custom range needs no burn estimate; the automatic band does
    goal:
      target.kind === 'intake'
        ? evaluateIntake({ eaten, burned: burn ? burned : null, hasFood, dayFinal: isDayFinal(opts.date, opts.now), range: target })
        : burn
          ? evaluateGoal({ eaten, burned, hasFood, dayFinal: isDayFinal(opts.date, opts.now), target })
          : null,
    intakeRange: intakeRangeFor(target, burn ? burned : null),
    proteinTarget: opts.proteinTarget,
    proteinMet: protein >= opts.proteinTarget,
    target,
  }
}
