import { describe, expect, it } from 'vitest'
import { healthDeviceOf, netKcal, noPhoneWindows, officeScheduleError, routineContextOf, routineEnergy, type OfficeSchedule } from './routine'
import { bmrMifflinStJeor } from './energy'
import { dayEnergy, type DayWorkout } from './expenditure'

const p = { sex: 'male' as const, age: 20, heightCm: 160, weightKg: 59.2 }
const restPerMin = bmrMifflinStJeor(p) / 1440
const net = (met: number, min: number) => Math.max(0, (met * 3.5 * p.weightKg) / 200 - restPerMin) * min
const WORK: OfficeSchedule = { days: [0, 1, 2, 3, 4], start: '09:30', end: '18:00', phoneBreaks: [['12:00', '13:00']] }
const SUNDAY = '2026-10-25'
const FRIDAY = '2026-10-30'
const morning = net(3.3, 3) + net(2.0, 6) + net(2.0, 10) + net(2.5, 6)

/** a finished day with Apple Health Resting + Active Energy (an iPhone without a watch) */
const day = (date: string, opts: { active?: number | null; resting?: number | null; workouts?: DayWorkout[]; steps?: number; phoneOnly?: boolean; schedule?: OfficeSchedule | null; asOf?: string; now?: string } = {}) =>
  dayEnergy({
    date,
    profile: p,
    steps: opts.steps ?? 7000,
    workouts: opts.workouts ?? [],
    health:
      opts.active === null && opts.resting === null
        ? null
        : { active_kcal: opts.active === undefined ? 300 : opts.active, resting_kcal: opts.resting === undefined ? 1530 : opts.resting, health_as_of: opts.asOf ?? `${date}T23:59:00` },
    intake: { protein_g: 120, carbs_g: 180, fat_g: 50 },
    routine: { phoneOnly: opts.phoneOnly ?? true, schedule: opts.schedule === undefined ? WORK : opts.schedule },
    now: new Date(opts.now ?? '2026-11-02T12:00:00'),
  })

describe('weekly work schedule', () => {
  it('the phone break is cut out of the work hours: 09:30–12:00 and 13:00–18:00 = 7.5 h', () => {
    expect(noPhoneWindows(WORK, SUNDAY)).toEqual([[570, 720], [780, 1080]])
    expect(noPhoneWindows(WORK, FRIDAY)).toEqual([]) // not a work day
    expect(noPhoneWindows(null, SUNDAY)).toEqual([])
  })
  it('validation', () => {
    expect(officeScheduleError(WORK)).toBe(null)
    expect(officeScheduleError({ ...WORK, end: '08:00' })).toMatch(/אחרי/)
    expect(officeScheduleError({ ...WORK, days: [] })).toMatch(/יום/)
    expect(officeScheduleError({ ...WORK, phoneBreaks: [['07:00', '08:00']] })).toMatch(/בתוך/)
  })
})

describe('routine energy: same method as workouts (above the person’s own rest)', () => {
  it('work day: conservative office mix — 96% seated computer work (MET 1.5), 4% slow walking (MET 2.0)', () => {
    const r = routineEnergy(p, SUNDAY, WORK)
    expect(r.noPhoneMinutes).toBe(450)
    const sit = r.lines.find((l) => l.id === 'office_sitting')!
    const move = r.lines.find((l) => l.id === 'office_moving')!
    expect(sit.minutes + move.minutes).toBe(450)
    expect(move.minutes).toBe(18)
    expect(r.kcal).toBeCloseTo(morning + net(1.5, 432) + net(2.0, 18), 5)
    // a realistic size, not a big bonus for leaving the phone: ≈ 0.5 kcal per minute above rest
    expect(r.kcal).toBeGreaterThan(230)
    expect(r.kcal).toBeLessThan(300)
  })
  it('day off: only the short self-care routine', () => {
    expect(routineEnergy(p, FRIDAY, WORK).kcal).toBeCloseTo(morning, 5)
    expect(morning).toBeGreaterThan(25)
    expect(morning).toBeLessThan(45)
  })
  it('never below zero, even for a body whose rest exceeds the MET rate', () => {
    expect(netKcal({ ...p, weightKg: 40, heightCm: 200 }, 1.0, 60)).toBe(0)
  })
  it('"so far": work hours count as they pass; the phone break counts nothing', () => {
    const at = (h: number) => routineEnergy(p, SUNDAY, WORK, h * 60).soFar
    expect(at(8)).toBeCloseTo(morning, 5)
    expect(at(12.5)).toBeCloseTo(at(12), 5) // 12:00–13:00 the phone is there
    expect(at(18)).toBeCloseTo(routineEnergy(p, SUNDAY, WORK).kcal, 5)
  })
})

