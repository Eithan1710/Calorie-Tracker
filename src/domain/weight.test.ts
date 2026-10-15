import { describe, expect, it } from 'vitest'
import { inRange, MIN_SPAN_KG, parseKg, smoothPath, summary, xAxis, yAxis, dayNum } from './weight'

const pts = [
  { date: '2026-07-01', kg: 63.0 },
  { date: '2026-09-20', kg: 61.9 },
  { date: '2026-10-01', kg: 61.6 },
  { date: '2026-10-08', kg: 61.4 },
  { date: '2026-10-15', kg: 61.7 },
]

describe('weight summary', () => {
  it('latest and change since the previous weigh-in', () => {
    const s = summary([...pts].reverse())
    expect(s.latest).toEqual({ date: '2026-10-15', kg: 61.7 })
    expect(s.previous?.date).toBe('2026-10-08')
    expect(s.change).toBe(0.3)
  })
  it('no change with fewer than two measurements, nothing with none', () => {
    expect(summary([pts[0]]).change).toBeNull()
    expect(summary([])).toEqual({ latest: null, previous: null, change: null })
  })
})

describe('ranges', () => {
  it('1 month / 3 months / all, oldest first', () => {
    expect(inRange(pts, '1m', '2026-10-15').map((p) => p.date)).toEqual(['2026-09-20', '2026-10-01', '2026-10-08', '2026-10-15'])
    expect(inRange(pts, '3m', '2026-10-15')).toHaveLength(4) // 1 July is more than 3 months back
    expect(inRange(pts, 'all', '2026-10-15')).toHaveLength(5)
    expect(inRange([...pts].reverse(), 'all', '2026-10-15')[0].date).toBe('2026-07-01')
  })
  it('the x axis spans the range; all-time starts at the first weigh-in', () => {
    expect(xAxis(pts, '1m', '2026-10-15').to - xAxis(pts, '1m', '2026-10-15').from).toBe(31)
    expect(xAxis(pts, 'all', '2026-10-15').from).toBe(dayNum('2026-07-01'))
    // a single recent point is not squeezed against the edge
    const one = xAxis([{ date: '2026-10-15', kg: 60 }], 'all', '2026-10-15')
    expect(one.to - one.from).toBe(14)
  })
})

describe('y axis does not exaggerate small changes', () => {
  it('a 0.6 kg wobble is drawn on at least a 4 kg range, on round kilograms', () => {
    const a = yAxis([61.4, 61.7, 61.1])
    expect(a.hi - a.lo).toBeGreaterThan(MIN_SPAN_KG - 0.01)
    expect(a.lo).toBeLessThan(61.1)
    expect(a.hi).toBeGreaterThan(61.7)
    expect(a.ticks.every((t) => Number.isInteger(t))).toBe(true)
  })
  it('a large change gets a wider range and coarser ticks', () => {
    const a = yAxis([90, 75])
    expect(a.lo).toBeLessThan(75.01)
    expect(a.hi).toBeGreaterThan(89.99)
    expect(a.ticks[1] - a.ticks[0]).toBeGreaterThan(1)
  })
})

describe('smooth line', () => {
  it('passes through every measurement and never overshoots between them', () => {
    const p = [{ x: 0, y: 50 }, { x: 10, y: 40 }, { x: 20, y: 40 }, { x: 30, y: 60 }]
    const d = smoothPath(p)
    expect(d.startsWith('M0,50')).toBe(true)
    expect(d.endsWith('30,60')).toBe(true)
    // flat segment between two equal points stays flat (monotone: zero tangents at the plateau)
    expect(d).toMatch(/C13\.3+\d*,40 16\.6+\d*,40 20,40/)
  })
  it('one or two points', () => {
    expect(smoothPath([{ x: 1, y: 2 }])).toBe('M1,2')
    expect(smoothPath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M1,2L3,4')
  })
})

describe('typed weight', () => {
  it.each([['61.4', 61.4], ['61,4', 61.4], [' 72 ', 72], ['61.45', 61.5], ['abc', null], ['5', null], ['', null], ['900', null]])('%s', (t, v) => {
    expect(parseKg(t)).toBe(v)
  })
})
