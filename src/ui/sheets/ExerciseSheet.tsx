import { useEffect, useId, useMemo, useState } from 'react'
import { ChevronDown, Plus, Trash2, X } from 'lucide-react'
import { Sheet, PrimaryButton, NumberField, Segmented } from '../primitives'
import { deleteExercise, exercisesForDate, getState, upsertExercise, useStore } from '../../data/store'
import type { Exercise } from '../../data/types'
import { isValidProfile, paceSecPerKm, workoutDisplay, type ExerciseInput, type ExerciseType, type Intensity, type Lift, type RestStyle } from '../../domain/energy'
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

const LIFT_SUGGESTIONS = ['לחיצת חזה', 'סקוואט', 'דדליפט', 'לחיצת כתפיים', 'חתירה', 'מתח', 'מקבילים', 'פשיטת ברכיים', 'כפיפת ברכיים', 'לחיצת רגליים', 'כפיפת מרפקים', 'פשיטת מרפקים', 'פולי עליון', 'היפ טראסט', 'לאנג׳ים']

interface LiftDraft {
  id: string
  name: string
  weight: number | ''
  sets: number | ''
  reps: number | ''
}

const emptyLift = (): LiftDraft => ({ id: newId(), name: '', weight: '', sets: '', reps: '' })

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

/** Draft rows → stored lifts (rows without a name or a weight are dropped). */
export function liftsFromDrafts(rows: LiftDraft[]): Lift[] {
  const pos = (v: number | '', max: number) => (v !== '' && Number.isFinite(v) && v > 0 && v <= max ? v : undefined)
  return rows
    .map((r) => ({ id: r.id, name: r.name.trim().slice(0, 60), weight_kg: pos(r.weight, 1000), sets: pos(r.sets, 50), reps: pos(r.reps, 500) }))
    .filter((l) => l.name || l.weight_kg !== undefined)
    .map((l) => ({ ...l, name: l.name || 'תרגיל' }))
    .map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as unknown as Lift)
}

