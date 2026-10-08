import type { Analysis, FoodItem, Totals } from '../../supabase/functions/_shared/schema.ts'
import type { ExerciseType, Intensity, Lift, MuscleGroup, Profile, RestStyle } from '../domain/energy'
import type { DeficitTarget } from '../domain/goal'

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
  created_at: string
}

export interface HealthDay {
  /** YYYY-MM-DD; primary key */
  date: string
  steps: number
  source: 'manual' | 'shortcut' | 'url'
  updated_at: string
  dirty?: boolean
}

export interface Settings {
  profile: Profile | null
  proteinTarget: number
  /** personal daily target: deficit band (burned − eaten), kcal */
  deficitTarget: DeficitTarget
  /** when profile/targets last changed on this device (for cross-device sync) */
  profileUpdatedAt?: string
  remindersEnabled: boolean
  reminderTime: string
  /** server Web Push is active → the local timer stays quiet (no duplicates) */
  pushSubscribed?: boolean
  /** last date a local reminder fired, to never notify twice */
  lastReminderDate?: string
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
