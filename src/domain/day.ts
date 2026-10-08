import { dailyBurn, isValidProfile, type DailyBurnBreakdown, type ExerciseInput, type Profile } from './energy'
import { DEFAULT_TARGET, evaluateGoal, isDayFinal, type DeficitTarget, type GoalResult } from './goal'
import type { Exercise, FoodEntry } from '../data/types'

export interface DaySummary {
  date: string
  eaten: number
  protein: number
  fat: number
  carbs: number
  burn: DailyBurnBreakdown | null
  burned: number
  steps: number
  hasFood: boolean
  pendingCount: number
  goal: GoalResult | null
  proteinTarget: number
  proteinMet: boolean
  target: DeficitTarget
}

export function toExerciseInput(e: Exercise): ExerciseInput {
  return { type: e.type, durationMin: e.duration_min, distanceKm: e.distance_km, intensity: e.intensity, rest: e.rest, muscles: e.muscles, volumeKg: e.volume_kg, lifts: e.lifts }
}

export function summarizeDay(opts: {
  date: string
  food: FoodEntry[]
  exercises: Exercise[]
  steps: number
  profile: Profile | null
  proteinTarget: number
  /** personal daily target band (defaults to 100–300 kcal deficit) */
  target?: DeficitTarget
  now?: Date
}): DaySummary {
  const target = opts.target ?? DEFAULT_TARGET
  const ok = opts.food.filter((f) => f.status === 'ok')
  const sum = (k: 'calories' | 'protein_g' | 'fat_g' | 'carbs_g') => ok.reduce((s, f) => s + (f.totals[k] ?? 0), 0)
  const eaten = Math.round(sum('calories'))
  const protein = Math.round(sum('protein_g'))
  const burn = isValidProfile(opts.profile) ? dailyBurn(opts.profile, opts.steps, opts.exercises.map(toExerciseInput)) : null
  const burned = burn?.total ?? 0
  const hasFood = ok.length > 0
  return {
    date: opts.date,
    eaten,
    protein,
    fat: Math.round(sum('fat_g')),
    carbs: Math.round(sum('carbs_g')),
    burn,
    burned,
    steps: opts.steps,
    hasFood,
    pendingCount: opts.food.length - ok.length,
    goal: burn ? evaluateGoal({ eaten, burned, hasFood, dayFinal: isDayFinal(opts.date, opts.now), target }) : null,
    proteinTarget: opts.proteinTarget,
    proteinMet: protein >= opts.proteinTarget,
    target,
  }
}
