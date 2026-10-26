import type { Analysis, FoodItem, Totals } from '../../supabase/functions/_shared/schema.ts'
import type { ExerciseType, Intensity, Lift, MuscleGroup, Profile, RestStyle } from '../domain/energy'
import type { CalorieMode, DeficitTarget, GoalPhase } from '../domain/goal'
import type { HealthDevice, OfficeSchedule } from '../domain/routine'

export type { Analysis, FoodItem, Totals, Lift, MuscleGroup }

export type Meal = 'breakfast' | 'lunch' | 'snack' | 'dinner'

export const MEALS: { id: Meal; label: string; emoji: string }[] = [
  { id: 'breakfast', label: 'בוקר', emoji: '🌅' },
  { id: 'lunch', label: 'צהריים', emoji: '☀️' },
  { id: 'snack', label: 'נשנוש', emoji: '🍎' },
  { id: 'dinner', label: 'ערב', emoji: '🌙' },
]

interface Syncable {
  id: string
  updated_at: string
  deleted?: boolean
  /** local change not yet pushed to the server */
  dirty?: boolean
}

export interface FoodEntry extends Syncable {
  date: string
  meal: Meal
  title: string
  emoji: string
  items: FoodItem[]
  totals: Totals
  confidence: number
  provider: string
  raw_text?: string
  /** 'pending' = saved offline, waiting for AI analysis */
  status: 'ok' | 'pending'
  /** Storage object path "<user_id>/<entry_id>/<photo_id>.jpg" (or a local-only path in local mode) */
  photo_path?: string
  created_at: string
}

export interface Exercise extends Syncable {
  date: string
  type: ExerciseType
  duration_min?: number
  distance_km?: number
  intensity?: Intensity
  /** strength only: training density (rest between sets) */
  rest?: RestStyle
  /** strength only, optional: muscle groups worked */
  muscles?: MuscleGroup[]
  /** strength only, optional: total volume lifted in the session (kg) */
  volume_kg?: number
  /** older entries only: per-exercise loads (no longer entered) */
  lifts?: Lift[]
  /** 'apple_health' = imported by the Shortcuts automation (Strava, Hevy, Apple Watch…) */
  origin?: 'manual' | 'apple_health'
  started_at?: string
  ended_at?: string
  /** app that recorded it, as Apple Health reports it */
  source_app?: string
  /** workout name as Apple Health reports it ("Running", "Traditional Strength Training") */
  title?: string
  /** workout active energy reported by Apple Health (kcal above rest) */
  reported_kcal?: number
  /** manual workout that Apple Health did not measure → its estimate is added to Apple's active energy */
  outside_health?: boolean
  created_at: string
}

export interface HealthDay {
  /** YYYY-MM-DD; primary key */
  date: string
  steps: number
  source: 'manual' | 'shortcut' | 'url'
  updated_at: string
  /** Apple Health "Active Energy" for the day (kcal), from the Shortcuts automation */
  active_kcal?: number | null
  /** Apple Health "Resting Energy" for the day (kcal) */
  resting_kcal?: number | null
  /** when the Apple Health snapshot was read */
  health_as_of?: string | null
  dirty?: boolean
}

/** One body-weight measurement per day (the date is the key: a second entry for a day corrects it). */
export interface WeightEntry {
  /** YYYY-MM-DD */
  date: string
  weight_kg: number
  created_at: string
  updated_at: string
  deleted?: boolean
  dirty?: boolean
}

export interface Settings {
  profile: Profile | null
  proteinTarget: number
  /** automatic mode's target: deficit band (burned − eaten), kcal — set by the phase */
  deficitTarget: DeficitTarget
  /** fitness phase (recomp / cut / maintain / lean bulk); absent in older settings → derived from the band */
  goalPhase?: GoalPhase
  /** 'auto' = the phase's band (default) · 'custom' = the band below */
  calorieMode?: CalorieMode
  /** the user's own band of deficit (positive) or surplus (negative), kcal; kept when switching phase or mode */
  customDeficit?: DeficitTarget
  /** what measures Active Energy: iPhone alone / Apple Watch (absent = inferred, see domain/routine.ts) */
  healthDevice?: HealthDevice
  /** weekly work hours with the phone left aside (null/absent = none) — see domain/routine.ts */
  officeSchedule?: OfficeSchedule | null
  /** the daily "anything the phone didn't see?" check: per date, activities answered "no" / the check skipped */
  activityCheck?: Record<string, { no: string[]; skipped?: boolean }>
  /** daily step goal (absent = the default, 8,000) */
  stepGoal?: number
  /** when profile/targets last changed on this device (for cross-device sync) */
  profileUpdatedAt?: string
  remindersEnabled: boolean
  reminderTime: string
  /** server Web Push is active → the local timer stays quiet (no duplicates) */
  pushSubscribed?: boolean
  /** last date a local reminder fired, to never notify twice */
  lastReminderDate?: string
  /** version of the cached day summaries written to the server (see services/sync.ts) */
  summariesVersion?: number
  /** ISO of last successful pull from server */
  lastPulledAt?: string
}

export const DEFAULT_SETTINGS: Settings = {
  profile: null,
  proteinTarget: 120,
  deficitTarget: { min: 100, max: 300 },
  remindersEnabled: false,
  reminderTime: '21:30',
}

export function mealForTime(d: Date = new Date()): Meal {
  const h = d.getHours() + d.getMinutes() / 60
  if (h >= 4.5 && h < 11) return 'breakfast'
  if (h >= 11 && h < 16) return 'lunch'
  if (h >= 18 && h < 23.5) return 'dinner'
  return 'snack'
}
