import { describe, expect, it } from 'vitest'
import { creatineFullKg, creatineProgress, creatineWaterKg, isValidCreatine } from './creatine'

const C = { start: '2026-10-25' }
describe('creatine water', () => {
  it('nothing before the start; ~0.8 kg at 60 kg once saturated (3–5 g/day: ~4 weeks)', () => {
    expect(creatineWaterKg(C, '2026-10-20', 60)).toBe(0)
    expect(creatineWaterKg(C, '2026-10-25', 60)).toBe(0)
    expect(creatineFullKg(60)).toBe(0.78)
    expect(creatineProgress(C, '2026-11-05')).toBeGreaterThan(0.65) // day 11
    expect(creatineProgress(C, '2026-11-05')).toBeLessThan(0.8)
    expect(creatineProgress(C, '2026-11-22')).toBeGreaterThan(0.94) // day 28
  })
  it('loading reaches it within a week; after stopping it fades', () => {
    expect(creatineProgress({ ...C, loading: true }, '2026-11-01')).toBeGreaterThan(0.95)
    const s = { start: '2026-09-01', stop: '2026-10-31' }
    expect(creatineWaterKg(s, '2026-11-28', 60)).toBeLessThan(0.1)
  })
  it('validates', () => {
    expect(isValidCreatine(C)).toBe(true)
    expect(isValidCreatine({ start: 'x' })).toBe(false)
    expect(isValidCreatine({ start: '2026-10-25', stop: '2026-10-01' })).toBe(false)
  })
})
