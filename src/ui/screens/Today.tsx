import { useMemo } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Plus, Settings2, TriangleAlert, Info, ArrowDown, Bell } from 'lucide-react'
import { exercisesForDate, foodForDate, useStore } from '../../data/store'
import { MEALS, type Exercise, type FoodEntry } from '../../data/types'
import { summarizeDay, type DaySummary } from '../../domain/day'
import { addDays, bandLabel, dayTarget, toDateKey, type GoalStatus } from '../../domain/goal'
import { routineContextOf } from '../../domain/routine'
import { AnimatedNumber, Bar } from '../primitives'
import { dateLong, dayTitle, fmt, fmtBalance, KCAL } from '../format'
import { usePhotoUrl } from '../../services/photos'
import { InstallApp } from '../InstallApp'
import { EnergyCard, StepsCard, WorkoutsCard } from './Energy'
import { ActivityCheck } from './ActivityCheck'

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
  over_budget: { color: 'var(--warn)', soft: 'var(--warn-soft)', icon: TriangleAlert },
  surplus: { color: 'var(--surplus)', soft: 'var(--surplus-soft)', icon: TriangleAlert },
  over: { color: 'var(--info)', soft: 'var(--info-soft)', icon: Info },
  room: { color: 'var(--info)', soft: 'var(--info-soft)', icon: ArrowDown },
  empty: { color: 'var(--ink-3)', soft: 'var(--surface-2)', icon: Plus },
}

const STATUS_SHORT: Record<GoalStatus, string> = {
  success: 'ביעד',
  almost: 'כמעט',
  over_budget: 'מעל התקציב',
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
      summary: summarizeDay({ date, food: f, exercises: ex, steps: health[date]?.steps ?? 0, health: health[date], profile: settings.profile, proteinTarget: settings.proteinTarget, target: dayTarget(settings), routine: routineContextOf(settings, Object.values(exercise)) }),
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
          <BalanceHero s={summary} isToday={date === today} />
          <EnergyCard s={summary} isToday={date === today} />
          <StepsCard date={date} isToday={date === today} onOpen={actions.onSteps} />
          <WorkoutsCard s={summary} exercises={exercises} onOpen={actions.onExercise} />
          {date <= today && <ActivityCheck date={date} exercises={exercises} isToday={date === today} />}
          <ProteinCard s={summary} />
          <div className="grid grid-cols-2 gap-3">
            <MacroTile label="שומן" value={summary.fat} color="var(--fat)" />
            <MacroTile label="פחמימות" value={summary.carbs} color="var(--carbs)" />
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

function BalanceHero({ s, isToday }: { s: DaySummary; isToday: boolean }) {
  const goal = s.goal
  if (!goal) return null
  const style = STATUS_STYLE[goal.status]
  const Icon = style.icon
  const balance = -goal.deficit
  const TARGET_MIN = s.target.min
  const TARGET_MAX = s.target.max
  // the axis always holds the whole target band (a custom deficit can reach 1,000, a surplus 500)
  const lo = Math.min(G_MIN, -TARGET_MAX - 200)
  const hi = Math.max(G_MAX, -TARGET_MIN + 200)
  const pos = (v: number) => ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100
  const showMarker = s.hasFood

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
        <p className={`text-lg font-semibold ${goal.status === 'success' ? 'text-good' : ''}`}>{s.hasFood ? goal.title : TARGET_MIN >= 0 ? `כדי לסיים בגירעון של \u2066${TARGET_MIN}–${TARGET_MAX}\u2069` : TARGET_MAX <= 0 ? `כדי לסיים בעודף של \u2066${-TARGET_MAX}–${-TARGET_MIN}\u2069` : 'כדי לסיים בטווח היעד שלך'}</p>
        {s.hasFood && goal.detail && <p className="text-[15px] text-ink-2">{goal.detail}</p>}
      </div>

      {/* number line: eaten − burned. Green band = the target band in force (phase or custom). */}
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
      <p className="mt-1 text-center text-xs text-ink-3" data-testid="calorie-target">
        יעד יומי: {bandLabel(s.target)} {KCAL}
      </p>

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
            {s.energy?.mode === 'health' && s.energy.partial ? (isToday ? 'שריפה צפויה היום' : 'שריפה (משוערת ליום)') : 'קלוריות שנשרפו'}
          </p>
          <p className="num text-[28px] font-semibold tracking-tight">
            <AnimatedNumber value={s.burned} format={fmt} />
          </p>
          {s.energy && (
            // the burn is partly an estimate: say how sure it is instead of implying a precise number
            <p className={`text-xs ${s.energy.confidence === 'low' ? 'text-warn' : 'text-ink-3'}`} data-testid="burn-uncertainty">
              ±{fmt(s.energy.uncertainty)} · ביטחון {s.energy.confidence === 'high' ? 'גבוה' : s.energy.confidence === 'medium' ? 'בינוני' : 'נמוך'}
            </p>
          )}
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
