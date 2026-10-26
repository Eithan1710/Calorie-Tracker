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
  const lines = (r: ReturnType<typeof routineEnergy>) => Object.fromEntries(r.lines.map((l) => [l.id, l]))

  it('work day: 7.5 h without the phone — 96% seated computer work (MET 1.5), 4% slow walking (MET 2.0)', () => {
    const r = routineEnergy(p, SUNDAY, WORK)
    const l = lines(r)
    expect(r.noPhoneMinutes).toBe(450)
    expect(l.office_sitting.minutes + l.office_moving.minutes).toBe(450)
    expect(l.office_moving.minutes).toBe(18)
    expect(l.office_sitting.kcal).toBeCloseTo(net(1.5, 432), 5)
    expect(l.office_moving.kcal).toBeCloseTo(net(2.0, 18), 5)
  })

  it('lunch break: the phone is there (walking = Apple) — only the seated meal and standing in line are added', () => {
    const l = lines(routineEnergy(p, SUNDAY, WORK))
    expect(l.lunch_eating.minutes).toBe(35)
    expect(l.lunch_eating.met).toBe(1.5)
    expect(l.lunch_standing.minutes).toBe(10)
    // 15 of the 60 minutes are left to Apple Health (walking to / from lunch)
    expect(l.lunch_eating.minutes + l.lunch_standing.minutes).toBeLessThan(60)
  })

  it('home: awake 07:00–23:30 minus work hours, self-care, walking (steps) and workouts — 75% sitting, 10% light', () => {
    const none = routineEnergy(p, SUNDAY, WORK)
    expect(none.homeMinutes).toBe(990 - 510 - 25) // 455
    const active = routineEnergy(p, SUNDAY, WORK, 1440, { stepsCounted: 7700, workoutMinutes: 90 })
    expect(active.walkingMinutes).toBe(70)
    expect(active.homeMinutes).toBe(455 - 70 - 90) // walking and the gym are never also costed as sitting
    const l = lines(active)
    expect(l.home_sitting.minutes).toBe(Math.round(295 * 0.75))
    expect(l.home_light.minutes).toBe(Math.round(295 * 0.1))
    expect(l.home_sitting.kcal).toBeCloseTo(net(1.3, Math.round(295 * 0.75)), 5)
  })

  it('day off: no work hours or lunch — self-care and the longer home time', () => {
    const r = routineEnergy(p, FRIDAY, WORK, 1440, { stepsCounted: 7000 })
    expect(r.noPhoneMinutes).toBe(0)
    expect(r.lines.some((l) => l.id.startsWith('office') || l.id.startsWith('lunch'))).toBe(false)
    expect(r.homeMinutes).toBe(990 - 25 - 64)
  })

  it('realistic size, not inflated: ≈ 430 kcal on a work day, ≈ 340 on a day off (59 kg, 7,000 steps)', () => {
    const work = routineEnergy(p, SUNDAY, WORK, 1440, { stepsCounted: 7000 }).kcal
    const off = routineEnergy(p, FRIDAY, WORK, 1440, { stepsCounted: 7000 }).kcal
    expect(work).toBeGreaterThan(380)
    expect(work).toBeLessThan(480)
    expect(off).toBeGreaterThan(300)
    expect(off).toBeLessThan(380)
    expect(work - off).toBeGreaterThan(50) // desk work costs a little more than the home mix
    // the whole day stays a plausible sedentary-to-light day: BMR × ~1.5 with Apple's walking and digestion
    const bmr = bmrMifflinStJeor(p)
    const pal = (bmr + work + 200 + 170) / bmr
    expect(pal).toBeGreaterThan(1.4)
    expect(pal).toBeLessThan(1.7)
  })

  it('never below zero, even for a body whose rest exceeds the MET rate', () => {
    expect(netKcal({ ...p, weightKg: 40, heightCm: 200 }, 1.0, 60)).toBe(0)
  })

  it('"so far": each part counts as its hours pass; nothing before 07:00 except the self-care routine', () => {
    const at = (h: number) => routineEnergy(p, SUNDAY, WORK, h * 60).soFar
    expect(at(6)).toBeCloseTo(morning, 5)
    expect(at(18)).toBeLessThan(routineEnergy(p, SUNDAY, WORK).kcal) // the evening at home is still ahead
    expect(at(24)).toBeCloseTo(routineEnergy(p, SUNDAY, WORK).kcal, 5)
  })
})

