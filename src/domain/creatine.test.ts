import { describe, expect, it } from 'vitest'
import { creatineFullBy, creatineFullKg, creatineLastStart, creatineProgress, creatineWaterKg, isValidCreatine, resumeCreatine } from './creatine'

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

describe('creatine breaks (stopped, then taking it again)', () => {
  const full = creatineFullKg(60)
  it('"taking it again" keeps the start and turns the days off into a break', () => {
    const stopped = { start: '2026-10-25', stop: '2026-11-07' }
    expect(resumeCreatine(stopped, '2026-11-17')).toEqual({ start: '2026-10-25', breaks: [{ from: '2026-11-08', to: '2026-11-16' }] })
    // stopped yesterday, back today: no gap
    expect(resumeCreatine({ start: '2026-10-25', stop: '2026-11-16' }, '2026-11-17')).toEqual({ start: '2026-10-25' })
    expect(creatineLastStart({ start: '2026-10-25', breaks: [{ from: '2026-11-08', to: '2026-11-16' }] })).toBe('2026-11-17')
  })
  it('the water drains during the break and refills from there — not as if taken all along', () => {
    const c = { start: '2026-10-25', breaks: [{ from: '2026-11-08', to: '2026-11-16' }] }
    const allAlong = { start: '2026-10-25' }
    const stopped = { start: '2026-10-25', stop: '2026-11-07' }
    // up to the break: same as taken all along
    expect(creatineWaterKg(c, '2026-11-08', 60)).toBeCloseTo(creatineWaterKg(allAlong, '2026-11-08', 60), 6)
    // during the break: same as stopped
    expect(creatineWaterKg(c, '2026-11-17', 60)).toBeCloseTo(creatineWaterKg(stopped, '2026-11-17', 60), 6)
    expect(creatineWaterKg(c, '2026-11-17', 60)).toBeLessThan(creatineWaterKg(allAlong, '2026-11-17', 60) - 0.2)
    // then rises again, reaching the full effect ~4 weeks later, not at once
    expect(creatineWaterKg(c, '2026-11-20', 60)).toBeGreaterThan(creatineWaterKg(c, '2026-11-17', 60))
    expect(creatineWaterKg(c, '2026-12-20', 60)).toBeGreaterThan(full * 0.95)
    const by = creatineFullBy(c, '2026-11-17')
    expect(by && by > '2026-12-01' && by < '2026-12-15').toBe(true)
    expect(creatineFullBy(allAlong, '2026-12-30')).toBeNull()
  })
  it('a stop after a break still drains', () => {
    const c = { start: '2026-09-01', breaks: [{ from: '2026-09-20', to: '2026-09-25' }], stop: '2026-10-31' }
    expect(creatineWaterKg(c, '2026-11-28', 60)).toBeLessThan(0.1)
  })
  it('validates breaks', () => {
    expect(isValidCreatine({ start: '2026-10-25', breaks: [{ from: '2026-11-08', to: '2026-11-16' }] })).toBe(true)
    expect(isValidCreatine({ start: '2026-10-25', breaks: [{ from: '2026-10-20', to: '2026-10-30' }] })).toBe(false) // before the start
    expect(isValidCreatine({ start: '2026-10-25', breaks: [{ from: '2026-11-10', to: '2026-11-08' }] })).toBe(false)
    expect(isValidCreatine({ start: '2026-10-25', breaks: [{ from: '2026-11-01', to: '2026-11-05' }, { from: '2026-11-04', to: '2026-11-06' }] })).toBe(false)
    expect(isValidCreatine({ start: '2026-10-25', stop: '2026-11-05', breaks: [{ from: '2026-11-01', to: '2026-11-06' }] })).toBe(false)
  })
})
