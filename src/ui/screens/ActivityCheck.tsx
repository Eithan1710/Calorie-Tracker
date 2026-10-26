import { useState } from 'react'
import { Check, X } from 'lucide-react'
import { deleteExercise, updateSettings, upsertExercise, useStore } from '../../data/store'
import type { Exercise } from '../../data/types'
import { isValidProfile, workoutDisplay, type ExerciseType } from '../../domain/energy'
import { newId } from '../../../supabase/functions/_shared/nutrition.ts'
import { EXERCISE_META } from '../exerciseMeta'
import { fmt, haptic, KCAL } from '../format'
import { showToast } from '../toast'

/**
 * "Anything the phone didn't see today?" — a few one-tap questions about activities Apple Health
 * may not have. Only asks about what isn't recorded yet: an activity type already logged for the
 * day (by hand or imported from Apple Health) is never asked again, a "no" is remembered for the
 * day, and the whole check can be skipped. An answer becomes a regular workout entry, so it goes
 * through the same rules as any workout: when Apple Health already measured it (Hevy, Strava,
 * the phone in a pocket) nothing is added on top of Active Energy; otherwise its estimate is.
 */
interface CheckItem {
  id: string
  type: ExerciseType
  label: string
  minutes: number[]
  /** Apple Health usually has it already (the app writes it there / the phone is carried) */
  measuredByDefault: boolean
  measuredLabel: string
  distance?: boolean
}

export const ACTIVITY_CHECKS: CheckItem[] = [
  { id: 'gym', type: 'strength', label: 'חדר כושר', minutes: [45, 60, 75, 90], measuredByDefault: true, measuredLabel: 'נרשם ב-Hevy (כבר ב-Apple Health)' },
  { id: 'run', type: 'run', label: 'ריצה', minutes: [20, 30, 45, 60], measuredByDefault: true, measuredLabel: 'נמדד ב-Strava / הטלפון היה עליי', distance: true },
  { id: 'walk', type: 'walk', label: 'הליכה מעבר לרגיל', minutes: [15, 30, 45, 60], measuredByDefault: false, measuredLabel: 'הטלפון היה עליי' },
  { id: 'salsa', type: 'dance', label: 'סלסה / ריקוד', minutes: [60, 90, 120, 150], measuredByDefault: false, measuredLabel: 'נמדד ב-Apple Health' },
  { id: 'climbing', type: 'climbing', label: 'טיפוס / בולדרינג', minutes: [45, 60, 90, 120], measuredByDefault: false, measuredLabel: 'נמדד ב-Apple Health' },
  { id: 'other', type: 'other', label: 'פעילות אחרת', minutes: [20, 30, 45, 60], measuredByDefault: false, measuredLabel: 'נמדד ב-Apple Health' },
]

/** Questions still open for the day. */
export function pendingChecks(date: string, exercises: Exercise[], answers: { no: string[]; skipped?: boolean } | undefined): CheckItem[] {
  if (answers?.skipped) return []
  const logged = new Set(exercises.filter((e) => !e.deleted).map((e) => e.type))
  return ACTIVITY_CHECKS.filter((c) => !logged.has(c.type) && !answers?.no.includes(c.id))
}

export function ActivityCheck({ date, exercises, isToday }: { date: string; exercises: Exercise[]; isToday: boolean }) {
  const settings = useStore((s) => s.settings)
  const appleActive = useStore((s) => s.health[date]?.active_kcal != null)
  const answers = settings.activityCheck?.[date]
  const pending = pendingChecks(date, exercises, answers)
  const [open, setOpen] = useState<string | null>(null)
  if (!pending.length || !isValidProfile(settings.profile)) return null

  const remember = (patch: { no?: string; skipped?: boolean }) => {
    const all = { ...(settings.activityCheck ?? {}) }
    const cur = all[date] ?? { no: [] }
    all[date] = { no: patch.no ? [...cur.no, patch.no] : cur.no, skipped: patch.skipped ?? cur.skipped }
    // keep two weeks of answers
    for (const d of Object.keys(all).sort().slice(0, -14)) delete all[d]
    updateSettings({ activityCheck: all })
  }

  return (
    <section aria-label="השלמת פעילות" className="card animate-rise p-4" data-testid="activity-check">
      <div className="flex items-start justify-between gap-3 px-1">
        <div>
          <p className="text-sm font-medium text-ink-3">השלמה מהירה</p>
          <p className="font-semibold">{isToday ? 'עשית היום משהו שהטלפון לא ראה?' : 'היה ביום הזה משהו שהטלפון לא ראה?'}</p>
        </div>
        <button type="button" onClick={() => remember({ skipped: true })} className="pressable min-h-9 shrink-0 rounded-xl px-2 text-sm text-ink-3">
          דלג
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="פעילויות">
        {pending.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-expanded={open === c.id}
            onClick={() => setOpen(open === c.id ? null : c.id)}
            className={`pressable flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${open === c.id ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink'}`}
          >
            <span aria-hidden>{EXERCISE_META[c.type].emoji}</span>
            {c.label}
          </button>
        ))}
      </div>
      {open && (
        <CheckForm
          key={open}
          item={pending.find((c) => c.id === open)!}
          date={date}
          appleActive={appleActive}
          onNo={(id) => {
            remember({ no: id })
            setOpen(null)
          }}
          onDone={() => setOpen(null)}
        />
      )}
    </section>
  )
}

