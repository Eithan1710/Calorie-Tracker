import { useState } from 'react'
import { ChevronDown, Footprints, Plus } from 'lucide-react'
import type { DaySummary } from '../../domain/day'
import type { DayEnergy, WorkoutEnergy } from '../../domain/expenditure'
import type { Exercise } from '../../data/types'
import { paceSecPerKm } from '../../domain/energy'
import { useStore } from '../../data/store'
import { AnimatedNumber } from '../primitives'
import { fmt, fmtPace, KCAL } from '../format'
import { EXERCISE_META } from '../sheets/ExerciseSheet'

const timeHM = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

/** "היום 21:15" / "אתמול 23:50" / "9.10 08:00" */
function whenLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(now) - day(d)) / 86_400_000)
  const t = timeHM(iso)
  if (diff === 0) return `היום ${t}`
  if (diff === 1) return `אתמול ${t}`
  return `${d.getDate()}.${d.getMonth() + 1} ${t}`
}

function hoursAgo(iso: string, now = new Date()) {
  return (now.getTime() - new Date(iso).getTime()) / 3_600_000
}

function SourceTag({ apple }: { apple: boolean }) {
  return apple ? (
    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2">Apple Health</span>
  ) : (
    <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] font-medium text-warn">הערכה</span>
  )
}

/**
 * Energy expenditure of the day: resting + active (= total), the workouts inside
 * them, the steps, and where each number comes from. Values add up on screen.
 */