export function liftLabel(l: Lift): string {
  const sr = l.sets && l.reps ? ` · ${l.sets}×${l.reps}` : l.sets ? ` · ${l.sets} סטים` : ''
  return `${l.name}${l.weight_kg ? ` ${l.weight_kg} ק״ג` : ''}${sr}`
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
  const [lifts, setLifts] = useState<LiftDraft[]>([])
  const [showLifts, setShowLifts] = useState(false)

  useEffect(() => {
    if (open) {
      setDistance('')
      setTime('')
      setIntensity('moderate')
      setRest('standard')
      setLifts([])
      setShowLifts(false)
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
  }
  const est = isValidProfile(profile) ? workoutDisplay(input, profile) : null
  const kcal = est?.kcal ?? 0
  const pace = paceSecPerKm(input)
  const valid = type === 'run' ? Boolean(input.distanceKm || minutes) : Boolean(minutes)
  const hint = INTENSITY_HINT[type]?.[intensity]

  const save = () => {
    if (!valid) return
    const now = new Date().toISOString()
    const storedLifts = type === 'strength' ? liftsFromDrafts(lifts) : []
    const ex: Exercise = {
      id: newId(),
      date,
      type,
      distance_km: input.distanceKm,
      duration_min: minutes ? Math.round(minutes * 10) / 10 : undefined,
      intensity: type === 'run' && input.distanceKm ? undefined : intensity,
      rest: type === 'strength' ? rest : undefined,
      lifts: storedLifts.length ? storedLifts : undefined,
      created_at: now,
      updated_at: now,
    }
    upsertExercise(ex)
    haptic(18)
    onClose()
    showToast(`${EXERCISE_META[type].emoji} נוסף · ~${fmt(kcal)} ${KCAL}`, { label: 'ביטול', run: () => deleteExercise(ex.id) })
  }

  const setLift = (id: string, patch: Partial<LiftDraft>) => setLifts((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))

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
                  {e.lifts?.length ? <span className="block truncate text-sm text-ink-3">{e.lifts.map(liftLabel).join(' · ')}</span> : null}
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

            <div className="rounded-3xl border border-line">
              <button
                type="button"
                onClick={() => {
                  setShowLifts((v) => !v)
                  if (!lifts.length) setLifts([emptyLift()])
                }}
                className="flex min-h-13 w-full items-center justify-between px-4 text-start"
                aria-expanded={showLifts}
              >
                <span className="font-medium">
                  משקלים <span className="font-normal text-ink-3">(לא חובה)</span>
                </span>
                <ChevronDown className={`size-5 text-ink-3 transition-transform ${showLifts ? 'rotate-180' : ''}`} aria-hidden />
              </button>
              {showLifts && (
                <div className="flex flex-col gap-2 px-3 pb-3">
                  <datalist id="lift-suggestions">
                    {LIFT_SUGGESTIONS.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                  {lifts.map((r, i) => (
                    <LiftRow key={r.id} row={r} index={i} onChange={(p) => setLift(r.id, p)} onRemove={() => setLifts((rows) => rows.filter((x) => x.id !== r.id))} />
                  ))}
                  <button type="button" onClick={() => setLifts((rows) => [...rows, emptyLift()])} className="pressable flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-surface-2 text-sm font-medium text-ink-2">
                    <Plus className="size-4" aria-hidden /> תרגיל נוסף
                  </button>
                  <p className="text-xs leading-relaxed text-ink-3">למעקב התקדמות בלבד. המשקל על המוט לא משנה את חישוב הקלוריות — הוא לא מנבא אמין של אנרגיה.</p>
                </div>
              )}
            </div>
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
          {pace && <p className="mt-1 text-sm text-ink-3">קצב <span className="ltr num">{fmtPace(pace)}</span> לק״מ</p>}
          <p className="mt-2 text-xs leading-relaxed text-ink-3">
            {type === 'run' && input.distanceKm
              ? 'לפי מרחק ומשקל (~1 קק״ל לק״ג לק״מ), פחות המנוחה האישית שלך. צעדי הריצה מנוכים מהצעדים כדי לא לספור פעמיים.'
              : type === 'strength'
                ? 'MET של אימון כוח שלם (כולל מנוחות בין סטים) לפי עצימות וקצב, × משקל הגוף × זמן, פחות המנוחה האישית שלך (כבר ב-BMR).'
                : `לפי ערכי MET מקובלים, משקל הגוף ומשך, פחות המנוחה האישית שלך (כבר ב-BMR).${type === 'walk' ? ' צעדי ההליכה מנוכים מהצעדים.' : ''}`}
          </p>
        </div>
      </div>
    </Sheet>
  )
}

function LiftRow({ row, index, onChange, onRemove }: { row: LiftDraft; index: number; onChange: (p: Partial<LiftDraft>) => void; onRemove: () => void }) {
  const id = useId()
  const num = (v: string): number | '' => (v === '' ? '' : Number(v.replace(',', '.')))
  const small = 'num min-h-11 w-full min-w-0 rounded-xl bg-surface-2 px-2 text-center font-semibold outline-none focus:ring-2 focus:ring-info'
  return (
    <div className="flex flex-col gap-1.5 rounded-2xl bg-surface p-2 ring-1 ring-line" role="group" aria-label={`תרגיל ${index + 1}`}>
      <div className="flex items-center gap-1.5">
        <input
          id={id}
          value={row.name}
          onChange={(e) => onChange({ name: e.target.value })}
          list="lift-suggestions"
          placeholder="תרגיל, למשל לחיצת חזה"
          aria-label={`שם תרגיל ${index + 1}`}
          className="min-h-11 w-full min-w-0 rounded-xl bg-surface-2 px-3 outline-none focus:ring-2 focus:ring-info"
          enterKeyHint="next"
        />
        <button type="button" onClick={onRemove} className="pressable grid size-11 shrink-0 place-items-center rounded-xl text-ink-3" aria-label={`הסר תרגיל ${index + 1}`}>
          <X className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-[1.3fr_1fr_1fr] items-center gap-1.5 text-sm">
        <label className="flex items-center gap-1">
          <input inputMode="decimal" type="number" min={0} step={0.5} value={row.weight} onChange={(e) => onChange({ weight: num(e.target.value) })} className={small} aria-label={`משקל בתרגיל ${index + 1}`} placeholder="68" />
          <span className="shrink-0 text-ink-3">ק״ג</span>
        </label>
        <label className="flex items-center gap-1">
          <input inputMode="numeric" type="number" min={0} value={row.sets} onChange={(e) => onChange({ sets: num(e.target.value) })} className={small} aria-label={`סטים בתרגיל ${index + 1}`} placeholder="3" />
          <span className="shrink-0 text-ink-3">סטים</span>
        </label>
        <label className="flex items-center gap-1">
          <input inputMode="numeric" type="number" min={0} value={row.reps} onChange={(e) => onChange({ reps: num(e.target.value) })} className={small} aria-label={`חזרות בתרגיל ${index + 1}`} placeholder="10" />
          <span className="shrink-0 text-ink-3">חז׳</span>
        </label>
      </div>
    </div>
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
