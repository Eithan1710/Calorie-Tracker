import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useStore, foodForDate, exercisesForDate } from '../../data/store'
import { summarizeDay, type DaySummary } from '../../domain/day'
import { addDays, isDayFinal, toDateKey } from '../../domain/goal'
import { Segmented } from '../primitives'
import { dateLong, dateShort, fmt, fmtBalance, KCAL, weekdayShort } from '../format'
import { STATUS_STYLE } from './Today'

type Range = 7 | 30

export function History({ onOpenDay }: { onOpenDay: (date: string) => void }) {
  const [range, setRange] = useState<Range>(7)
  const food = useStore((s) => s.food)
  const exercise = useStore((s) => s.exercise)
  const health = useStore((s) => s.health)
  const settings = useStore((s) => s.settings)
  const today = toDateKey(new Date())

  const days: DaySummary[] = useMemo(() => {
    const st = { food, exercise }
    return Array.from({ length: range }, (_, i) => {
      const date = addDays(today, -(range - 1 - i))
      return summarizeDay({
        date,
        food: foodForDate(st, date),
        exercises: exercisesForDate(st, date),
        steps: health[date]?.steps ?? 0,
        profile: settings.profile,
        proteinTarget: settings.proteinTarget,
        target: settings.deficitTarget,
      })
    })
  }, [food, exercise, health, settings, range, today])

  const { min: TARGET_MIN, max: TARGET_MAX } = settings.deficitTarget
  const logged = days.filter((d) => d.hasFood)
  const finished = logged.filter((d) => isDayFinal(d.date))
  const inTarget = finished.filter((d) => d.goal?.status === 'success').length
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null)
  const avgBalance = avg(finished.map((d) => d.eaten - d.burned))
  const avgProtein = avg(logged.map((d) => d.protein))
  const proteinDays = logged.filter((d) => d.proteinMet).length
  const stepDays = days.filter((d) => d.steps > 0)
  const avgSteps = avg(stepDays.map((d) => d.steps))

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-36 lg:px-8">
      <header className="safe-top flex items-center justify-between gap-3 pb-4">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">היסטוריה</h1>
        <div className="w-44">
          <Segmented<'7' | '30'>
            label="טווח"
            size="sm"
            value={String(range) as '7' | '30'}
            onChange={(v) => setRange(Number(v) as Range)}
            options={[
              { value: '7', label: 'שבוע' },
              { value: '30', label: 'חודש' },
            ]}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="ימים ביעד" value={finished.length ? `${inTarget}/${finished.length}` : '—'} hint={"גירעון \u2066100–300\u2069"} />
        <Stat label="מאזן ממוצע" value={avgBalance === null ? '—' : fmtBalance(-avgBalance)} hint={KCAL} ltr />
        <Stat label="חלבון ממוצע" value={avgProtein === null ? '—' : `${fmt(avgProtein)} ג׳`} hint={logged.length ? `ביעד ${proteinDays}/${logged.length} ימים` : ''} />
        <Stat label="צעדים ממוצע" value={avgSteps === null ? '—' : fmt(avgSteps)} hint="ליום" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard title="מאזן יומי" subtitle={`נכנסו פחות נשרפו · הפס הירוק = היעד שלך (גירעון \u2066${TARGET_MIN}–${TARGET_MAX}\u2069)`}>
          <BarChart
            days={days}
            value={(d) => (d.hasFood && d.burn ? d.eaten - d.burned : null)}
            color={(d) => (d.goal ? STATUS_STYLE[d.goal.status].color : 'var(--ink-3)')}
            band={[-TARGET_MAX, -TARGET_MIN]}
            minDomain={[-500, 200]}
            format={(v) => fmtBalance(-v)}
            tooltip={(d) => (
              <>
                <b>{fmtBalance(d.goal!.deficit)} {KCAL}</b>
                <span>נכנסו {fmt(d.eaten)} · נשרפו {fmt(d.burned)}</span>
                <span>{d.goal!.title}</span>
              </>
            )}
            onSelect={onOpenDay}
          />
        </ChartCard>

        <ChartCard title="חלבון" subtitle={`גרם ליום · קו = יעד ${settings.proteinTarget} ג׳`}>
          <BarChart
            days={days}
            value={(d) => (d.hasFood ? d.protein : null)}
            color={() => 'var(--protein)'}
            refLine={{ value: settings.proteinTarget, label: String(settings.proteinTarget) }}
            minDomain={[0, settings.proteinTarget * 1.2]}
            format={(v) => `${fmt(v)}`}
            tooltip={(d) => (
              <>
                <b>{fmt(d.protein)} ג׳ חלבון</b>
                <span>{d.proteinMet ? '✓ היעד הושג' : `חסרו ${fmt(d.proteinTarget - d.protein)} ג׳`}</span>
              </>
            )}
            onSelect={onOpenDay}
          />
        </ChartCard>

        <ChartCard title="צעדים" subtitle="ליום">
          <BarChart
            days={days}
            value={(d) => (d.steps > 0 ? d.steps : null)}
            color={() => 'var(--ink-2)'}
            minDomain={[0, 8000]}
            format={(v) => fmt(v)}
            tooltip={(d) => <b>{fmt(d.steps)} צעדים</b>}
            onSelect={onOpenDay}
          />
        </ChartCard>

        <section className="card p-2" aria-label="ימים">
          <h2 className="px-3 pt-3 pb-1 text-lg font-semibold">ימים</h2>
          {logged.length === 0 ? (
            <p className="px-3 pb-4 text-ink-3">עוד אין נתונים בטווח הזה.</p>
          ) : (
            <ul>
              {[...logged].reverse().map((d) => {
                const st = STATUS_STYLE[d.goal?.status ?? 'empty']
                const Icon = st.icon
                return (
                  <li key={d.date}>
                    <button type="button" onClick={() => onOpenDay(d.date)} className="pressable flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-start hover:bg-surface-2">
                      <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: st.soft, color: st.color }}>
                        <Icon className="size-4" strokeWidth={2.6} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{d.date === today ? 'היום' : dateLong(d.date)}</span>
                        <span className="block text-sm text-ink-3">
                          {fmt(d.eaten)} / {fmt(d.burned)} · חלבון {fmt(d.protein)} ג׳{d.steps ? ` · ${fmt(d.steps)} צעדים` : ''}
                        </span>
                      </span>
                      <span className="ltr num shrink-0 font-semibold">{d.goal ? fmtBalance(d.goal.deficit) : ''}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, hint, ltr }: { label: string; value: string; hint?: string; ltr?: boolean }) {
  return (
    <div className="card px-4 py-3.5">
      <p className="text-sm text-ink-3">{label}</p>
      <p className={`mt-0.5 text-2xl font-semibold tracking-tight ${ltr ? 'ltr text-end' : ''}`}>{value}</p>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="card p-4" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-ink-3">{subtitle}</p>
      {children}
    </section>
  )
}

/**
 * Minimal SVG column chart. Single series → no legend (the card title names it).
 * Time runs right→left (RTL): today is the left-most column.
 * Status colours always come with text in the tooltip and the day list.
 */
function BarChart({
  days,
  value,
  color,
  band,
  refLine,
  minDomain,
  format,
  tooltip,
  onSelect,
}: {
  days: DaySummary[]
  value: (d: DaySummary) => number | null
  color: (d: DaySummary) => string
  band?: [number, number]
  refLine?: { value: number; label: string }
  minDomain: [number, number]
  format: (v: number) => string
  tooltip: (d: DaySummary) => ReactNode
  onSelect: (date: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(320)
  const [hover, setHover] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 150
  const padTop = 14
  const padBottom = 22
  const vals = days.map(value)
  const nums = vals.filter((v): v is number => v !== null)
  let lo = Math.min(minDomain[0], ...nums, band?.[0] ?? Infinity, refLine?.value ?? Infinity)
  let hi = Math.max(minDomain[1], ...nums, band?.[1] ?? -Infinity, refLine?.value ?? -Infinity)
  lo = Math.min(lo, 0)
  hi = Math.max(hi, 0)
  const span = hi - lo || 1
  const y = (v: number) => padTop + ((hi - v) / span) * (H - padTop - padBottom)
  const n = days.length
  const slot = w / n
  const barW = Math.min(24, Math.max(4, slot * 0.6))
  // RTL: index 0 (oldest) on the right
  const cx = (i: number) => w - (i + 0.5) * slot
  const today = toDateKey(new Date())
  const labelEvery = n > 10 ? 5 : 1

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={w} height={H} role="img" aria-label="תרשים עמודות לפי יום" className="block overflow-visible" direction="ltr">
        {band && <rect x={0} width={w} y={y(band[1])} height={Math.max(1, y(band[0]) - y(band[1]))} fill="var(--good)" opacity={0.12} rx={4} />}
        <line x1={0} x2={w} y1={y(0)} y2={y(0)} stroke="var(--line)" strokeWidth={1} />
        {refLine && (
          <>
            <line x1={0} x2={w} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--ink-3)" strokeWidth={1} />
            <text x={w - 2} y={y(refLine.value) - 4} fontSize={11} fill="var(--ink-3)" textAnchor="end">
              {refLine.label}
            </text>
          </>
        )}
        {days.map((d, i) => {
          const v = vals[i]
          const x = cx(i)
          const isHover = hover === i
          return (
            <g key={d.date}>
              {v !== null ? (
                (() => {
                  const y0 = y(0)
                  const y1 = y(v)
                  const top = Math.min(y0, y1)
                  const h = Math.max(2, Math.abs(y1 - y0))
                  const r = Math.min(4, barW / 2, h)
                  // rounded data-end, square at the baseline
                  const up = v >= 0
                  const path = up
                    ? `M${x - barW / 2},${y0} V${top + r} Q${x - barW / 2},${top} ${x - barW / 2 + r},${top} H${x + barW / 2 - r} Q${x + barW / 2},${top} ${x + barW / 2},${top + r} V${y0} Z`
                    : `M${x - barW / 2},${y0} V${top + h - r} Q${x - barW / 2},${top + h} ${x - barW / 2 + r},${top + h} H${x + barW / 2 - r} Q${x + barW / 2},${top + h} ${x + barW / 2},${top + h - r} V${y0} Z`
                  return <path d={path} fill={color(d)} opacity={d.date === today && !isDayFinal(d.date) ? 0.45 : hover === null || isHover ? 1 : 0.55} style={{ transition: 'opacity 150ms' }} />
                })()
              ) : (
                <circle cx={x} cy={y(0)} r={1.5} fill="var(--ink-3)" opacity={0.5} />
              )}
              {(i % labelEvery === (n - 1) % labelEvery || n <= 10) && (
                <text x={x} y={H - 6} fontSize={11} textAnchor="middle" fill={d.date === today ? 'var(--ink)' : 'var(--ink-3)'} fontWeight={d.date === today ? 600 : 400}>
                  {n <= 10 ? weekdayShort(d.date) : dateShort(d.date)}
                </text>
              )}
              <rect
                x={x - slot / 2}
                width={slot}
                y={0}
                height={H}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onClick={() => (v !== null ? (hover === i ? onSelect(d.date) : setHover(i)) : onSelect(d.date))}
                style={{ cursor: 'pointer' }}
              >
                <title>{v !== null ? `${dateShort(d.date)}: ${format(v)}` : dateShort(d.date)}</title>
              </rect>
            </g>
          )
        })}
      </svg>
      {hover !== null && vals[hover] !== null && (
        <div
          className="pointer-events-none absolute -top-2 z-10 flex -translate-x-1/2 -translate-y-full flex-col gap-0.5 rounded-xl bg-ink px-3 py-2 text-xs whitespace-nowrap text-inverse shadow-[var(--shadow-2)]"
          style={{ left: Math.min(w - 70, Math.max(70, cx(hover))) }}
        >
          <span className="opacity-70">{dateLong(days[hover].date)}</span>
          {tooltip(days[hover])}
        </div>
      )}
    </div>
  )
}
