import type { Profile } from './energy'

/**
 * Daily-routine movement that an iPhone on its own does not measure.
 *
 * Apple Health's Active Energy from an iPhone alone comes from the phone's motion sensors —
 * in practice walking and stairs while the phone is carried. Getting out of bed, brushing
 * teeth, showering and dressing happen with the phone on the table, so they are missing.
 * An Apple Watch is worn through them and measures them itself → nothing is added then.
 * In the estimate model (no Apple energy) the baseline-movement term already covers them.
 *
 * Energy above rest per activity = (MET − 1) × kg × hours, with MET values from the
 * Compendium of Physical Activities: grooming 2.0, showering 2.0, dressing 2.5, making the
 * bed 3.3 (self-care), office work at a computer, sitting 1.5 (occupation, light sitting tasks).
 * Minutes are a typical day; office hours only on work days (Sunday–Thursday).
 * Apple's Resting Energy is a basal value for 24 h, so only the part above it is added.
 */
export interface RoutineActivity {
  id: string
  label: string
  met: number
  minutes: number
  /** days of the week it happens (0 = Sunday); absent = every day */
  weekdays?: readonly number[]
  /** local hours it usually takes place in, [start, end) — spreads it over the day for "burned so far" */
  hours?: readonly [number, number]
}

export const ROUTINE_ACTIVITIES: readonly RoutineActivity[] = [
  { id: 'bed', label: 'קימה וסידור המיטה', met: 3.3, minutes: 3 },
  { id: 'grooming', label: 'צחצוח שיניים ורחצת פנים (פעמיים)', met: 2.0, minutes: 6 },
  { id: 'shower', label: 'מקלחת והתנגבות', met: 2.0, minutes: 10 },
  { id: 'dressing', label: 'התלבשות והחלפת בגדים', met: 2.5, minutes: 6 },
  // the phone stays off him at work: 9 h at a desk, Sunday–Thursday
  { id: 'office', label: 'עבודה במשרד מול מחשב', met: 1.5, minutes: 9 * 60, weekdays: [0, 1, 2, 3, 4], hours: [8, 17] },
]

const weekdayOf = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/**
 * The day's routine energy above rest. `minutesSoFar` (minutes of the day covered) gives the part
 * done by then: activities with set hours count as they happen; the short ones count from the
 * start of the day (most of them are the morning routine).
 */
export function routineEnergy(
  p: Pick<Profile, 'weightKg'>,
  date?: string,
  minutesSoFar = 1440,
): { kcal: number; soFar: number; items: (RoutineActivity & { kcal: number })[] } {
  const wd = date ? weekdayOf(date) : null
  const items = ROUTINE_ACTIVITIES.filter((a) => !a.weekdays || wd === null || a.weekdays.includes(wd)).map((a) => ({
    ...a,
    kcal: (a.met - 1) * p.weightKg * (a.minutes / 60),
  }))
  const done = (a: RoutineActivity) => {
    if (!a.hours) return 1
    const [h0, h1] = a.hours
    return Math.min(1, Math.max(0, (minutesSoFar - h0 * 60) / ((h1 - h0) * 60)))
  }
  return { kcal: items.reduce((s, a) => s + a.kcal, 0), soFar: items.reduce((s, a) => s + a.kcal * done(a), 0), items }
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
