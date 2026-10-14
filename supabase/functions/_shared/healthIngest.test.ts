import { describe, expect, it } from 'vitest'
import { DAY_TZ, parseDistanceKm, parseDurationMin, parseEnergy, parseIngest, parseNumber, workoutType } from './healthIngest.ts'

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

describe('date keywords', () => {
  it('"yesterday" / "today" (English or Hebrew) resolve in Israel time', async () => {
    expect((await ok({ active_kcal: 500, date: 'yesterday' })).date).toBe('2026-10-10')
    expect((await ok({ active_kcal: 500, date: 'אתמול' })).date).toBe('2026-10-10')
    expect((await ok({ active_kcal: 500, date: 'Today' })).date).toBe('2026-10-11')
    // at 00:10 Israel time "yesterday" is the day that just ended, although UTC is still on it
    const r = await parseIngest({ active_kcal: 500, date: 'yesterday' }, { ...opts, now: new Date('2026-10-11T21:10:00Z') })
    expect(r.ok && r.value.date).toBe('2026-10-11')
  })
})

describe('timestamped energy samples', () => {
  // 2026-10-14 21:40 in Israel (IDT, UTC+3)
  const now = new Date('2026-10-14T18:40:00Z')
  const sopts = { userId: 'u1', tz: DAY_TZ, now }
  const parse = async (raw: unknown, o = sopts) => {
    const r = await parseIngest(raw, o)
    if (!r.ok) throw new Error(r.error)
    return r.value
  }
  const yesterday = { start: '2026-10-13T00:00:00+03:00', end: '2026-10-13T23:59:00+03:00', kcal: 512.4, source: 'Apple Watch' }
  const today = { start: '2026-10-14T00:00:00+03:00', end: '2026-10-14T21:30:00+03:00', kcal: '398 kcal', source: 'Apple Watch' }

  it('one request with yesterday and today files each sample under its own day', async () => {
    const v = await parse({ active_samples: [yesterday, today] })
    expect(v.samples.active.map((s) => [s.date, s.kcal])).toEqual([['2026-10-13', 512.4], ['2026-10-14', 398]])
    expect(v.sample_stats.active?.days).toEqual({ '2026-10-13': { samples: 1, kcal: 512.4 }, '2026-10-14': { samples: 1, kcal: 398 } })
    expect(v.active_kcal).toBeNull() // no aggregate was sent — nothing is filed under `date`
  })

  it('midnight: the local day of the START decides (not UTC, not the request day)', async () => {
    const v = await parse({
      active_samples: [
        { start: '2026-10-13T20:59:30Z', end: '2026-10-13T21:00:30Z', kcal: 3 }, // 23:59:30 on the 13th in Israel
        { start: '2026-10-13T21:00:30Z', end: '2026-10-13T21:01:30Z', kcal: 5 }, // 00:00:30 on the 14th in Israel
      ],
    })
    expect(v.samples.active.map((s) => s.date)).toEqual(['2026-10-13', '2026-10-14'])
  })

  it('daylight-saving end (25 Oct 02:00 → 01:00): boundaries follow Israel time, not a fixed +3', async () => {
    const after = { ...sopts, now: new Date('2026-10-26T06:00:00Z') }
    const v = await parse({
      resting_samples: [
        { start: '2026-10-25T21:30:00Z', end: '2026-10-25T21:31:00Z', kcal: 1 }, // 23:30 IST on the 25th (would be 00:30 at +3)
        { start: '2026-10-25T22:30:00Z', end: '2026-10-25T22:31:00Z', kcal: 2 }, // 00:30 IST on the 26th
      ],
    }, after)
    expect(v.samples.resting.map((s) => s.date)).toEqual(['2026-10-25', '2026-10-26'])
  })

  it('the same sample sent again gets the same key; source and times are part of it, the value is not', async () => {
    const a = await parse({ active_samples: [today] })
    const b = await parse({ active_samples: [{ ...today, kcal: 410 }] })
    const c = await parse({ active_samples: [{ ...today, source: 'iPhone' }] })
    const d = await parse({ active_samples: [{ ...today, end: '2026-10-14T21:35:00+03:00' }] })
    expect(b.samples.active[0].key).toBe(a.samples.active[0].key)
    expect(c.samples.active[0].key).not.toBe(a.samples.active[0].key)
    expect(d.samples.active[0].key).not.toBe(a.samples.active[0].key)
    // two different samples with the same calories are NOT merged
    const e = await parse({ active_samples: [{ ...today, kcal: 5 }, { ...today, start: '2026-10-14T01:00:00+03:00', kcal: 5 }] })
    expect(e.samples.active).toHaveLength(2)
  })

  it('a phone-supplied sample id is used as the key', async () => {
    const v = await parse({ active_samples: [{ ...today, id: 'A1B2-C3' }] })
    expect(v.samples.active[0].key).toBe('id:A1B2-C3')
  })

  it('duplicates inside one request are counted and collapsed (the last one wins)', async () => {
    const v = await parse({ active_samples: [today, { ...today, kcal: 401 }, yesterday] })
    expect(v.samples.active).toHaveLength(2)
    expect(v.samples.active.find((s) => s.date === '2026-10-14')?.kcal).toBe(401)
    expect(v.sample_stats.active?.duplicates_in_request).toBe(1)
    expect(v.warnings.join(' ')).toMatch(/1 duplicates/)
  })

  it('invalid timestamps / values / dates are skipped and counted, never guessed', async () => {
    const v = await parse({
      active_samples: [
        today,
        { kcal: 10 },                                                            // no start
        { start: 'yesterday-ish', kcal: 10 },                                    // unparseable
        { start: '2026-10-14T10:00:00+03:00', end: '2026-10-14T09:00:00+03:00', kcal: 1 }, // end before start
        { start: '2026-10-12T00:00:00+03:00', end: '2026-10-14T00:00:00+03:00', kcal: 1 }, // 48 h
        { start: '2026-10-14T10:00:00+03:00', end: '2026-10-14T10:05:00+03:00', kcal: 'n/a' },
        { start: '2026-10-14T10:00:00+03:00', end: '2026-10-14T10:05:00+03:00', kcal: -4 },
        { start: '2026-09-01T10:00:00+03:00', end: '2026-09-01T10:05:00+03:00', kcal: 4 }, // too old
        { start: '2026-10-15T10:00:00+03:00', end: '2026-10-15T10:05:00+03:00', kcal: 4 }, // future
      ],
    })
    expect(v.samples.active).toHaveLength(1)
    expect(v.sample_stats.active).toMatchObject({ received: 9, accepted: 1, invalid_timestamp: 4, invalid_value: 2, out_of_range: 2 })
    expect(v.warnings.length).toBe(3)
  })

  it('today\'s Group-by-Day bucket may end at the coming midnight', async () => {
    const v = await parse({ active_samples: [{ start: '2026-10-14T00:00:00+03:00', end: '2026-10-15T00:00:00+03:00', kcal: 398 }] })
    expect(v.samples.active.map((s) => s.date)).toEqual(['2026-10-14'])
  })

  it('whole-day buckets as {date, kcal}: exact local-midnight bounds, stable key, DST day = 25 h', async () => {
    const v = await parse({ active_samples: [{ date: 'yesterday', kcal: 512.4 }, { date: '2026-10-14', kcal: 398 }] })
    expect(v.samples.active.map((s) => [s.date, s.start, s.end])).toEqual([
      ['2026-10-13', '2026-10-12T21:00:00.000Z', '2026-10-13T21:00:00.000Z'],
      ['2026-10-14', '2026-10-13T21:00:00.000Z', '2026-10-14T21:00:00.000Z'],
    ])
    const again = await parse({ active_samples: [{ date: '2026-10-14', kcal: 431 }] })
    expect(again.samples.active[0].key).toBe(v.samples.active[1].key)
    const dst = await parse({ resting_samples: [{ date: '2026-10-25', kcal: 1400 }] }, { ...sopts, now: new Date('2026-10-26T06:00:00Z') })
    expect([dst.samples.resting[0].start, dst.samples.resting[0].end]).toEqual(['2026-10-24T21:00:00.000Z', '2026-10-25T22:00:00.000Z'])
    expect((await parse({ active_samples: [{ date: 'last week', kcal: 1 }, today] })).sample_stats.active?.invalid_timestamp).toBe(1)
  })

  it('only samples is a valid request; only invalid samples is an error that says why', async () => {
    expect((await parseIngest({ active_samples: [today] }, sopts)).ok).toBe(true)
    const bad = await parseIngest({ active_samples: [{ kcal: 1 }] }, sopts)
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toMatch(/none of the 1 samples were valid/)
  })

  it('Shortcuts shapes: JSON text, dictionary of dictionaries, a single dictionary, kJ, "Cal" strings', async () => {
    expect((await parse({ active_samples: JSON.stringify([today, yesterday]) })).samples.active).toHaveLength(2)
    expect((await parse({ active_samples: { 1: today, 2: yesterday } })).samples.active).toHaveLength(2)
    expect((await parse({ active_samples: today })).samples.active).toHaveLength(1)
    expect((await parse({ active_samples: `${JSON.stringify(today)}\n${JSON.stringify(yesterday)}` })).samples.active).toHaveLength(2)
    expect((await parse({ active_samples: [{ ...today, kcal: '2092 kJ' }] })).samples.active[0].kcal).toBeCloseTo(500, 1)
    expect((await parse({ active_samples: [{ ...today, kcal: '1,204.5 Cal' }] })).samples.active[0].kcal).toBe(1204.5)
  })

  it('aggregates and samples can travel together (steps stay an aggregate)', async () => {
    const v = await parse({ steps: 7013, resting_kcal: 1284.8, active_samples: [yesterday, today] })
    expect(v).toMatchObject({ date: '2026-10-14', steps: 7013, resting_kcal: 1284.8, active_kcal: null })
    expect(v.samples.active).toHaveLength(2)
    expect(v.samples.resting).toHaveLength(0)
  })
})