describe('daily total — scenarios', () => {
  it('1. regular work day: Apple Health for the day + an estimate for the hours without the phone', () => {
    const e = day(SUNDAY)
    const r = routineEnergy(p, SUNDAY, WORK, 1440, { stepsCounted: 7000 })
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
    // Active Energy missing → movement estimated from steps (+ the model's baseline term); Apple's resting kept;
    // the routine is not added on top of an estimate that already has everyday movement in it
    const noActive = day(SUNDAY, { active: null })
    expect(noActive.resting.source).toBe('apple')
    expect(noActive.active.source).toBe('estimate')
    expect(noActive.routine).toBe(0)
    expect(Math.abs(noActive.active.kcal - (noActive.estimate.baseline + noActive.estimate.steps))).toBeLessThan(2)
    // unfinished day at 14:00: resting projected from the hours covered, no future activity invented
    const mid = day(SUNDAY, { resting: 900, active: 120, asOf: `${SUNDAY}T14:00:00`, now: `${SUNDAY}T14:00:00` })
    expect(mid.partial).toBe(true)
    expect(mid.resting.fullDay).toBe(Math.round((900 * 1440) / 840))
    expect(mid.active.kcal).toBe(120)
    expect(mid.routineSoFar).toBe(Math.round(routineEnergy(p, SUNDAY, WORK, 840, { stepsCounted: 7000 }).soFar))
  })

  it('4. a reported gym session: not added when Apple Health has it (Hevy), added once when it does not', () => {
    const gym = (outsideHealth: boolean): DayWorkout => ({ id: 'g', origin: 'manual', input: { type: 'strength', durationMin: 60, intensity: 'moderate' }, outsideHealth })
    const inApple = day(SUNDAY, { workouts: [gym(false)] })
    const notInApple = day(SUNDAY, { workouts: [gym(true)] })
    expect(inApple.extra).toBe(0)
    expect(inApple.active.kcal).toBe(300) // Apple's number, nothing added for the gym
    // its 60 minutes were not spent sitting at home: that part of the home estimate goes away
    const homeShare = day(SUNDAY).total - inApple.total
    expect(homeShare).toBeGreaterThan(0)
    expect(homeShare).toBeLessThan(30)
    expect(notInApple.extra).toBeGreaterThan(0)
    expect(Math.abs(notInApple.total - inApple.total - notInApple.extra)).toBeLessThan(2) // added exactly once (±1 rounding)
  })

  it('5. steps and a run overlap: the run counts once — never as steps + workout + extra calories', () => {
    const run: DayWorkout = { id: 'r', origin: 'apple_health', input: { type: 'run', durationMin: 30, distanceKm: 5 }, reportedKcal: 330, sourceApp: 'Strava', startedAt: `${SUNDAY}T19:00:00`, endedAt: `${SUNDAY}T19:30:00` }
    const manualSame: DayWorkout = { id: 'm', origin: 'manual', input: { type: 'run', durationMin: 30, distanceKm: 5 } }
    const e = day(SUNDAY, { workouts: [run, manualSame], steps: 12000 })
    // inside Apple's Active Energy: nothing added for the run, and steps are not added in Apple mode
    expect(e.extra).toBe(0)
    expect(e.active.kcal).toBe(300)
    // the run's minutes leave the sedentary estimate; its steps leave the walking time — a small shift, no new energy
    expect(Math.abs(e.total - day(SUNDAY, { steps: 12000 }).total)).toBeLessThan(15)
    expect(e.workouts.find((w) => w.id === 'm')?.counting).toBe('duplicate')
    // without Apple energy: the steps taken during the run are taken out of the step estimate
    const est = day(SUNDAY, { active: null, resting: null, workouts: [run], steps: 12000 })
    expect(est.estimate.stepsCounted).toBeLessThan(12000)
  })

  it('6. a day without a workout still has rest, daily activity and the routine', () => {
    const e = day(FRIDAY)
    expect(e.resting.fullDay).toBe(1530)
    expect(e.active.kcal).toBe(300)
    expect(e.routine).toBe(Math.round(routineEnergy(p, FRIDAY, WORK, 1440, { stepsCounted: 7000 }).kcal))
    expect(e.routineDetail?.noPhoneMinutes).toBe(0) // no work hours on Friday
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
