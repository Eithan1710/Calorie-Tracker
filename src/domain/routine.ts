import { metKcalPerMin, restingKcalPerMin, type Profile } from './energy'

/**
 * Daily-routine energy that Apple Health from an iPhone alone cannot see.
 *
 * What Apple Health gives (iPhone, no Apple Watch):
 *   Resting Energy — Apple's basal estimate for all 24 h. It does not depend on carrying the
 *                    phone, so it is used as is (projected for an unfinished day) and never
 *                    added a second time.
 *   Active Energy  — movement the phone's sensors register while it is carried (walking,
 *                    stairs), plus workouts apps such as Hevy or Strava write into Health.
 * What is missing therefore is everyday energy above rest that the phone can't see:
 *   • the short morning/evening routine (getting up, teeth, shower, dressing);
 *   • the hours the user spends at work with the phone left aside (their weekly schedule);
 *   • in a lunch break the phone is there — Apple has the walking, not the seated meal;
 *   • awake time at home: sitting and light chores cost more than rest, and are not steps.
 * Walking time (from steps) and workout time are taken out of the sedentary time, so no minute
 * is costed twice. With an Apple Watch all of this is measured by the watch → nothing is added.
 *
 * Every item is costed with the same method as workouts (energy.ts): energy above the
 * person's own resting rate = (MET × 3.5 × kg / 200 − BMR / 1440) × minutes, never below 0,
 * so it adds to Apple's Resting Energy without counting rest twice. MET values: 2024 Adult
 * Compendium of Physical Activities (self-care; walking very slowly < 3.2 km/h 2.0) and
 * measured values for seated tasks (Mansoubi et al. 2015: computer work ≈ 1.3, TV ≈ 1.1–1.2 METs —
 * lower than the Compendium's general 1.5, and partly including digestion, which is counted on
 * its own). Strict on purpose — the estimate must not inflate the burn. The office mix: mostly
 * seated work, ~4% of the time walking slowly (getting up, coffee, toilet) — no assumption of
 * extra walking without data.
 */
export interface RoutineActivity {
  id: string
  label: string
  met: number
  minutes: number
}

/** The short self-care routine done with the phone aside (every day). */
export const MORNING_ROUTINE: readonly RoutineActivity[] = [
  { id: 'bed', label: 'קימה וסידור המיטה', met: 3.3, minutes: 3 },
  { id: 'grooming', label: 'צחצוח שיניים ורחצת פנים (פעמיים)', met: 2.0, minutes: 6 },
  { id: 'shower', label: 'מקלחת והתנגבות', met: 2.0, minutes: 10 },
  { id: 'dressing', label: 'התלבשות והחלפת בגדים', met: 2.5, minutes: 6 },
]

/** Office minutes without the phone: seated computer work + a little slow walking. */
export const OFFICE_SITTING_MET = 1.3
export const OFFICE_WALKING_MET = 2.0
export const OFFICE_WALKING_SHARE = 0.04

/** A weekly work pattern with the phone left aside. Times are local "HH:MM". */
export interface OfficeSchedule {
  /** days of the week (0 = Sunday) */
  days: number[]
  start: string
  end: string
  /** windows inside the work hours when the phone is with the user (Apple Health measures them) */
  phoneBreaks: [string, string][]
}

const toMin = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}
export const fmtHM = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Hebrew error for a schedule, or null when valid. */
export function officeScheduleError(s: OfficeSchedule): string | null {
  const a = toMin(s.start)
  const b = toMin(s.end)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'צריך שעת התחלה ושעת סיום'
  if (b <= a) return 'שעת הסיום צריכה להיות אחרי שעת ההתחלה'
  if (b - a > 14 * 60) return 'עד 14 שעות ביום'
  if (!s.days.length) return 'צריך לבחור לפחות יום אחד'
  for (const [x, y] of s.phoneBreaks) {
    const bx = toMin(x)
    const by = toMin(y)
    if (!Number.isFinite(bx) || !Number.isFinite(by) || by <= bx) return 'ההפסקה צריכה להתחיל לפני שהיא נגמרת'
    if (bx < a || by > b) return 'ההפסקה צריכה להיות בתוך שעות העבודה'
  }
  return null
}

export const isValidOfficeSchedule = (s: unknown): s is OfficeSchedule =>
  !!s && typeof s === 'object' && Array.isArray((s as OfficeSchedule).days) && Array.isArray((s as OfficeSchedule).phoneBreaks) && officeScheduleError(s as OfficeSchedule) === null

const weekdayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/**
 * The day's no-phone work windows (minutes from midnight), with the phone breaks cut out.
 * Empty on a day off.
 */
export function noPhoneWindows(schedule: OfficeSchedule | null | undefined, date: string): [number, number][] {
  if (!isValidOfficeSchedule(schedule) || !schedule.days.includes(weekdayOf(date))) return []
  let windows: [number, number][] = [[toMin(schedule.start), toMin(schedule.end)]]
  for (const [x, y] of schedule.phoneBreaks) {
    const bx = toMin(x)
    const by = toMin(y)
    windows = windows.flatMap(([a, b]): [number, number][] => {
      if (by <= a || bx >= b) return [[a, b]]
      return [...(bx > a ? [[a, bx] as [number, number]] : []), ...(by < b ? [[by, b] as [number, number]] : [])]
    })
  }
  return windows
}

const covered = (windows: [number, number][], upTo: number) => windows.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, upTo) - a), 0)

/** Energy above this person's resting rate for `minutes` at `met` (never negative). */
export function netKcal(p: Profile, met: number, minutes: number): number {
  return Math.max(0, metKcalPerMin(met, p.weightKg) - restingKcalPerMin(p)) * minutes
}

export interface RoutineLine extends RoutineActivity {
  kcal: number
  /** part done by the snapshot time */
  soFar: number
}

export interface RoutineEnergy {
  kcal: number
  soFar: number
  /** minutes of the day estimated because the phone was away (work hours) */
  noPhoneMinutes: number
  windows: [number, number][]
  /** awake minutes at home costed as sedentary/light (after walking, workouts and self-care were taken out) */
  homeMinutes: number
  /** walking minutes taken out of the home time (steps / 110) */
  walkingMinutes: number
  lines: RoutineLine[]
}

/**
 * Waking day assumed for the everyday-movement estimate: 07:00–23:30 (7.5 h of sleep — Apple's
 * Resting Energy covers the night; nothing is added for sleep).
 */
export const AWAKE: [number, number] = [7 * 60, 23 * 60 + 30]

/**
 * Time at home (awake, not at work) is mostly sedentary but not resting: sitting awake costs more
 * than the basal rate Apple uses for Resting Energy, and light standing chores more still. The
 * phone only sees walking. Conservative mix (no extra walking assumed — steps are Apple's):
 *   80% sitting quietly / phone / TV (MET 1.15) · 5% standing & light chores — cooking, tidying
 *   (MET 2.0) · 15% lying / reclining (≈ rest, adds nothing).
 */
export const HOME_MIX = { sitting: { share: 0.8, met: 1.15 }, light: { share: 0.05, met: 2.0 } } as const
/** per hour of lunch break (phone with him: the walking is Apple's) — eating seated, standing in line */
export const LUNCH_PER_HOUR = { eating: { minutes: 35, met: 1.3 }, standing: { minutes: 10, met: 1.3 } } as const
/** step cadence used to take walking time out of the sedentary estimate */
const WALK_SPM = 110

const minus = (base: [number, number][], cut: [number, number][]) =>
  cut.reduce(
    (ws, [x, y]) => ws.flatMap(([a, b]): [number, number][] => (y <= a || x >= b ? [[a, b]] : [...(x > a ? [[a, x] as [number, number]] : []), ...(y < b ? [[y, b] as [number, number]] : [])])),
    base,
  )

export interface RoutineActivityInput {
  /** steps that count as walking (after the steps of runs/walks were taken out) — Apple's or typed */
  stepsCounted?: number
  /** minutes of the day's (non-duplicate) workouts — their energy is counted on its own */
  workoutMinutes?: number
}

/**
 * The day's routine energy above rest: the self-care routine, the work hours without the phone,
 * the unmeasured part of the lunch break, and the sedentary/light time at home. `minutesSoFar` =
 * minutes of the day covered by the snapshot: each part counts as its hours pass (the short
 * self-care routine from the start of the day). Walking time (from steps) and workout time are
 * taken out of the home time first, so those minutes are never costed twice.
 */
