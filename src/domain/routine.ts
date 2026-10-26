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
 * What is missing therefore is movement done *without the phone*:
 *   • the short morning/evening routine (getting up, teeth, shower, dressing);
 *   • the hours the user spends at work with the phone left aside (their weekly schedule);
 *     the breaks in which the phone is with them are left to Apple Health.
 * With an Apple Watch all of this is measured by the watch → nothing is added.
 *
 * Every item is costed with the same method as workouts (energy.ts): energy above the
 * person's own resting rate = (MET × 3.5 × kg / 200 − BMR / 1440) × minutes, never below 0,
 * so it adds to Apple's Resting Energy without counting rest twice. MET values: 2024 Adult
 * Compendium of Physical Activities (self-care; sitting light office/computer work 1.5;
 * walking very slowly < 3.2 km/h 2.0). The office mix is deliberately conservative: mostly
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
export const OFFICE_SITTING_MET = 1.5
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
  lines: RoutineLine[]
}

/**
 * The day's routine energy above rest. `minutesSoFar` = minutes of the day covered by the
 * snapshot: the work hours count as they pass; the short self-care routine counts from the
 * start of the day (it is mostly the morning).
 */
export function routineEnergy(p: Profile, date: string, schedule?: OfficeSchedule | null, minutesSoFar = 1440): RoutineEnergy {
  const lines: RoutineLine[] = MORNING_ROUTINE.map((a) => {
    const kcal = netKcal(p, a.met, a.minutes)
    return { ...a, kcal, soFar: kcal }
  })
  const windows = noPhoneWindows(schedule, date)
  const total = covered(windows, 1440)
  if (total > 0) {
    const done = covered(windows, minutesSoFar) / total
    const walk = Math.round(total * OFFICE_WALKING_SHARE)
    const sit = total - walk
    const sitKcal = netKcal(p, OFFICE_SITTING_MET, sit)
    const walkKcal = netKcal(p, OFFICE_WALKING_MET, walk)
    lines.push(
      { id: 'office_sitting', label: 'עבודה מול מחשב בלי הטלפון', met: OFFICE_SITTING_MET, minutes: sit, kcal: sitKcal, soFar: sitKcal * done },
      { id: 'office_moving', label: 'קימות והליכה קצרה במשרד', met: OFFICE_WALKING_MET, minutes: walk, kcal: walkKcal, soFar: walkKcal * done },
    )
  }
  return {
    kcal: lines.reduce((s, l) => s + l.kcal, 0),
    soFar: lines.reduce((s, l) => s + l.soFar, 0),
    noPhoneMinutes: total,
    windows,
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

/** What the energy model needs to know about the routine. */
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
