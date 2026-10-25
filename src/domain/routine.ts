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
 * Compendium of Physical Activities (self-care codes): grooming 2.0, showering 2.0,
 * dressing 2.5, making the bed 3.3. Minutes are a typical day.
 */
export interface RoutineActivity {
  id: string
  label: string
  met: number
  minutes: number
}

export const ROUTINE_ACTIVITIES: readonly RoutineActivity[] = [
  { id: 'bed', label: 'קימה וסידור המיטה', met: 3.3, minutes: 3 },
  { id: 'grooming', label: 'צחצוח שיניים ורחצת פנים (פעמיים)', met: 2.0, minutes: 6 },
  { id: 'shower', label: 'מקלחת והתנגבות', met: 2.0, minutes: 10 },
  { id: 'dressing', label: 'התלבשות והחלפת בגדים', met: 2.5, minutes: 6 },
]

export function routineEnergy(p: Pick<Profile, 'weightKg'>): { kcal: number; items: (RoutineActivity & { kcal: number })[] } {
  const items = ROUTINE_ACTIVITIES.map((a) => ({ ...a, kcal: (a.met - 1) * p.weightKg * (a.minutes / 60) }))
  return { kcal: items.reduce((s, a) => s + a.kcal, 0), items }
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