export function routineEnergy(p: Profile, date: string, schedule?: OfficeSchedule | null, minutesSoFar = 1440, activity: RoutineActivityInput = {}): RoutineEnergy {
  const lines: RoutineLine[] = MORNING_ROUTINE.map((a) => {
    const kcal = netKcal(p, a.met, a.minutes)
    return { ...a, kcal, soFar: kcal }
  })
  const line = (id: string, label: string, met: number, minutes: number, done: number) => {
    if (minutes <= 0) return
    const kcal = netKcal(p, met, minutes)
    lines.push({ id, label, met, minutes, kcal, soFar: kcal * done })
  }

  // work hours without the phone
  const windows = noPhoneWindows(schedule, date)
  const total = covered(windows, 1440)
  const workDay = total > 0 && isValidOfficeSchedule(schedule)
  if (total > 0) {
    const done = covered(windows, minutesSoFar) / total
    const walk = Math.round(total * OFFICE_WALKING_SHARE)
    line('office_sitting', 'עבודה מול מחשב בלי הטלפון', OFFICE_SITTING_MET, total - walk, done)
    line('office_moving', 'קימות והליכה קצרה במשרד', OFFICE_WALKING_MET, walk, done)
  }

  // lunch break(s): the phone is there, so Apple has the walking — not the seated meal or standing in line
  const breaks: [number, number][] = workDay ? schedule!.phoneBreaks.map(([x, y]) => [toMin(x), toMin(y)]) : []
  const breakMin = covered(breaks, 1440)
  if (breakMin > 0) {
    const done = covered(breaks, minutesSoFar) / breakMin
    line('lunch_eating', 'ארוחת צהריים בישיבה', LUNCH_PER_HOUR.eating.met, Math.round((breakMin / 60) * LUNCH_PER_HOUR.eating.minutes), done)
    line('lunch_standing', 'עמידה בתור / המתנה', LUNCH_PER_HOUR.standing.met, Math.round((breakMin / 60) * LUNCH_PER_HOUR.standing.minutes), done)
  }

  // awake at home: sedentary but above rest (minus walking, workouts and the self-care routine)
  const homeWindows = workDay ? minus([AWAKE], [[toMin(schedule!.start), toMin(schedule!.end)]]) : [AWAKE]
  const homeSpan = covered(homeWindows, 1440)
  const morning = MORNING_ROUTINE.reduce((s, a) => s + a.minutes, 0)
  const walking = Math.round(Math.max(0, activity.stepsCounted ?? 0) / WALK_SPM)
  const home = Math.max(0, homeSpan - morning - walking - Math.max(0, activity.workoutMinutes ?? 0))
  if (home > 0) {
    const done = covered(homeWindows, minutesSoFar) / homeSpan
    line('home_sitting', 'ישיבה בבית (מחשב, טלפון, טלוויזיה)', HOME_MIX.sitting.met, Math.round(home * HOME_MIX.sitting.share), done)
    line('home_light', 'עמידה ועבודות בית קלות', HOME_MIX.light.met, Math.round(home * HOME_MIX.light.share), done)
  }

  return {
    kcal: lines.reduce((s, l) => s + l.kcal, 0),
    soFar: lines.reduce((s, l) => s + l.soFar, 0),
    noPhoneMinutes: total,
    windows,
    homeMinutes: home,
    walkingMinutes: walking,
    lines,
  }
}

export type HealthDevice = 'phone' | 'watch'

/**
 * What measures Active Energy for this user. Chosen in settings; until then: an Apple Watch
 * if a workout ever arrived from one, otherwise the iPhone alone.
 */
export function healthDeviceOf(settings: { healthDevice?: HealthDevice }, exercises: Iterable<{ source_app?: string | null }>): HealthDevice {
  if (settings.healthDevice === 'phone' || settings.healthDevice === 'watch') return settings.healthDevice
  for (const e of exercises) if (e.source_app && /watch/i.test(e.source_app)) return 'watch'
  return 'phone'
}

/**
 * What the energy model needs to know about the routine. It is used only next to Apple Health's
 * measured Active Energy from an iPhone alone; days without Apple data keep the estimate model
 * (with its own 5%-of-BMR everyday-movement term), unchanged.
 */
export interface RoutineContext {
  phoneOnly: boolean
  schedule: OfficeSchedule | null
}

export function routineContextOf(
  settings: { healthDevice?: HealthDevice; officeSchedule?: OfficeSchedule | null },
  exercises: Iterable<{ source_app?: string | null }>,
): RoutineContext {
  return {
    phoneOnly: healthDeviceOf(settings, exercises) === 'phone',
    schedule: isValidOfficeSchedule(settings.officeSchedule) ? settings.officeSchedule : null,
  }
}
