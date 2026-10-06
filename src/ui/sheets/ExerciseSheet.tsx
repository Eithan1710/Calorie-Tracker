import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Sheet, PrimaryButton, NumberField, Segmented } from '../primitives'
import { deleteExercise, exercisesForDate, getState, upsertExercise, useStore } from '../../data/store'
import type { Exercise } from '../../data/types'
import { isValidProfile, paceSecPerKm, workoutDisplayKcal, type ExerciseType, type Intensity } from '../../domain/energy'
import { toExerciseInput } from '../../domain/day'
import { newId } from '../../../supabase/functions/_shared/nutrition.ts'
import { fmt, fmtPace, haptic, KCAL } from '../format'
import { showToast } from '../toast'

export const EXERCISE_META: Record<ExerciseType, { label: string; emoji: string }> = {
  run: { label: 'ריצה', emoji: '🏃' },
  strength: { label: 'כוח', emoji: '🏋️' },
  cycling: { label: 'אופניים', emoji: '🚴' },
  swimming: { label: 'שחייה', emoji: '🏊' },
  other: { label: 'אחר', emoji: '⚡' },
}

const INTENSITY: { value: Intensity; label: string }[] = [
  { value: 'low', label: 'קלה' },
  { value: 'moderate', label: 'בינונית' },
  { value: 'high', label: 'גבוהה' },
]

/** "25", "25:30", "1:05:00" → minutes */
export function parseDuration(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  if (/^\d+([.,]\d+)?$/.test(t)) return parseFloat(t.replace(',', '.'))
  const parts = t.split(':').map(Number)
  if (parts.some((p) => !Number.isFinite(p))) return null
  if (parts.length === 2) return parts[0] + parts[1] / 60
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / 60
  return null
}