function CheckForm({ item, date, appleActive, onNo, onDone }: { item: CheckItem; date: string; appleActive: boolean; onNo: (id: string) => void; onDone: () => void }) {
  const profile = useStore((s) => s.settings.profile)
  const [minutes, setMinutes] = useState<number | null>(null)
  const [km, setKm] = useState('')
  const [measured, setMeasured] = useState(item.measuredByDefault)
  const distance = item.distance && km.trim() ? Number(km.replace(',', '.')) : undefined
  const validKm = distance === undefined || (Number.isFinite(distance) && distance > 0 && distance < 100)
  const est = minutes && isValidProfile(profile) ? workoutDisplay({ type: item.type, durationMin: minutes, distanceKm: distance, intensity: 'moderate' }, profile) : null
  // nothing to add when Apple Health has no Active Energy for the day: the estimate model counts it either way
  const adds = !appleActive || !measured

  const save = () => {
    if (!minutes || !validKm) return
    const now = new Date().toISOString()
    const ex: Exercise = {
      id: newId(),
      date,
      type: item.type,
      duration_min: minutes,
      distance_km: distance,
      intensity: item.type === 'run' && distance ? undefined : 'moderate',
      rest: item.type === 'strength' ? 'standard' : undefined,
      outside_health: appleActive && !measured ? true : undefined,
      created_at: now,
      updated_at: now,
    }
    upsertExercise(ex)
    haptic(18)
    onDone()
    showToast(adds && est ? `${EXERCISE_META[item.type].emoji} נוסף · ~${fmt(est.kcal)} ${KCAL} (הערכה)` : `${EXERCISE_META[item.type].emoji} נרשם · כבר בתוך Apple Health`, {
      label: 'ביטול',
      run: () => deleteExercise(ex.id),
    })
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-surface-2 p-3" data-testid="activity-check-form">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="כמה זמן">
        {item.minutes.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={minutes === m}
            onClick={() => setMinutes(m)}
            className={`pressable min-h-10 rounded-full px-3 text-sm font-medium ${minutes === m ? 'bg-ink text-inverse' : 'bg-surface text-ink'}`}
          >
            {m >= 90 && m % 30 === 0 ? `${m / 60} שע׳` : `${m} דק׳`}
          </button>
        ))}
      </div>
      {item.distance && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          ק״מ (לא חובה)
          <input
            inputMode="decimal"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            aria-invalid={!validKm}
            className="num ltr min-h-10 w-20 rounded-xl bg-surface px-3 text-end outline-none focus:ring-2 focus:ring-info"
          />
        </label>
      )}
      {appleActive && (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={measured} onChange={(e) => setMeasured(e.target.checked)} className="size-4 accent-[var(--ink)]" />
          {item.measuredLabel}
        </label>
      )}
      {est && (
        <p className="text-xs text-ink-3" data-testid="activity-check-estimate">
          {adds ? `יתווסף ~${fmt(est.kcal)} ${KCAL} (הערכה לפי משך ומשקל, ±${Math.round(((est.high ?? est.kcal) - est.kcal) / 10) * 10})` : 'כבר בתוך האנרגיה הפעילה של Apple Health — נרשם בלי להוסיף קלוריות'}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!minutes || !validKm}
          className="pressable flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink px-4 font-semibold text-inverse disabled:opacity-40"
        >
          <Check className="size-4" aria-hidden /> כן, שמור
        </button>
        <button type="button" onClick={() => onNo(item.id)} className="pressable flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-surface px-4 font-medium text-ink-2">
          <X className="size-4" aria-hidden /> לא היום
        </button>
      </div>
    </div>
  )
}
