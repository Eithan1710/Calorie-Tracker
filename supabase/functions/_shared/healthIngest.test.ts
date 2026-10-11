import { describe, expect, it } from 'vitest'
import { parseDistanceKm, parseDurationMin, parseEnergy, parseIngest, parseNumber, workoutType } from './healthIngest.ts'

const TZ = 'Asia/Jerusalem'
const NOW = new Date('2026-10-11T18:30:00Z') // 21:30 in Israel
const opts = { userId: 'u1', tz: TZ, now: NOW }
const ok = async (raw: unknown) => {
  const r = await parseIngest(raw, opts)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('lenient numbers from Shortcuts', () => {
  it.each([
    [7842, 7842], ['7842', 7842], ['7,842', 7842], ['1,203.4', 1203.4], ['1.203,4', 1203.4], ['512.3 kcal', 512.3], ['512,3', 512.3], ['abc', null],
  ])('%s', (v, n) => expect(parseNumber(v)).toBe(n))
  it('kJ is converted to kcal', () => {
    expect(parseEnergy('2092 kJ')).toBeCloseTo(500, 1)
    expect(parseEnergy(2092, 'kJ')).toBeCloseTo(500, 1)
    expect(parseEnergy('500 Cal')).toBe(500)
  })
  it('distance and duration units', () => {
    expect(parseDistanceKm('5.1 km')).toBe(5.1)
    expect(parseDistanceKm('5100 m')).toBeCloseTo(5.1, 6)
    expect(parseDistanceKm('3.1 mi')).toBeCloseTo(4.989, 2)
    expect(parseDurationMin('00:32:30')).toBeCloseTo(32.5, 6)
    expect(parseDurationMin('1920 s')).toBe(32)
    expect(parseDurationMin('1.5 hr')).toBe(90)
    expect(parseDurationMin(45)).toBe(45)
  })
  it('workout names (English and Hebrew) map to types', () => {
    expect(workoutType('Outdoor Run')).toBe('run')
    expect(workoutType('Traditional Strength Training')).toBe('strength')
    expect(workoutType('Functional Strength Training')).toBe('strength')
    expect(workoutType('אימון כוח מסורתי')).toBe('strength')
    expect(workoutType('ריצה')).toBe('run')
    expect(workoutType('Walking')).toBe('walk')
    expect(workoutType('Yoga')).toBe('other')
  })
})

describe('payload', () => {
  it('the original steps-only automation keeps working', async () => {
    const v = await ok({ steps: '7,842' })
    expect(v).toMatchObject({ date: '2026-10-11', steps: 7842, active_kcal: null, resting_kcal: null, workouts: [] })
  })

  it('energy totals with a snapshot time', async () => {
    const v = await ok({ steps: 9100, active_kcal: '612.4', resting_kcal: 1388.27, as_of: '2026-10-11T21:15:00+03:00' })
    expect(v).toMatchObject({ active_kcal: 612.4, resting_kcal: 1388.3, as_of: '2026-10-11T18:15:00.000Z' })
  })

  it('"today" is the user\'s day, not UTC: 00:30 in Israel is already the next day', async () => {
    const r = await parseIngest({ steps: 120 }, { ...opts, now: new Date('2026-10-11T21:30:00Z') })
    expect(r.ok && r.value.date).toBe('2026-10-12')
  })

  it('rejects data for the future, very old days, and snapshots read before the day they describe', async () => {
    expect((await parseIngest({ steps: 1, date: '2026-10-12' }, opts)).ok).toBe(false)
    expect((await parseIngest({ steps: 1, date: '2026-09-01' }, opts)).ok).toBe(false)
    expect((await parseIngest({ steps: 1, date: '2026-10-11', as_of: '2026-10-10T20:00:00+03:00' }, opts)).ok).toBe(false)
  })

  it('yesterday\'s final totals may be re-sent', async () => {
    const v = await ok({ date: '2026-10-10', active_kcal: 700, resting_kcal: 1500, as_of: '2026-10-10T23:55:00+03:00' })
    expect(v.date).toBe('2026-10-10')
  })

  it('a future as_of falls back to the receive time', async () => {
    const v = await ok({ steps: 1, as_of: '2026-10-11T23:59:00+03:00' })
    expect(v.as_of).toBe(NOW.toISOString())
    expect(v.warnings.length).toBe(1)
  })

  it('out-of-range values are ignored, not stored', async () => {
    const v = await ok({ steps: 5000, active_kcal: 99999 })
    expect(v.active_kcal).toBeNull()
    expect(v.steps).toBe(5000)
  })

  it('an empty payload is an error, not a row of zeros', async () => {
    expect((await parseIngest({}, opts)).ok).toBe(false)
    expect((await parseIngest({ foo: 1 }, opts)).ok).toBe(false)
  })
})

describe('workouts', () => {
  const run = { type: 'Running', start: '2026-10-11T18:00:00+03:00', end: '2026-10-11T18:32:30+03:00', distance: '5.1 km', kcal: '340 kcal', source: 'Strava' }

  it('are parsed with duration from start/end, distance, energy and source', async () => {
    const v = await ok({ workouts: [run] })
    expect(v.workouts[0]).toMatchObject({ type: 'run', date: '2026-10-11', duration_min: 32.5, distance_km: 5.1, kcal: 340, source_app: 'Strava', title: 'Running' })
  })

  it('the same workout sent again gets the same id (idempotent)', async () => {
    const a = await ok({ workouts: [run] })
    const b = await ok({ workouts: [{ ...run, start: '2026-10-11T18:00:20+03:00', kcal: 341 }] })
    expect(b.workouts[0].external_id).toBe(a.workouts[0].external_id)
    const twice = await ok({ workouts: [run, run] })
    expect(twice.workouts).toHaveLength(1)
  })

  it('a workout crossing midnight belongs to the day it started', async () => {
    const v = await ok({ workouts: [{ type: 'Walking', start: '2026-10-10T23:40:00+03:00', end: '2026-10-11T00:20:00+03:00' }] })
    expect(v.workouts[0].date).toBe('2026-10-10')
    expect(v.workouts[0].duration_min).toBe(40)
  })

  it('different users never share ids', async () => {
    const a = await parseIngest({ workouts: [run] }, opts)
    const b = await parseIngest({ workouts: [run] }, { ...opts, userId: 'u2' })
    expect(a.ok && b.ok && a.value.workouts[0].external_id !== b.value.workouts[0].external_id).toBe(true)
  })

  it('accepts the list as a JSON string (Shortcuts "Text" field) and skips invalid entries', async () => {
    const v = await ok({ workouts: JSON.stringify([run, { type: 'Yoga' }]) })
    expect(v.workouts).toHaveLength(1)
    expect(v.warnings.length).toBe(1)
  })

  it('unknown energy stays null (estimated later, never invented)', async () => {
    const v = await ok({ workouts: [{ type: 'Traditional Strength Training', start: '2026-10-11T19:00:00+03:00', duration: '00:55:00', source: 'Hevy' }] })
    expect(v.workouts[0]).toMatchObject({ type: 'strength', kcal: null, duration_min: 55, source_app: 'Hevy' })
  })
})
