import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Sheet, PrimaryButton, NumberField, Segmented } from '../primitives'
import { deleteExercise, exercisesForDate, getState, upsertExercise, useStore } from '../../data/store'
import type { Exercise } from '../../data/types'
import { isValidProfile, paceSecPerKm, workoutDisplay, type ExerciseInput, type ExerciseType, type Intensity, type Lift, type MuscleGroup, type RestStyle } from '../../domain/energy'
import { toExerciseInput } from '../../domain/day'
import { newId } from '../../../supabase/functions/_shared/nutrition.ts'
import { fmt, fmtPace, haptic, KCAL } from '../format'
import { showToast } from '../toast'

export const EXERCISE_META: Record<ExerciseType, { label: string; emoji: string }> = {
  strength: { label: 'כוח', emoji: '🏋️' },
  run: { label: 'ריצה', emoji: '🏃' },
  walk: { label: 'הליכה', emoji: '🚶' },
  cycling: { label: 'אופניים', emoji: '🚴' },
  swimming: { label: 'שחייה', emoji: '🏊' },
  other: { label: 'קרדיו / אחר', emoji: '⚡' },
}

const INTENSITY: { value: Intensity; label: string }[] = [
  { value: 'low', label: 'קלה' },
  { value: 'moderate', label: 'בינונית' },
  { value: 'high', label: 'גבוהה' },
]

/** What each intensity means, so the choice is easy without physiology terms. */
const INTENSITY_HINT: Partial<Record<ExerciseType, Record<Intensity, string>>> = {
  strength: {
    low: 'משקלים קלים / מכונות, הרבה מנוחה, רחוק מכשל',
    moderate: 'תרגילים מורכבים, מאמץ ניכר, 1–3 חזרות לפני כשל',
    high: 'כבד מאוד או עד כשל, מתנשף בסוף כל סט',
  },
  walk: { low: 'הליכה נינוחה', moderate: 'קצב רגיל', high: 'הליכה מהירה / עלייה' },
  cycling: { low: 'רכיבה נינוחה', moderate: 'קצב בינוני', high: 'רכיבה מהירה / עליות' },
  swimming: { low: 'שחייה רגועה', moderate: 'קצב קבוע', high: 'אינטרוולים / מהיר' },
  other: { low: 'אפשר לדבר בחופשיות', moderate: 'נושם כבד, אפשר לדבר במשפטים קצרים', high: 'קשה לדבר (HIIT, אינטרוולים)' },
}

const REST: { value: RestStyle; label: string }[] = [
  { value: 'standard', label: 'רגילות (1–3 דק׳)' },
  { value: 'short', label: 'קצרות / סופרסטים' },
]

export const MUSCLES: { value: MuscleGroup; label: string }[] = [
  { value: 'legs', label: 'רגליים' },
  { value: 'back', label: 'גב' },
  { value: 'chest', label: 'חזה' },
  { value: 'shoulders', label: 'כתפיים' },
  { value: 'arms', label: 'ידיים' },
  { value: 'core', label: 'בטן' },
  { value: 'full_body', label: 'כל הגוף' },
]
const MUSCLE_LABEL = Object.fromEntries(MUSCLES.map((m) => [m.value, m.label])) as Record<MuscleGroup, string>

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

/** Older entries recorded per-exercise loads; still shown in the list. */
function liftLabel(l: Lift): string {
  const sr = l.sets && l.reps ? ` · ${l.sets}×${l.reps}` : l.sets ? ` · ${l.sets} סטים` : ''
  return `${l.name}${l.weight_kg ? ` ${l.weight_kg} ק״ג` : ''}${sr}`
}

/** "רגליים, כתפיים · 8,000 ק״ג" */
export function strengthDetails(e: Pick<Exercise, 'muscles' | 'volume_kg' | 'lifts'>): string {
  const parts = [
    e.muscles?.length ? e.muscles.map((m) => MUSCLE_LABEL[m]).join(', ') : '',
    e.volume_kg ? `${fmt(e.volume_kg)} ק״ג` : '',
    e.lifts?.length ? e.lifts.map(liftLabel).join(' · ') : '',
  ]
  return parts.filter(Boolean).join(' · ')
}