export function ExerciseSheet({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const profile = useStore((s) => s.settings.profile)
  const exMap = useStore((s) => s.exercise)
  const existing = useMemo(() => exercisesForDate({ ...getState(), exercise: exMap }, date), [exMap, date])
  const [type, setType] = useState<ExerciseType>('strength')
  const [distance, setDistance] = useState<number | ''>('')
  const [time, setTime] = useState('')
  const [intensity, setIntensity] = useState<Intensity>('moderate')

  useEffect(() => {
    if (open) {
      setDistance('')
      setTime('')
      setIntensity('moderate')
    }
  }, [open])

  const minutes = parseDuration(time) ?? undefined
  const input = { type, distanceKm: type === 'run' && distance !== '' ? distance : undefined, durationMin: minutes, intensity }
  const kcal = isValidProfile(profile) ? workoutDisplayKcal(input, profile) : 0
  const pace = paceSecPerKm(input)
  const valid = type === 'run' ? Boolean(input.distanceKm || minutes) : Boolean(minutes)

  const save = () => {
    if (!valid) return
    const now = new Date().toISOString()
    const ex: Exercise = {
      id: newId(),
      date,
      type,
      distance_km: input.distanceKm,
      duration_min: minutes ? Math.round(minutes * 10) / 10 : undefined,
      intensity: type === 'run' && input.distanceKm ? undefined : intensity,
      created_at: now,
      updated_at: now,
    }
    upsertExercise(ex)
    haptic(18)
    onClose()
    showToast(`${EXERCISE_META[type].emoji} נוסף · ~${fmt(kcal)} ${KCAL}`, { label: 'ביטול', run: () => deleteExercise(ex.id) })
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="אימון"
      footer={
        <PrimaryButton className="w-full" onClick={save} disabled={!valid}>
          {valid && kcal ? `הוסף · ~${fmt(kcal)} ${KCAL}` : 'הוסף אימון'}
        </PrimaryButton>
      }
    >
      <div className="flex flex-col gap-5 pt-1">
        {existing.length > 0 && (
          <ul className="flex flex-col gap-1" aria-label="אימונים היום">
            {existing.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-2xl bg-surface-2 py-2 ps-3 pe-1">
                <span className="text-xl" aria-hidden>{EXERCISE_META[e.type].emoji}</span>
                <span className="flex-1">
                  {EXERCISE_META[e.type].label}
                  {e.distance_km ? ` · ${e.distance_km} ק״מ` : ''}
                  {e.duration_min ? ` · ${Math.round(e.duration_min)} דק׳` : ''}
                  {isValidProfile(profile) && <span className="text-ink-3"> · ~{fmt(workoutDisplayKcal(toExerciseInput(e), profile))}</span>}
                </span>
                <button type="button" onClick={() => deleteExercise(e.id)} className="pressable grid size-10 place-items-center rounded-xl text-ink-3 hover:text-surplus" aria-label={`מחק ${EXERCISE_META[e.type].label}`}>
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div role="radiogroup" aria-label="סוג אימון" className="grid grid-cols-5 gap-2">
          {(Object.keys(EXERCISE_META) as ExerciseType[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`pressable flex min-h-18 flex-col items-center justify-center gap-1 rounded-2xl text-sm font-medium transition-colors ${type === t ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2'}`}
            >
              <span className="text-2xl" aria-hidden>{EXERCISE_META[t].emoji}</span>
              {EXERCISE_META[t].label}
            </button>
          ))}
        </div>

        {type === 'run' ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="מרחק" unit="ק״מ" value={distance} onChange={setDistance} step={0.1} min={0} placeholder="5" />
            <TimeField value={time} onChange={setTime} />
          </div>
        ) : (
          <>
            <div>
              <TimeField value={time} onChange={setTime} />
              <div className="mt-2 flex gap-2">
                {[30, 45, 60, 75, 90].map((m) => (
                  <button key={m} type="button" onClick={() => setTime(String(m))} className={`pressable min-h-10 flex-1 rounded-xl text-sm font-medium ${minutes === m ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2'}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-2">עצימות</p>
              <Segmented label="עצימות" value={intensity} onChange={setIntensity} options={INTENSITY} />
            </div>
          </>
        )}

        {type === 'run' && !distance && minutes ? (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-2">קצב</p>
            <Segmented label="קצב" value={intensity} onChange={setIntensity} options={[{ value: 'low', label: 'קליל' }, { value: 'moderate', label: 'בינוני' }, { value: 'high', label: 'מהיר' }]} />
          </div>
        ) : null}

        <div className="rounded-3xl bg-surface-2 p-4" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="text-ink-2">שריפה משוערת</span>
            <span className="text-2xl font-semibold" data-testid="exercise-estimate">{valid && kcal ? `~${fmt(kcal)}` : '—'} <span className="text-base font-normal text-ink-3">{KCAL}</span></span>
          </div>
          {pace && <p className="mt-1 text-sm text-ink-3">קצב <span className="ltr num">{fmtPace(pace)}</span> לק״מ</p>}
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            {type === 'run'
              ? 'לפי מרחק ומשקל (~0.95 קק״ל לק״ג לק״מ, מעל מנוחה). צעדי הריצה מנוכים מהצעדים כדי לא לספור פעמיים.'
              : 'לפי ערכי MET מקובלים, משקל ומשך, מעל מנוחה (שכבר נספרת ב-BMR). הליכות נספרות דרך הצעדים.'}
          </p>
        </div>
      </div>
    </Sheet>
  )
}

function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">זמן</span>
      <span className="flex min-h-14 items-center rounded-2xl bg-surface-2 px-4 focus-within:ring-2 focus-within:ring-info">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d:.,]/g, ''))}
          placeholder="25:00"
          className="ltr num w-full min-w-0 bg-transparent text-end text-xl font-semibold outline-none placeholder:text-ink-3/60"
          aria-label="זמן בדקות או דקות:שניות"
        />
        <span className="shrink-0 ps-2 text-ink-3">דק׳</span>
      </span>
    </label>
  )
}
