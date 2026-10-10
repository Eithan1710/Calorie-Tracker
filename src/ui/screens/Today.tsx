import { useMemo } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Dumbbell, Footprints, Plus, Settings2, TriangleAlert, Info, ArrowDown, Bell } from 'lucide-react'
import { exercisesForDate, foodForDate, useStore } from '../../data/store'
import { MEALS, type Exercise, type FoodEntry } from '../../data/types'
import { summarizeDay, type DaySummary, toExerciseInput } from '../../domain/day'
import { addDays, toDateKey, type GoalStatus } from '../../domain/goal'
import { workoutDisplayKcal, isValidProfile } from '../../domain/energy'
import { AnimatedNumber, Bar } from '../primitives'
import { dateLong, dayTitle, fmt, fmtBalance, KCAL } from '../format'
import { EXERCISE_META } from '../sheets/ExerciseSheet'
import { usePhotoUrl } from '../../services/photos'
import { InstallApp } from '../InstallApp'

export interface TodayActions {
  onAddFood: () => void
  onOpenEntry: (id: string) => void
  onExercise: () => void
  onSteps: () => void
  onSettings: () => void
  onDate: (key: string) => void
}

export const STATUS_STYLE: Record<GoalStatus, { color: string; soft: string; icon: typeof Check }> = {
  success: { color: 'var(--good)', soft: 'var(--good-soft)', icon: Check },
  almost: { color: 'var(--warn)', soft: 'var(--warn-soft)', icon: Clock },
  surplus: { color: 'var(--surplus)', soft: 'var(--surplus-soft)', icon: TriangleAlert },
  over: { color: 'var(--info)', soft: 'var(--info-soft)', icon: Info },
  room: { color: 'var(--info)', soft: 'var(--info-soft)', icon: ArrowDown },
  empty: { color: 'var(--ink-3)', soft: 'var(--surface-2)', icon: Plus },
}

const STATUS_SHORT: Record<GoalStatus, string> = {
  success: 'ביעד',
  almost: 'כמעט',
  surplus: 'עודף',
  over: 'גירעון גדול',
  room: 'יש מקום',
  empty: '',
}

export function useDaySummary(date: string): { summary: DaySummary; food: FoodEntry[]; exercises: Exercise[] } {
  const food = useStore((s) => s.food)
  const exercise = useStore((s) => s.exercise)
  const health = useStore((s) => s.health)
  const settings = useStore((s) => s.settings)
  return useMemo(() => {
    const st = { food, exercise }
    const f = foodForDate(st, date)
    const ex = exercisesForDate(st, date)
    return {
      food: f,
      exercises: ex,
      summary: summarizeDay({ date, food: f, exercises: ex, steps: health[date]?.steps ?? 0, profile: settings.profile, proteinTarget: settings.proteinTarget, target: settings.deficitTarget }),
    }
  }, [food, exercise, health, settings, date])
}