describe('daily total — scenarios', () => {
  it('1. regular work day: Apple Health for the day + an estimate for the hours without the phone', () => {
    const e = day(SUNDAY)
    const r = routineEnergy(p, SUNDAY, WORK)
    expect(e.routine).toBe(Math.round(r.kcal))
    expect(e.resting.fullDay).toBe(1530) // Apple's resting, not re-estimated
    expect(e.active.kcal).toBe(300) // Apple's active, untouched
    expect(e.total).toBe(Math.round(1530 + 300 + r.kcal + e.tef))
    expect(e.sources.apple).toBe(1830)
    expect(e.sources.estimated).toBe(e.total - 1830)
  })

  it('2. Apple Watch (complete data): nothing estimated on top of Apple Health except digestion', () => {
    const e = day(SUNDAY, { phoneOnly: false })
    expect(e.routine).toBe(0)
    expect(e.total).toBe(Math.round(1530 + 300 + e.tef))
  })

  it('3. partial Apple data: only the missing part is estimated', () => {
    // Active Energy missing → movement estimated from steps; Apple's resting kept; no routine on top of an estimate
    const noActive = day(SUNDAY, { active: null })
    expect(noActive.resting.source).toBe('apple')
    expect(noActive.active.source).toBe('estimate')
    expect(noActive.routine).toBe(0)
    // unfinished day at 14:00: resting projected from the hours covered, no future activity invented
    const mid = day(SUNDAY, { resting: 900, active: 120, asOf: `${SUNDAY}T14:00:00`, now: `${SUNDAY}T14:00:00` })
    expect(mid.partial).toBe(true)
    expect(mid.resting.fullDay).toBe(Math.round((900 * 1440) / 840))
    expect(mid.active.kcal).toBe(120)
    expect(mid.routineSoFar).toBe(Math.round(routineEnergy(p, SUNDAY, WORK, 840).soFar))
  })

  it('4. a reported gym session: not added when Apple Health has it (Hevy), added once when it does not', () => {
    const gym = (outsideHealth: boolean): DayWorkout => ({ id: 'g', origin: 'manual', input: { type: 'strength', durationMin: 60, intensity: 'moderate' }, outsideHealth })
    const inApple = day(SUNDAY, { workouts: [gym(false)] })
    const notInApple = day(SUNDAY, { workouts: [gym(true)] })
    expect(inApple.extra).toBe(0)
    expect(inApple.total).toBe(day(SUNDAY).total)
    expect(notInApple.extra).toBeGreaterThan(0)
    expect(notInApple.total - day(SUNDAY).total).toBe(notInApple.extra)
  })

  it('5. steps and a run overlap: the run counts once — never as steps + workout + extra calories', () => {
    const run: DayWorkout = { id: 'r', origin: 'apple_health', input: { type: 'run', durationMin: 30, distanceKm: 5 }, reportedKcal: 330, sourceApp: 'Strava', startedAt: `${SUNDAY}T19:00:00`, endedAt: `${SUNDAY}T19:30:00` }
    const manualSame: DayWorkout = { id: 'm', origin: 'manual', input: { type: 'run', durationMin: 30, distanceKm: 5 } }
    const e = day(SUNDAY, { workouts: [run, manualSame], steps: 12000 })
    expect(e.total).toBe(day(SUNDAY, { steps: 12000 }).total) // inside Apple's Active Energy; steps not added in Apple mode
    expect(e.workouts.find((w) => w.id === 'm')?.counting).toBe('duplicate')
    // without Apple energy: the steps taken during the run are taken out of the step estimate
    const est = day(SUNDAY, { active: null, resting: null, workouts: [run], steps: 12000 })
    expect(est.estimate.stepsCounted).toBeLessThan(12000)
  })

  it('6. a day without a workout still has rest, daily activity and the routine', () => {
    const e = day(FRIDAY)
    expect(e.resting.fullDay).toBe(1530)
    expect(e.active.kcal).toBe(300)
    expect(e.routine).toBe(Math.round(morning))
    const none = day(FRIDAY, { active: null, resting: null })
    expect(none.mode).toBe('estimate')
    expect(none.total).toBeGreaterThan(1500) // BMR + baseline movement + steps, never zero
  })

  it('confidence: more estimated energy → wider range; an estimate-only day is low', () => {
    const watch = day(SUNDAY, { phoneOnly: false })
    const phone = day(SUNDAY)
    const est = day(SUNDAY, { active: null, resting: null })
    expect(phone.uncertainty).toBeGreaterThan(watch.uncertainty)
    expect(phone.confidence).toBe('medium')
    expect(est.confidence).toBe('low')
  })
})

describe('device', () => {
  it('the setting wins; otherwise a workout from an Apple Watch means a watch', () => {
    expect(healthDeviceOf({}, [])).toBe('phone')
    expect(healthDeviceOf({}, [{ source_app: 'Hevy' }])).toBe('phone')
    expect(healthDeviceOf({}, [{ source_app: 'Apple Watch' }])).toBe('watch')
    expect(healthDeviceOf({ healthDevice: 'phone' }, [{ source_app: 'Apple Watch' }])).toBe('phone')
    expect(routineContextOf({ officeSchedule: { days: [], start: 'x', end: 'y', phoneBreaks: [] } }, []).schedule).toBe(null)
  })
})
