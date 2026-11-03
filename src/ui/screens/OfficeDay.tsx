import { Briefcase, Home } from 'lucide-react'
import { getState, updateSettings, useStore } from '../../data/store'
import { fmtHM, healthDeviceOf, isOfficeOff, isScheduledWorkday, isValidOfficeSchedule, noPhoneWindows, withOfficeDay } from '../../domain/routine'
import { pushProfile } from '../../services/sync'
import { haptic } from '../format'
import { showToast } from '../toast'

/**
 * On a work day of the weekly schedule (Sun–Thu…): "I wasn't at the office". The work hours then
 * count as an ordinary day at home — the phone is with the user, Apple Health measures the walking —
 * instead of desk work without the phone. One tap, undoable; saved with the schedule (synced).
 */
export function OfficeDay({ date, isToday }: { date: string; isToday: boolean }) {
  const settings = useStore((s) => s.settings)
  const exercise = useStore((s) => s.exercise)
  const schedule = isValidOfficeSchedule(settings.officeSchedule) ? settings.officeSchedule : null
  if (!schedule || !isScheduledWorkday(schedule, date) || healthDeviceOf(settings, Object.values(exercise)) !== 'phone') return null
  const away = isOfficeOff(schedule, date)
  const hours = `${schedule.start}–${schedule.end}`

  const set = (next: boolean) => {
    // the latest saved schedule (an undo may run after other changes)
    const cur = getState().settings.officeSchedule
    const base = isValidOfficeSchedule(cur) ? cur : schedule
    // the server copy of each day is recomputed with it on the next sync
    updateSettings({ officeSchedule: withOfficeDay(base, date, next), summariesVersion: undefined })
    void pushProfile()
    haptic(12)
    showToast(next ? (isToday ? 'סומן: לא במשרד היום' : 'סומן: לא במשרד ביום הזה') : 'סומן: במשרד', { label: 'ביטול', run: () => set(!next) })
  }

  return (
    <section aria-label="יום עבודה" className="card flex items-center gap-3 p-4" data-testid="office-day">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2" aria-hidden>
        {away ? <Home className="size-5 text-ink-2" /> : <Briefcase className="size-5 text-ink-2" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{away ? 'לא במשרד' : 'יום עבודה במשרד'}</p>
        <p className="text-xs text-ink-3">
          {away
            ? `השעות ${hours} נספרות כיום רגיל בבית (הטלפון איתך)`
            : `${noPhoneWindows(schedule, date).map(([a, b]) => `${fmtHM(a)}–${fmtHM(b)}`).join(', ')} בלי הטלפון`}
        </p>
      </div>
      <button
        type="button"
        aria-pressed={away}
        onClick={() => set(!away)}
        className="pressable min-h-10 shrink-0 rounded-full bg-surface-2 px-3 text-sm font-medium text-ink"
      >
        {away ? 'הייתי במשרד' : isToday ? 'לא במשרד היום' : 'לא הייתי במשרד'}
      </button>
    </section>
  )
}
