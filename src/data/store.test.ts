import { beforeEach, describe, expect, it } from 'vitest'
import { getState, initStore, logProfileWeight, markClean, markWeightsDirty, saveWeight, updateSettings, weightList } from './store'

beforeEach(async () => {
  await initStore('test-user-' + Math.random())
})

describe('weight log: what the server confirmed', () => {
  it('only the version that was sent becomes clean — a correction made meanwhile is kept for the next push', async () => {
    saveWeight('2026-10-22', 65)
    const sent = getState().weights['2026-10-22']
    expect(sent.dirty).toBe(true)
    // the request is in flight; the user corrects the value
    await new Promise((r) => setTimeout(r, 5))
    saveWeight('2026-10-22', 64.6)
    // ...the request for 65 returns
    markClean('weights', [{ key: '2026-10-22', updated_at: sent.updated_at }])
    const now = getState().weights['2026-10-22']
    expect(now.updated_at > sent.updated_at).toBe(true)
    expect(now.dirty).toBe(true) // still to be sent
    expect(now.weight_kg).toBe(64.6)
    markClean('weights', [{ key: '2026-10-22', updated_at: now.updated_at }])
    expect(getState().weights['2026-10-22'].dirty).toBe(false)
  })

  it('a stale confirmation never cleans a newer record', () => {
    saveWeight('2026-10-20', 70)
    markClean('weights', [{ key: '2026-10-20', updated_at: '2000-01-01T00:00:00.000Z' }])
    expect(getState().weights['2026-10-20'].dirty).toBe(true)
  })

  it('history is kept: a new day is a new entry, the same day is a correction', () => {
    saveWeight('2026-10-16', 60.1)
    saveWeight('2026-10-22', 65)
    saveWeight('2026-10-22', 64.8)
    expect(weightList(getState()).map((w) => [w.date, w.weight_kg])).toEqual([
      ['2026-10-16', 60.1],
      ['2026-10-22', 64.8],
    ])
  })

  it('entries the server lacks are queued again (recovery)', () => {
    saveWeight('2026-10-01', 61)
    const w = getState().weights['2026-10-01']
    markClean('weights', [{ key: '2026-10-01', updated_at: w.updated_at }])
    expect(getState().weights['2026-10-01'].dirty).toBe(false)
    markWeightsDirty(['2026-10-01', '1999-01-01'])
    expect(getState().weights['2026-10-01'].dirty).toBe(true)
    expect(getState().weights['1999-01-01']).toBeUndefined() // nothing invented
  })
})

describe('profile weight → weight log', () => {
  it('a new profile weight is logged as today; the same weight again is not', () => {
    updateSettings({ profile: { sex: 'male', age: 30, heightCm: 178, weightKg: 80 } })
    expect(logProfileWeight(80)).toBe(true)
    expect(weightList(getState())).toHaveLength(1)
    expect(logProfileWeight(80.02)).toBe(false)
    expect(weightList(getState())).toHaveLength(1)
    expect(logProfileWeight(5)).toBe(false)
  })
})
