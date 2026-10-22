import { describe, expect, it } from 'vitest'
import { DEFAULT_STEP_GOAL, stepGoalError, stepGoalOf, stepProgress } from './steps'
import type { HealthDay } from '../data/types'

const day = (steps: number, extra: Partial<HealthDay> = {}): HealthDay => ({ date: '2026-10-22', steps, source: 'shortcut', updated_at: '2026-10-22T12:00:00Z', ...extra })

describe('step goal', () => {
  it('progress toward different goals', () => {
    expect(stepProgress(day(6500), 10000)).toMatchObject({ kind: 'steps', steps: 6500, goal: 10000, ratio: 0.65, reached: false, remaining: 3500 })
    expect(stepProgress(day(6500), 6000)).toMatchObject({ reached: true, ratio: 1, remaining: 0 })
    expect(stepProgress(day(8000), 8000)).toMatchObject({ reached: true, remaining: 0 }) // exactly the goal counts
    expect(stepProgress(day(7999), 8000).kind === 'steps' && stepProgress(day(7999), 8000)).toMatchObject({ reached: false, remaining: 1 })
  })

  it('updated step counts move the progress', () => {
    const goal = 10000
    const before = stepProgress(day(4000), goal)
    const after = stepProgress(day(10400, { updated_at: '2026-10-22T18:00:00Z' }), goal)
    expect(before).toMatchObject({ reached: false, ratio: 0.4 })
    expect(after).toMatchObject({ reached: true, steps: 10400, asOf: '2026-10-22T18:00:00Z' })
  })

  it('no data is not the same as 0 steps', () => {
    expect(stepProgress(undefined, 8000)).toEqual({ kind: 'missing', goal: 8000 })
    expect(stepProgress(null, 8000).kind).toBe('missing')
    // typed 0 by hand / Apple Health sent 0 steps → a real zero
    expect(stepProgress(day(0, { source: 'manual' }), 8000)).toMatchObject({ kind: 'steps', steps: 0, ratio: 0 })
    expect(stepProgress(day(0), 8000)).toMatchObject({ kind: 'steps', steps: 0 })
    // only energy arrived from Apple Health (the server stores 0 steps) → not synced yet
    expect(stepProgress(day(0, { active_kcal: 120, resting_kcal: 900 }), 8000).kind).toBe('missing')
    expect(stepProgress(day(3200, { active_kcal: 120 }), 8000)).toMatchObject({ kind: 'steps', steps: 3200 })
  })

  it('the snapshot time is shown when there is one', () => {
    expect(stepProgress(day(100, { health_as_of: '2026-10-22T09:30:00Z' }), 8000)).toMatchObject({ asOf: '2026-10-22T09:30:00Z' })
  })

  it('validation and default', () => {
    expect(stepGoalError(8000)).toBe(null)
    expect(stepGoalError(10000)).toBe(null)
    expect(stepGoalError('')).toMatch(/צריך/)
    expect(stepGoalError(500)).toMatch(/בין/)
    expect(stepGoalError(60000)).toMatch(/בין/)
    expect(stepGoalError(8000.5)).toMatch(/שלם/)
    expect(stepGoalOf({})).toBe(DEFAULT_STEP_GOAL)
    expect(stepGoalOf({ stepGoal: 12000 })).toBe(12000)
    expect(stepGoalOf({ stepGoal: 5 })).toBe(DEFAULT_STEP_GOAL)
  })
})
