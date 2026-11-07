import { isValidProfile, type DailyBurnBreakdown, type ExerciseInput, type Profile } from './energy'
import { dayEnergy, type DayEnergy, type DayWorkout, type HealthEnergyDay } from './expenditure'
import type { RoutineContext } from './routine'
import { DEFAULT_TARGET, evaluateGoal, isDayFinal, type DeficitTarget, type GoalResult } from './goal'
import type { Exercise, FoodEntry, WeightEntry } from '../data/types'

export interface DaySummary {
  date: string
  eaten: number
  protein: number
  fat: number
  carbs: number
  /** dietary fibre (g) from the foods that have a fibre value */
  fiber: number
  /** share of the day's calories whose fibre is known (0–1): below ~0.8 the fibre number is partial */
  fiberCoverage: number
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
  proteinTarget: number
  proteinMet: boolean
  target: DeficitTarget
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
  /** personal daily target band (defaults to 100–300 kcal deficit) */
  target?: DeficitTarget
  /** iPhone alone + weekly work schedule (see routine.ts) */
  routine?: RoutineContext | null
  /** the weight log: a past day is costed with the weight of that time, not today's */
  weights?: Record<string, WeightEntry>
  now?: Date
}): DaySummary {
  const target = opts.target ?? DEFAULT_TARGET
  const ok = opts.food.filter((f) => f.status === 'ok')
  const sum = (k: 'calories' | 'protein_g' | 'fat_g' | 'carbs_g') => ok.reduce((s, f) => s + (f.totals[k] ?? 0), 0)
  const eaten = Math.round(sum('calories'))
  const protein = Math.round(sum('protein_g'))
  const intake = { protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g') }
  const fib = fiberOf(ok)
  const profile = profileOnDate(opts.profile, opts.weights, opts.date)
  const energy = isValidProfile(profile)
    ? dayEnergy({ date: opts.date, profile, steps: opts.steps, workouts: opts.exercises.map(toDayWorkout), health: opts.health, intake, routine: opts.routine, now: opts.now })
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
    fiber: Math.round(fib.grams),
    fiberCoverage: fib.coverage,
    burn,
    energy,
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

/**
 * Fibre isn't kept on each item's totals; it comes from the item's per-100 g values (food tables
 * have it, an AI estimate or a label read from a photo usually doesn't). Coverage = the share of
 * calories from items whose fibre is known, so a partial number is never shown as complete.
 */
export function fiberOf(entries: FoodEntry[]): { grams: number; coverage: number } {
  let grams = 0
  let known = 0
  let kcal = 0
  for (const e of entries) {
    for (const it of e.items ?? []) {
      const c = Math.max(0, it.calories ?? 0)
      kcal += c
      const f = it.per100?.fiber_g
      if (typeof f === 'number' && Number.isFinite(f) && f >= 0) {
        grams += (f * Math.max(0, it.grams ?? 0)) / 100
        known += c
      }
    }
  }
  return { grams, coverage: kcal > 0 ? Math.round((known / kcal) * 100) / 100 : 1 }
}

/**
 * The profile as it was on `date`: before the latest weigh-in, the weight is the last weigh-in on
 * or before that day (within 60 days). From the latest weigh-in on it is the profile's own weight
 * (kept in step with the weight log), so today never changes. A wrong weigh-in (60 typed as 70)
 * therefore can't rewrite the energy of the weeks before it.
 */
export function profileOnDate(profile: Profile | null, weights: Record<string, WeightEntry> | undefined, date: string): Profile | null {
  if (!profile || !weights) return profile
  let latest: string | null = null
  let atOrBefore: WeightEntry | null = null
  for (const w of Object.values(weights)) {
    if (w.deleted || !(w.weight_kg > 0)) continue
    if (!latest || w.date > latest) latest = w.date
    if (w.date <= date && (!atOrBefore || w.date > atOrBefore.date)) atOrBefore = w
  }
  if (!latest || date >= latest || !atOrBefore) return profile
  if (daysBetween(atOrBefore.date, date) > 60) return profile
  return { ...profile, weightKg: atOrBefore.weight_kg }
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