export function EnergyCard({ s, isToday, onSteps }: { s: DaySummary; isToday: boolean; onSteps: () => void }) {
  const e = s.energy
  const [why, setWhy] = useState(false)
  const everConnected = useStore((st) => Object.values(st.health).some((h) => h.active_kcal != null || h.resting_kcal != null))
  if (!e) return null
  const apple = e.mode === 'health'
  // what the rows add up to: measured so far (Apple) / the model's day (estimate)
  const shown = apple ? e.soFar : e.total
  const parts = apple
    ? [
        { key: 'resting', label: 'מנוחה', value: e.resting.kcal, color: 'var(--resting)', apple: e.resting.source === 'apple' },
        { key: 'active', label: 'פעילה', value: e.active.kcal, color: 'var(--active)', apple: e.active.source === 'apple' },
        ...(e.extra > 0 ? [{ key: 'extra', label: 'אימון שלא נמדד', value: e.extra, color: 'var(--warn)', apple: false }] : []),
        ...(e.tef > 0 ? [{ key: 'tef', label: 'עיכול מזון', value: e.tef, color: 'var(--ink-3)', apple: false }] : []),
      ]
    : [
        { key: 'resting', label: 'מנוחה', value: e.resting.kcal, color: 'var(--resting)', apple: false },
        { key: 'active', label: 'פעילה', value: e.active.kcal, color: 'var(--active)', apple: false },
        { key: 'tef', label: 'עיכול מזון', value: e.tef, color: 'var(--ink-3)', apple: false },
      ]
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1
  const counted = e.workouts.filter((w) => w.counting !== 'duplicate')
  const showProjection = apple && e.partial && e.total - e.soFar >= 30
  const stale = apple && isToday && e.asOf && hoursAgo(e.asOf) > 3

  let status: { text: string; tone: 'muted' | 'warn' } | null = null
  if (apple && e.asOf) status = { text: `Apple Health · ${whenLabel(e.asOf)}${stale ? ` · לפני ${Math.floor(hoursAgo(e.asOf))} שעות` : ''}`, tone: stale ? 'warn' : 'muted' }
  else if (apple) status = { text: 'Apple Health', tone: 'muted' }
  else if (everConnected) status = { text: isToday ? 'עוד אין נתוני Apple Health להיום — מוצגת הערכה' : 'אין נתוני Apple Health ליום הזה — מוצגת הערכה', tone: 'warn' }
  else status = { text: 'הערכה לפי הפרופיל, הצעדים והאימונים', tone: 'muted' }

  return (
    <section aria-label="שריפה היום" className="card animate-rise p-5" style={{ animationDelay: '40ms' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink-3">{apple && e.partial ? (isToday ? 'נשרף עד עכשיו' : 'נשרף (נתונים חלקיים)') : 'נשרף היום'}</p>
          <p className="mt-0.5 flex items-baseline gap-1.5" data-testid="energy-total">
            <AnimatedNumber value={shown} format={fmt} className="text-[40px] leading-none font-semibold tracking-tight" />
            <span className="text-lg text-ink-3">{KCAL}</span>
          </p>
          {showProjection && (
            <p className="mt-1 text-sm text-ink-2" data-testid="energy-projection">
              צפי לסוף היום <span className="ltr num inline-block font-semibold">~{fmt(Math.round(e.total / 10) * 10)}</span>
            </p>
          )}
        </div>
        <button type="button" onClick={onSteps} className="pressable flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-sm" aria-label={`צעדים: ${fmt(s.steps)}. לעדכון`}>
          <Footprints className="size-4 text-ink-3" aria-hidden />
          {s.steps ? <span className="num font-semibold">{fmt(s.steps)}</span> : <span className="text-ink-3">צעדים</span>}
        </button>
      </div>

      {/* resting | active (| extra / food) — proportions of what was burned */}
      <div className="ltr mt-4 flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        {parts.map((p) => (p.value > 0 ? <div key={p.key} style={{ width: `${(p.value / sum) * 100}%`, background: p.color }} className="h-full first:rounded-s-full last:rounded-e-full" /> : null))}
      </div>

      <dl className="mt-3 flex flex-col gap-1.5">
        {parts.map((p) => (
          <div key={p.key} className="flex items-center gap-2">
            <dt className="flex min-w-0 flex-1 items-center gap-2 text-[15px]">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.label}
              {/* a source tag only where a row differs from the card (Apple day with an estimated part) */}
              {apple && !p.apple && p.key !== 'extra' && <SourceTag apple={false} />}
            </dt>
            <dd className="num font-semibold">{fmt(p.value)}</dd>
          </div>
        ))}
        {counted.length > 0 && (
          <div className="flex items-center gap-2 ps-4.5 text-sm text-ink-3">
            <dt className="min-w-0 flex-1">
              {apple ? 'מתוכה אימונים' : 'כולל אימונים'}
              {e.workoutKcal === null && ' · אין מספיק נתונים'}
            </dt>
            <dd className="num">{e.workoutKcal !== null ? fmt(e.workoutKcal) : '—'}</dd>
          </div>
        )}
      </dl>

      {status && (
        <p className={`mt-3 text-xs ${status.tone === 'warn' ? 'text-warn' : 'text-ink-3'}`} data-testid="energy-status">
          {status.text}
        </p>
      )}

      <button type="button" onClick={() => setWhy((v) => !v)} className="mt-1 flex min-h-9 items-center gap-1 text-sm text-ink-3" aria-expanded={why}>
        מה המספרים אומרים
        <ChevronDown className={`size-4 transition-transform ${why ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {why && <EnergyExplainer e={e} />}
    </section>
  )
}

function EnergyExplainer({ e }: { e: DayEnergy }) {
  const apple = e.mode === 'health'
  return (
    <div className="mt-1 flex flex-col gap-2 rounded-2xl bg-surface-2 p-3 text-sm leading-relaxed text-ink-2">
      <p>
        <b>מנוחה</b> — האנרגיה שהגוף שורף גם בלי לזוז (נשימה, לב, חום גוף).{' '}
        {e.resting.source === 'apple' ? 'כפי ש-Apple Health מדווח.' : 'מוערך לפי מין, גיל, גובה ומשקל (Mifflin-St Jeor).'}
      </p>
      <p>
        <b>פעילה</b> — כל מה שמעל המנוחה: הליכה, תנועה ואימונים.{' '}
        {e.active.source === 'apple' ? 'כפי ש-Apple Health מדווח — כולל האימונים מהשעון, מ-Strava ומ-Hevy.' : 'מוערכת לפי הצעדים והאימונים שנרשמו.'}
      </p>
      <p>
        <b>אימונים</b> —{' '}
        {apple && e.active.source === 'apple'
          ? 'מוצגים לידיעה בלבד ולא מתווספים, כי הם כבר בתוך האנרגיה הפעילה. אימון שסימנת ״לא נמדד ב-Apple Health״ נוסף בנפרד.'
          : 'נספרים פעם אחת בתוך הפעילה. צעדים שנעשו בזמן ריצה/הליכה מנוכים.'}
      </p>
      {apple ? (
        <p>
          <b>עיכול מזון</b> — Apple Health לא סופר אותו, אז הוא מחושב ממה שאכלת: 25% מקלוריות החלבון, 7.5% מהפחמימות ו-2% מהשומן. עולה ככל שנרשם עוד אוכל.
        </p>
      ) : null}
      {apple ? (
        <p>
          <b>סה״כ</b> = מנוחה + פעילה + עיכול מזון. {e.partial ? 'לאורך היום המנוחה ממשיכה להצטבר, ולכן המאזן מחושב לפי צפי המנוחה לסוף היום + הפעילות עד עכשיו.' : ''}
        </p>
      ) : (
        <p>
          <b>סה״כ</b> = מנוחה + פעילה + ~10% עיכול מזון. זו הערכה (בדרך כלל ±20%); כשמגיעים נתונים מ-Apple Health הם מחליפים אותה.
        </p>
      )}
    </div>
  )
}

export function workoutTitle(ex: Exercise): string {
  const meta = EXERCISE_META[ex.type]
  return meta.label
}

/** "18:05 · 32 דק׳ · 5.1 ק״מ · 5:16/ק״מ" */
export function workoutLine(ex: Exercise): string {
  const parts: string[] = []
  if (ex.started_at) parts.push(timeHM(ex.started_at))
  if (ex.duration_min) parts.push(`${Math.round(ex.duration_min)} דק׳`)
  if ((ex.type === 'run' || ex.type === 'walk' || ex.type === 'cycling') && ex.distance_km) parts.push(`${ex.distance_km} ק״מ`)
  const pace = (ex.type === 'run' || ex.type === 'walk') ? paceSecPerKm({ type: ex.type, distanceKm: ex.distance_km, durationMin: ex.duration_min }) : null
  if (pace) parts.push(`⁦${fmtPace(pace)}⁩/ק״מ`)
  return parts.join(' · ')
}

export function kcalLabel(w: WorkoutEnergy | undefined): { text: string; tag: string | null } {
  if (!w || w.kcal === null) return { text: '—', tag: 'אין מספיק נתונים' }
  if (w.kcalSource === 'imported') return { text: `${fmt(w.kcal)} ${KCAL}`, tag: 'Apple Health' }
  return { text: `~${fmt(w.kcal)} ${KCAL}`, tag: 'הערכה' }
}

/** Today's workouts as clean rows; one tap opens the workout sheet (add / edit). */
export function WorkoutsCard({ s, exercises, onOpen }: { s: DaySummary; exercises: Exercise[]; onOpen: () => void }) {
  const lines = new Map((s.energy?.workouts ?? []).map((w) => [w.id, w]))
  const visible = exercises.filter((ex) => lines.get(ex.id)?.counting !== 'duplicate')
  return (
    <button
      type="button"
      onClick={onOpen}
      className="card pressable animate-rise w-full p-4 text-start"
      style={{ animationDelay: '80ms' }}
      aria-label={`אימון. ${visible.length ? `${visible.length} אימונים היום` : 'אין אימונים היום'}. להוספה או עריכה`}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium text-ink-3">אימונים</span>
        <span className="flex items-center gap-1 text-sm text-ink-3">
          <Plus className="size-4" aria-hidden /> הוסף
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="px-1 pt-1 text-[15px] text-ink-3">אין אימונים היום</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {visible.map((ex) => {
            const w = lines.get(ex.id)
            const k = kcalLabel(w)
            return (
              <li key={ex.id} className="flex items-center gap-3 rounded-2xl px-1 py-2">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-xl" aria-hidden>
                  {EXERCISE_META[ex.type].emoji}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {workoutTitle(ex)}
                    {ex.source_app && <span className="font-normal text-ink-3"> · {ex.source_app}</span>}
                  </span>
                  <span className="block truncate text-sm text-ink-3">{workoutLine(ex) || (ex.type === 'strength' ? 'אימון כוח' : '')}</span>
                </span>
                <span className="shrink-0 text-end">
                  <span className="num block font-semibold">{k.text}</span>
                  {k.tag && (
                    <span className="block text-[11px] text-ink-3">
                      {k.tag}
                      {w?.counting === 'included_in_active' ? ' · כלול בפעילה' : ''}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </button>
  )
}