export function Today({ date, actions, reminder }: { date: string; actions: TodayActions; reminder: boolean }) {
  const { summary, food, exercises } = useDaySummary(date)
  const today = toDateKey(new Date())
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-36 lg:px-8">
      <Header date={date} today={today} onDate={actions.onDate} onSettings={actions.onSettings} />
      {date === today && <InstallApp variant="banner" />}

      {reminder && date === today && (
        <button
          type="button"
          onClick={actions.onAddFood}
          className="pressable animate-rise mb-3 flex w-full items-center gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-start"
        >
          <Bell className="size-5 shrink-0 text-warn" aria-hidden />
          <span className="font-medium">לא שכחת לעדכן את היום? 🥗</span>
        </button>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <BalanceHero s={summary} />
          <ProteinCard s={summary} />
          <div className="grid grid-cols-2 gap-3">
            <MacroTile label="שומן" value={summary.fat} color="var(--fat)" />
            <MacroTile label="פחמימות" value={summary.carbs} color="var(--carbs)" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <StepsTile steps={summary.steps} onClick={actions.onSteps} />
            <ExerciseTile exercises={exercises} onClick={actions.onExercise} />
          </div>
        </div>
        <FoodLog food={food} total={summary.eaten} onAdd={actions.onAddFood} onOpen={actions.onOpenEntry} />
      </div>
    </div>
  )
}

function Header({ date, today, onDate, onSettings }: { date: string; today: string; onDate: (d: string) => void; onSettings: () => void }) {
  const isToday = date === today
  return (
    <header className="safe-top flex items-center justify-between gap-2 pb-4">
      <div className="flex items-center gap-1">
        <button type="button" className="pressable grid size-11 place-items-center rounded-full text-ink-3 hover:bg-surface-2" aria-label="יום קודם" onClick={() => onDate(addDays(date, -1))}>
          <ChevronRight className="size-5" />
        </button>
        <div className="min-w-0">
          <h1 className="text-[28px] leading-tight font-bold tracking-tight">{dayTitle(date, today)}</h1>
          <p className="text-sm text-ink-3">{dateLong(date)}</p>
        </div>
        {!isToday && (
          <button type="button" className="pressable grid size-11 place-items-center rounded-full text-ink-3 hover:bg-surface-2" aria-label="יום הבא" onClick={() => onDate(addDays(date, 1))}>
            <ChevronLeft className="size-5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1">
        {!isToday && (
          <button type="button" onClick={() => onDate(today)} className="pressable min-h-10 rounded-full bg-surface-2 px-4 text-sm font-medium">
            להיום
          </button>
        )}
        <button type="button" onClick={onSettings} className="pressable grid size-11 place-items-center rounded-full text-ink-2 hover:bg-surface-2" aria-label="הגדרות">
          <Settings2 className="size-[22px]" />
        </button>
      </div>
    </header>
  )
}

// ── The hero: calorie balance ────────────────────────────────────────────────

const G_MIN = -700 // balance axis (eaten − burned)
const G_MAX = 400

function BalanceHero({ s }: { s: DaySummary }) {
  const goal = s.goal
  if (!goal) return null
  const style = STATUS_STYLE[goal.status]
  const Icon = style.icon
  const balance = -goal.deficit
  const pos = (v: number) => ((Math.max(G_MIN, Math.min(G_MAX, v)) - G_MIN) / (G_MAX - G_MIN)) * 100
  const showMarker = s.hasFood
  const TARGET_MIN = s.target.min
  const TARGET_MAX = s.target.max

  return (
    <section aria-label="מאזן קלורי" className="card animate-rise overflow-hidden p-5 pb-4 sm:p-6">
      {s.hasFood ? (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-3">מאזן היום</p>
            <p className="mt-0.5 flex items-baseline gap-2" aria-live="polite">
              {/* clamp: a 4-digit balance ("−1,838") must still fit a 360–390 px phone next to the status pill */}
              <AnimatedNumber value={balance} format={(n) => fmtBalance(-n)} className="ltr text-[clamp(44px,14vw,64px)] leading-none font-semibold tracking-tight sm:text-[72px]" />
              <span className="text-lg text-ink-3">{KCAL}</span>
            </p>
          </div>
          <div key={goal.status} className="animate-pop mt-1 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold" style={{ background: style.soft, color: style.color }}>
            <Icon className="size-4" strokeWidth={2.6} aria-hidden />
            <span>{STATUS_SHORT[goal.status]}</span>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm font-medium text-ink-3">תקציב להיום</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="ltr num text-[44px] leading-none font-semibold tracking-tight">
              {fmt(goal.roomMin ?? 0)}–{fmt(goal.roomMax ?? 0)}
            </span>
            <span className="text-lg text-ink-3">{KCAL}</span>
          </p>
        </div>
      )}

      <div className="mt-3">
        <p className={`text-lg font-semibold ${goal.status === 'success' ? 'text-good' : ''}`}>{s.hasFood ? goal.title : TARGET_MIN >= 0 ? `כדי לסיים בגירעון של \u2066${TARGET_MIN}–${TARGET_MAX}\u2069` : 'כדי לסיים בטווח היעד שלך'}</p>
        {s.hasFood && goal.detail && <p className="text-[15px] text-ink-2">{goal.detail}</p>}
      </div>

      {/* number line: eaten − burned. Target band 100–300 kcal deficit. */}
      <div className="mt-5" aria-hidden>
        <div className="ltr relative h-3 w-full">
          <div className="absolute inset-y-0 rounded-full" style={{ left: 0, right: 0, background: 'var(--surface-2)' }} />
          <div className="absolute inset-y-0 rounded-full" style={{ left: `${pos(-TARGET_MAX)}%`, right: `${100 - pos(-TARGET_MIN)}%`, background: 'var(--good)', opacity: 0.85 }} />
          <div className="absolute inset-y-0 w-px" style={{ left: `${pos(0)}%`, background: 'var(--ink-3)' }} />
          {showMarker && (
            <div
              className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-surface"
              style={{ left: `${pos(balance)}%`, background: style.color === 'var(--ink-3)' ? 'var(--ink)' : style.color, transition: 'left 700ms cubic-bezier(0.22, 1, 0.36, 1)', boxShadow: '0 1px 4px rgb(0 0 0 / .25)' }}
            />
          )}
        </div>
        <div className="ltr relative mt-1.5 h-4 text-[11px] text-ink-3">
          <span className="absolute left-0">גירעון</span>
          <span className="absolute -translate-x-1/2 font-medium text-good" style={{ left: `${(pos(-TARGET_MAX) + pos(-TARGET_MIN)) / 2}%` }}>
            יעד
          </span>
          <span className="absolute -translate-x-1/2" style={{ left: `${pos(0)}%` }}>0</span>
          <span className="absolute right-0">עודף</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4">
        <div>
          <p className="flex items-center gap-1.5 text-sm text-ink-3">
            <span className="size-2 rounded-full" style={{ background: 'var(--eaten)' }} aria-hidden />
            קלוריות שנכנסו
          </p>
          <p className="num text-[28px] font-semibold tracking-tight">
            <AnimatedNumber value={s.eaten} format={fmt} />
          </p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-sm text-ink-3">
            <span className="size-2 rounded-full" style={{ background: 'var(--burned)' }} aria-hidden />
            קלוריות שנשרפו
          </p>
          <p className="num text-[28px] font-semibold tracking-tight">
            <AnimatedNumber value={s.burned} format={fmt} />
          </p>
        </div>
      </div>
      <p className="sr-only">
        נכנסו {fmt(s.eaten)} קלוריות, נשרפו {fmt(s.burned)}. {goal.title}. {goal.detail}
      </p>
    </section>
  )
}

function ProteinCard({ s }: { s: DaySummary }) {
  const met = s.proteinMet
  const left = Math.max(0, s.proteinTarget - s.protein)
  return (
    <section aria-label="חלבון" className={`card animate-rise p-5 ${met ? 'ring-1 ring-protein/20' : ''}`} style={{ animationDelay: '60ms' }}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink-3">חלבון</p>
          <p className="mt-0.5 flex items-baseline gap-1.5">
            <AnimatedNumber value={s.protein} format={fmt} className="text-[40px] leading-none font-semibold tracking-tight" />
            <span className="text-lg text-ink-3">/ {s.proteinTarget} ג׳</span>
          </p>
        </div>
        {met ? (
          <span key="met" className="animate-pop flex items-center gap-1.5 rounded-full bg-protein-soft px-3 py-1.5 text-sm font-semibold text-protein">
            <Check className="size-4" strokeWidth={2.8} aria-hidden /> היעד הושג
          </span>
        ) : (
          <span className="pb-1 text-sm text-ink-2">עוד {fmt(left)} ג׳</span>
        )}
      </div>
      <div className="mt-4">
        <Bar value={s.protein} max={s.proteinTarget} color="var(--protein)" track="var(--protein-soft)" height={12} label={`חלבון ${s.protein} מתוך ${s.proteinTarget} גרם`} />
      </div>
    </section>
  )
}

function MacroTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="card animate-rise px-4 py-3.5" style={{ animationDelay: '100ms' }}>
      <p className="flex items-center gap-1.5 text-sm text-ink-3">
        <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight">
        <AnimatedNumber value={value} format={fmt} />
        <span className="ms-1 text-base font-normal text-ink-3">ג׳</span>
      </p>
    </div>
  )
}

function StepsTile({ steps, onClick }: { steps: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="card pressable animate-rise px-4 py-3.5 text-start" style={{ animationDelay: '140ms' }} aria-label={`צעדים: ${fmt(steps)}. לעדכון`}>
      <p className="flex items-center gap-1.5 text-sm text-ink-3">
        <Footprints className="size-4" aria-hidden /> צעדים
      </p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight">{steps ? <AnimatedNumber value={steps} format={fmt} /> : <span className="text-ink-3">הוסף</span>}</p>
    </button>
  )
}

function ExerciseTile({ exercises, onClick }: { exercises: Exercise[]; onClick: () => void }) {
  const profile = useStore((s) => s.settings.profile)
  const kcal = isValidProfile(profile) ? exercises.reduce((sum, e) => sum + workoutDisplayKcal(toExerciseInput(e), profile), 0) : 0
  const first = exercises[0]
  return (
    <button type="button" onClick={onClick} className="card pressable animate-rise px-4 py-3.5 text-start" style={{ animationDelay: '180ms' }} aria-label="אימון. להוספה או עריכה">
      <p className="flex items-center gap-1.5 text-sm text-ink-3">
        <Dumbbell className="size-4" aria-hidden /> אימון
      </p>
      {first ? (
        <>
          <p className="mt-0.5 truncate text-lg font-semibold leading-tight tracking-tight">
            {EXERCISE_META[first.type].emoji} {exerciseSummary(first)}
            {exercises.length > 1 && <span className="text-ink-3"> +{exercises.length - 1}</span>}
          </p>
          <p className="text-sm text-ink-3">~{fmt(kcal)} {KCAL}</p>
        </>
      ) : (
        <p className="mt-0.5 text-2xl font-semibold tracking-tight text-ink-3">הוסף</p>
      )}
    </button>
  )
}

export function exerciseSummary(e: Exercise): string {
  if ((e.type === 'run' || e.type === 'walk') && e.distance_km) return `${e.distance_km} ק״מ${e.duration_min ? ` · ${Math.round(e.duration_min)} דק׳` : ''}`
  return `${EXERCISE_META[e.type].label}${e.duration_min ? ` · ${Math.round(e.duration_min)} דק׳` : ''}`
}

/** The entry's photo when it has one, otherwise its emoji. */
export function EntryThumb({ entry, size = 'size-11' }: { entry: FoodEntry; size?: string }) {
  const url = usePhotoUrl(entry.photo_path)
  if (entry.photo_path && url) {
    return <img src={url} alt="" className={`${size} shrink-0 rounded-xl bg-surface-2 object-cover`} loading="lazy" decoding="async" />
  }
  return (
    <span className={`grid ${size} shrink-0 place-items-center rounded-xl bg-surface-2 text-xl`} aria-hidden>
      {entry.emoji}
    </span>
  )
}

function FoodLog({ food, total, onAdd, onOpen }: { food: FoodEntry[]; total: number; onAdd: () => void; onOpen: (id: string) => void }) {
  const groups = MEALS.map((m) => ({ ...m, entries: food.filter((f) => f.meal === m.id) })).filter((g) => g.entries.length)
  return (
    <section aria-label="מה אכלתי" className="card animate-rise p-2 sm:p-3" style={{ animationDelay: '120ms' }}>
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-lg font-semibold">מה אכלתי</h2>
        {food.length > 0 && (
          <span className="text-sm text-ink-3">
            סה״כ <span className="num font-semibold text-ink">{fmt(total)}</span> {KCAL}
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="px-3 pt-2 pb-4 text-center">
          <p className="text-ink-2">עוד לא נרשם כלום.</p>
          <p className="mt-1 text-sm text-ink-3">כתוב חופשי, למשל ״3 ביצים, 2 פרוסות לחם וקוטג׳״</p>
          <button type="button" onClick={onAdd} className="pressable mt-4 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-ink px-5 font-semibold text-inverse">
            <Plus className="size-5" strokeWidth={2.6} /> הוסף אוכל
          </button>
        </div>
      ) : (
        <ul className="flex flex-col">
          {groups.map((g) => (
            <li key={g.id} className="px-1 pb-1">
              <div className="flex items-center justify-between px-2 pt-2 pb-1 text-sm text-ink-3">
                <span>
                  <span aria-hidden>{g.emoji}</span> {g.label}
                </span>
                <span className="num">{fmt(g.entries.reduce((s, e) => s + (e.status === 'ok' ? e.totals.calories : 0), 0))}</span>
              </div>
              <ul>
                {g.entries.map((e) => (
                  <li key={e.id} className="animate-rise">
                    <button type="button" onClick={() => onOpen(e.id)} className="pressable flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-2 text-start hover:bg-surface-2">
                      <EntryThumb entry={e} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{e.title}</span>
                        {e.status === 'pending' ? (
                          <span className="flex items-center gap-1 text-sm text-warn">
                            <Clock className="size-3.5" aria-hidden /> ממתין לניתוח
                          </span>
                        ) : (
                          <span className="block text-sm text-ink-3">
                            חלבון {fmt(e.totals.protein_g)} ג׳{e.provider === 'local' ? ' · חושב בלי AI' : ''}
                          </span>
                        )}
                      </span>
                      {e.status === 'ok' && (
                        <span className="num shrink-0 text-end">
                          <span className="ltr font-semibold">{e.confidence < 0.8 ? '≈' : ''}{fmt(e.totals.calories)}</span>
                          <span className="block text-xs text-ink-3">{KCAL}</span>
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