export function ExerciseSheet({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const profile = useStore((s) => s.settings.profile)
  const exMap = useStore((s) => s.exercise)
  const existing = useMemo(() => exercisesForDate({ ...getState(), exercise: exMap }, date), [exMap, date])
  const [type, setType] = useState<ExerciseType>('strength')
  const [distance, setDistance] = useState<number | ''>('')
  const [time, setTime] = useState('')
  const [intensity, setIntensity] = useState<Intensity>('moderate')
  const [rest, setRest] = useState<RestStyle>('standard')
  const [muscles, setMuscles] = useState<MuscleGroup[]>([])
  const [volume, setVolume] = useState<number | ''>('')

  useEffect(() => {
    if (open) {
      setDistance('')
      setTime('')
      setIntensity('moderate')
      setRest('standard')
      setMuscles([])
      setVolume('')
    }
  }, [open])

  const minutes = parseDuration(time) ?? undefined
  const hasDistance = type === 'run' || type === 'walk'
  const input: ExerciseInput = {
    type,
    distanceKm: hasDistance && distance !== '' && distance > 0 ? distance : undefined,
    durationMin: minutes,
    intensity,
    rest: type === 'strength' ? rest : undefined,
    muscles: type === 'strength' ? muscles : undefined,
    volumeKg: type === 'strength' && volume !== '' && volume > 0 ? volume : undefined,
  }
  const est = isValidProfile(profile) ? workoutDisplay(input, profile) : null
  const kcal = est?.kcal ?? 0
  const pace = paceSecPerKm(input)
  const valid = type === 'run' ? Boolean(input.distanceKm || minutes) : Boolean(minutes)
  const hint = INTENSITY_HINT[type]?.[intensity]

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
      rest: type === 'strength' ? rest : undefined,
      muscles: type === 'strength' && muscles.length ? muscles : undefined,
      volume_kg: input.volumeKg ? Math.round(input.volumeKg) : undefined,
      created_at: now,
      updated_at: now,
    }
    upsertExercise(ex)
    haptic(18)
    onClose()
    showToast(`${EXERCISE_META[type].emoji} נוסף · ~${fmt(kcal)} ${KCAL}`, { label: 'ביטול', run: () => deleteExercise(ex.id) })
  }

  const toggleMuscle = (m: MuscleGroup) => setMuscles((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))

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
                <span className="min-w-0 flex-1">
                  <span className="block">
                    {EXERCISE_META[e.type].label}
                    {e.distance_km ? ` · ${e.distance_km} ק״מ` : ''}
                    {e.duration_min ? ` · ${Math.round(e.duration_min)} דק׳` : ''}
                    {isValidProfile(profile) && <span className="text-ink-3"> · ~{fmt(workoutDisplay(toExerciseInput(e), profile).kcal)}</span>}
                  </span>
                  {e.type === 'strength' && strengthDetails(e) ? <span className="block truncate text-sm text-ink-3">{strengthDetails(e)}</span> : null}
                </span>
                <button type="button" onClick={() => deleteExercise(e.id)} className="pressable grid size-10 shrink-0 place-items-center rounded-xl text-ink-3 hover:text-surplus" aria-label={`מחק ${EXERCISE_META[e.type].label}`}>
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div role="radiogroup" aria-label="סוג אימון" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {(Object.keys(EXERCISE_META) as ExerciseType[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`pressable flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 text-sm font-medium transition-colors ${type === t ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2'}`}
            >
              <span className="text-2xl" aria-hidden>{EXERCISE_META[t].emoji}</span>
              <span className="truncate">{EXERCISE_META[t].label}</span>
            </button>
          ))}
        </div>

        {hasDistance ? (
          <div className="grid grid-cols-2 gap-3">
            <NumberField label={type === 'walk' ? 'מרחק (לא חובה)' : 'מרחק'} unit="ק״מ" value={distance} onChange={setDistance} step={0.1} min={0} placeholder={type === 'walk' ? '3' : '5'} />
            <TimeField value={time} onChange={setTime} />
          </div>
        ) : (
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
        )}

        {type === 'run' ? (
          !distance && minutes ? (
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-2">קצב</p>
              <Segmented label="קצב" value={intensity} onChange={setIntensity} options={[{ value: 'low', label: 'קליל' }, { value: 'moderate', label: 'בינוני' }, { value: 'high', label: 'מהיר' }]} />
            </div>
          ) : null
        ) : (
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink-2">{type === 'walk' ? 'קצב' : 'עצימות'}</p>
            <Segmented label={type === 'walk' ? 'קצב' : 'עצימות'} value={intensity} onChange={setIntensity} options={INTENSITY} />
            {hint && <p className="mt-1.5 text-sm text-ink-3">{hint}</p>}
          </div>
        )}

        {type === 'strength' && (
          <>
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-2">מנוחות בין סטים</p>
              <Segmented label="מנוחות בין סטים" size="sm" value={rest} onChange={setRest} options={REST} />
            </div>

            <div>
              <p className="mb-1.5 text-sm font-medium text-ink-2">
                שרירים שעבדו <span className="font-normal text-ink-3">(לא חובה)</span>
              </p>
              <div role="group" aria-label="שרירים שעבדו" className="flex flex-wrap gap-2">
                {MUSCLES.map((m) => {
                  const on = muscles.includes(m.value)
                  return (
                    <button
                      key={m.value}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleMuscle(m.value)}
                      className={`pressable min-h-11 rounded-full px-4 text-[15px] font-medium transition-colors ${on ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2'}`}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <NumberField label="משקל כולל שהורם באימון (לא חובה)" unit="ק״ג" value={volume} onChange={setVolume} inputMode="numeric" min={0} max={200000} step={100} placeholder="8000" />
          </>
        )}

        <div className="rounded-3xl bg-surface-2 p-4" aria-live="polite">
          <div className="flex items-baseline justify-between">
            <span className="text-ink-2">שריפה משוערת</span>
            <span className="text-2xl font-semibold" data-testid="exercise-estimate">
              {valid && kcal ? `~${fmt(kcal)}` : '—'} <span className="text-base font-normal text-ink-3">{KCAL}</span>
            </span>
          </div>
          {valid && est && est.high > est.low && (
            <p className="mt-0.5 text-sm text-ink-3" data-testid="exercise-range">
              טווח סביר <span className="ltr num">{fmt(est.low)}–{fmt(est.high)}</span> · מעל המנוחה
            </p>
          )}
          {valid && est && est.fromVolume > 0 && (
            <p className="mt-0.5 text-sm text-ink-3" data-testid="exercise-volume-part">
              כולל ~{fmt(est.fromVolume)} {KCAL} מהמשקל הכולל שהורם
            </p>
          )}
          {pace && <p className="mt-1 text-sm text-ink-3">קצב <span className="ltr num">{fmtPace(pace)}</span> לק״מ</p>}
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            {type === 'run' && input.distanceKm
              ? 'לפי מרחק ומשקל (~1 קק״ל לק״ג לק״מ), פחות המנוחה האישית שלך. צעדי הריצה מנוכים מהצעדים כדי לא לספור פעמיים.'
              : type === 'strength'
                ? 'MET של אימון כוח שלם (כולל מנוחות בין סטים) לפי עצימות, קצב והשרירים שעבדו (רגליים/כל הגוף מעלים, ידיים/בטן בלבד מורידים), × משקל הגוף × זמן, פחות המנוחה האישית שלך. המשקל הכולל שהורם מוסיף את העבודה המכנית שלו (~0.006 קק״ל לכל ק״ג).'
                : `לפי ערכי MET מקובלים, משקל הגוף ומשך, פחות המנוחה האישית שלך (כבר ב-BMR).${type === 'walk' ? ' צעדי ההליכה מנוכים מהצעדים.' : ''}`}
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
