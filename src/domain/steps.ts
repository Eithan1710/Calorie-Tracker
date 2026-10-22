import type { HealthDay } from '../data/types'

/**
 * Daily step goal. Steps come from the existing health rows (Apple Health / Shortcuts via
 * health-ingest, or typed in by hand) — this file only compares them with the goal.
 */
export const DEFAULT_STEP_GOAL = 8000
export const STEP_GOAL_LIMITS = { min: 1000, max: 50000 } as const
export const STEP_GOAL_PRESETS = [6000, 8000, 10000, 12000] as const

/** Hebrew error for a step goal, or null when valid. */
export function stepGoalError(v: number | '' | null | undefined): string | null {
  if (v === '' || v == null || !Number.isFinite(v)) return 'צריך מספר צעדים'
  if (!Number.isInteger(v)) return 'מספר שלם של צעדים'
  if (v < STEP_GOAL_LIMITS.min || v > STEP_GOAL_LIMITS.max) return `בין ${STEP_GOAL_LIMITS.min.toLocaleString('he-IL')} ל-${STEP_GOAL_LIMITS.max.toLocaleString('he-IL')} צעדים`
  return null
}

export const isValidStepGoal = (v: unknown): v is number => typeof v === 'number' && stepGoalError(v) === null

/** The goal in force: the user's own, else the default. */
export const stepGoalOf = (s: { stepGoal?: number }) => (isValidStepGoal(s.stepGoal) ? s.stepGoal : DEFAULT_STEP_GOAL)

export type StepProgress =
  /** no step data for the day yet (nothing synced, nothing typed) — not the same as 0 steps */
  | { kind: 'missing'; goal: number }
  | {
      kind: 'steps'
      steps: number
      goal: number
      /** 0…1, capped */
      ratio: number
      reached: boolean
      remaining: number
      /** where the number came from */
      source: HealthDay['source']
      /** when the number was read (Apple Health snapshot) or typed */
      asOf: string
    }

export function stepProgress(day: HealthDay | null | undefined, goal: number): StepProgress {
  if (!day || typeof day.steps !== 'number' || !Number.isFinite(day.steps)) return { kind: 'missing', goal }
  // Apple Health energy can arrive before (or without) the steps — the server then stores 0
  // steps for the day. 0 steps next to measured energy means "not received", not "didn't walk".
  if (day.steps === 0 && day.source === 'shortcut' && (day.active_kcal != null || day.resting_kcal != null)) return { kind: 'missing', goal }
  const steps = Math.max(0, Math.round(day.steps))
  return {
    kind: 'steps',
    steps,
    goal,
    ratio: Math.min(1, steps / goal),
    reached: steps >= goal,
    remaining: Math.max(0, goal - steps),
    source: day.source,
    asOf: day.health_as_of ?? day.updated_at,
  }
}
