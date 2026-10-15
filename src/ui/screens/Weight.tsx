import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Minus, Trash2 } from 'lucide-react'
import { deleteWeight, restoreWeight, saveWeight, useStore, weightList } from '../../data/store'
import type { WeightEntry } from '../../data/types'
import { toDateKey } from '../../domain/goal'
import { dayNum, inRange, parseKg, smoothPath, summary, xAxis, yAxis, type WeightPoint, type WeightRange } from '../../domain/weight'
import { GhostButton, PrimaryButton, Segmented, Sheet } from '../primitives'
import { dateLong, dateShort, haptic } from '../format'
import { showToast } from '../toast'

const kgFmt = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const fmtKg = (kg: number) => kgFmt.format(kg)
const KG = 'ק״ג'

function fmtChange(change: number): string {
  if (change === 0) return '0.0'
  return `${change > 0 ? '+' : '−'}${kgFmt.format(Math.abs(change))}`
}

function relativeDay(date: string, today: string): string {
  const d = dayNum(today) - dayNum(date)
  if (d === 0) return 'היום'
  if (d === 1) return 'אתמול'
  if (d < 7) return `לפני ${d} ימים`
  return dateShort(date)
}

const toPoints = (list: WeightEntry[]): WeightPoint[] => list.map((w) => ({ date: w.date, kg: w.weight_kg }))

/**
 * Body weight: the latest weigh-in, the change since the previous one, a quick
 * entry for this week's weigh-in, one trend chart, and the list (tap to fix).
 */
export function Weight({ switcher }: { switcher: ReactNode }) {
  const weights = useStore((s) => s.weights)
  const list = useMemo(() => weightList({ weights }), [weights])
  // a short history fills the chart ("all" starts at the first weigh-in); a long one opens on 3 months
  const [range, setRange] = useState<WeightRange>(() => {
    const first = list[0]
    return first && dayNum(toDateKey(new Date())) - dayNum(first.date) > 92 ? '3m' : 'all'
  })
  const [editing, setEditing] = useState<WeightEntry | null>(null)
  const [showAll, setShowAll] = useState(false)
  const today = toDateKey(new Date())
  const points = useMemo(() => toPoints(list), [list])
  const s = summary(points)
  const newestFirst = [...list].reverse()
  const visible = showAll ? newestFirst : newestFirst.slice(0, 6)

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-36">
      <header className="safe-top flex flex-col gap-4 pb-2">
        {switcher}
        <h1 className="sr-only">משקל</h1>
      </header>

      {s.latest ? (
        <section aria-label="משקל נוכחי" className="pt-2 pb-5">
          <p className="text-sm text-ink-3">משקל אחרון · {relativeDay(s.latest.date, today)}</p>
          <p className="mt-1 flex items-baseline gap-2" data-testid="weight-current">
            <span className="num text-[56px] leading-none font-semibold tracking-tight">{fmtKg(s.latest.kg)}</span>
            <span className="text-xl text-ink-3">{KG}</span>
          </p>
          {s.change !== null && s.previous ? (
            <p className="mt-2 flex items-center gap-1.5 text-[15px] text-ink-2" data-testid="weight-change">
              {s.change > 0 ? <ArrowUp className="size-4" aria-hidden /> : s.change < 0 ? <ArrowDown className="size-4" aria-hidden /> : <Minus className="size-4" aria-hidden />}
              <span className="ltr num font-semibold">{fmtChange(s.change)}</span> {KG}
              <span className="text-ink-3">מאז {dateShort(s.previous.date)}</span>
            </p>
          ) : (
            <p className="mt-2 text-[15px] text-ink-3">השקילה הראשונה. בשקילה הבאה יופיע כאן השינוי.</p>
          )}
        </section>
      ) : (
        <section aria-label="עוד אין שקילות" className="flex flex-col items-center gap-2 pt-6 pb-6 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-surface-2 text-2xl" aria-hidden>
            ⚖️
          </span>
          <p className="text-lg font-semibold">עוד אין שקילות</p>
          <p className="max-w-xs text-[15px] leading-relaxed text-ink-3">שקילה פעם בשבוע, באותו יום ובאותה שעה, מספיקה כדי לראות מגמה.</p>
        </section>
      )}

      <QuickEntry latest={s.latest} today={today} />

      {points.length > 0 && (
        <section aria-label="מגמת משקל" className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">מגמה</h2>
            <div className="w-[15.5rem] shrink-0">
              <Segmented<WeightRange>
                label="טווח"
                size="sm"
                value={range}
                onChange={setRange}
                options={[
                  { value: '1m', label: 'חודש' },
                  { value: '3m', label: <span className="whitespace-nowrap">3 חודשים</span> },
                  { value: 'all', label: 'הכל' },
                ]}
              />
            </div>
          </div>
          <WeightChart points={points} range={range} today={today} />
        </section>
      )}

      {list.length > 0 && (
        <section aria-label="שקילות" className="mt-6">
          <h2 className="mb-1 text-lg font-semibold">שקילות</h2>
          <ul className="flex flex-col">
            {visible.map((w, i) => {
              const prev = newestFirst[i + 1]
              const d = prev ? Math.round((w.weight_kg - prev.weight_kg) * 10) / 10 : null
              return (
                <li key={w.date}>
                  <button
                    type="button"
                    onClick={() => setEditing(w)}
                    className="pressable -mx-2 flex min-h-13 w-[calc(100%+1rem)] items-center gap-3 rounded-2xl px-2 py-2 text-start hover:bg-surface-2"
                    aria-label={`${dateLong(w.date)}: ${fmtKg(w.weight_kg)} ${KG}. לעריכה`}
                  >
                    <span className="min-w-0 flex-1 text-[15px]">{dateLong(w.date)}</span>
                    {d !== null && <span className="ltr num text-sm text-ink-3">{fmtChange(d)}</span>}
                    <span className="num w-16 shrink-0 text-end font-semibold">{fmtKg(w.weight_kg)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {!showAll && newestFirst.length > visible.length && (
            <button type="button" onClick={() => setShowAll(true)} className="pressable mt-1 min-h-11 rounded-xl px-2 text-sm font-medium text-ink-2">
              כל השקילות ({newestFirst.length})
            </button>
          )}
        </section>
      )}

      <EditWeightSheet entry={editing} onClose={() => setEditing(null)} today={today} />
    </div>
  )
}

// ── quick entry ─────────────────────────────────────────────────────────────

function QuickEntry({ latest, today }: { latest: WeightPoint | null; today: string }) {
  const weights = useStore((s) => s.weights)
  const [text, setText] = useState('')
  const [date, setDate] = useState(today)
  const [touched, setTouched] = useState(false)
  const id = useId()
  const kg = parseKg(text)
  const existing = weights[date] && !weights[date].deleted ? weights[date] : null
  const invalid = touched && text.trim() !== '' && kg === null

  function save() {
    setTouched(true)
    if (kg === null) return
    const before = existing ? { ...existing } : null
    saveWeight(date, kg)
    haptic(18)
    setText('')
    setTouched(false)
    showToast(before ? `עודכן · ${fmtKg(kg)} ${KG}` : `נשמר · ${fmtKg(kg)} ${KG}`, {
      label: 'ביטול',
      run: () => (before ? saveWeight(before.date, before.weight_kg) : deleteWeight(date)),
    })
    setDate(today)
  }

  return (
    <form
      className="card flex flex-col gap-3 p-4"
      aria-label="שקילה חדשה"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <div className="flex items-end gap-2">
        <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">שקילה חדשה</span>
          <span className={`flex min-h-14 items-center rounded-2xl bg-surface-2 px-4 focus-within:ring-2 ${invalid ? 'ring-2 ring-surplus' : 'focus-within:ring-info'}`}>
            <input
              id={id}
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              autoComplete="off"
              placeholder={latest ? fmtKg(latest.kg) : '0.0'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={invalid}
              aria-describedby={`${id}-hint`}
              className="num ltr w-full min-w-0 bg-transparent text-end text-2xl font-semibold outline-none placeholder:text-ink-3/50"
            />
            <span className="shrink-0 ps-2 text-ink-3">{KG}</span>
          </span>
        </label>
        <PrimaryButton type="submit" className="min-w-24 px-5" disabled={kg === null}>
          {existing ? 'עדכן' : 'שמור'}
        </PrimaryButton>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3" id={`${id}-hint`}>
        <DateChip value={date} max={today} onChange={setDate} />
        {invalid ? (
          <span className="text-surplus">משקל בין 20 ל-400 ק״ג</span>
        ) : existing ? (
          <span>כבר יש שקילה ביום הזה ({fmtKg(existing.weight_kg)}) — השמירה תעדכן אותה</span>
        ) : (
          <span>מעדכן גם את חישוב השריפה</span>
        )}
      </div>
    </form>
  )
}

/** A compact date button over a native date picker (iOS / Android wheel). */
function DateChip({ value, max, onChange }: { value: string; max: string; onChange: (v: string) => void }) {
  const today = toDateKey(new Date())
  return (
    <label className="pressable relative inline-flex min-h-9 cursor-pointer items-center rounded-full bg-surface-2 px-3 font-medium text-ink-2">
      <span>{value === today ? 'היום' : dateShort(value)}</span>
      <input
        type="date"
        aria-label="תאריך השקילה"
        value={value}
        max={max}
        onChange={(e) => e.target.value && onChange(e.target.value > max ? max : e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  )
}

// ── edit / delete ───────────────────────────────────────────────────────────

function EditWeightSheet({ entry, onClose, today }: { entry: WeightEntry | null; onClose: () => void; today: string }) {
  const weights = useStore((s) => s.weights)
  const [text, setText] = useState('')
  const [date, setDate] = useState(today)
  const id = useId()
  useEffect(() => {
    if (entry) {
      setText(fmtKg(entry.weight_kg).replace(',', '.'))
      setDate(entry.date)
    }
  }, [entry])
  const kg = parseKg(text)
  const clash = entry && date !== entry.date && weights[date] && !weights[date].deleted ? weights[date] : null

  function save() {
    if (!entry || kg === null) return
    saveWeight(date, kg, entry.date)
    haptic(18)
    onClose()
    showToast(`עודכן · ${fmtKg(kg)} ${KG}`)
  }
  function remove() {
    if (!entry) return
    deleteWeight(entry.date)
    onClose()
    showToast('השקילה נמחקה', { label: 'ביטול', run: () => restoreWeight(entry.date) })
  }

  return (
    <Sheet
      open={entry !== null}
      onClose={onClose}
      title="עריכת שקילה"
      footer={
        <div className="flex gap-2">
          <PrimaryButton className="flex-1" onClick={save} disabled={kg === null}>
            שמירה
          </PrimaryButton>
          <GhostButton onClick={remove} aria-label="מחיקת השקילה" className="min-h-14 px-4 text-surplus">
            <Trash2 className="size-5" />
          </GhostButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pt-2 pb-2">
        <label htmlFor={id} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">משקל</span>
          <span className="flex min-h-14 items-center rounded-2xl bg-surface-2 px-4 focus-within:ring-2 focus-within:ring-info">
            <input
              id={id}
              type="text"
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="num ltr w-full min-w-0 bg-transparent text-end text-2xl font-semibold outline-none"
            />
            <span className="shrink-0 ps-2 text-ink-3">{KG}</span>
          </span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">תאריך</span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="min-h-14 rounded-2xl bg-surface-2 px-4 text-lg outline-none focus:ring-2 focus:ring-info"
          />
        </label>
        {clash && <p className="text-sm text-warn">ביום הזה כבר יש שקילה ({fmtKg(clash.weight_kg)} {KG}) — היא תוחלף.</p>}
      </div>
    </Sheet>
  )
}

// ── chart ───────────────────────────────────────────────────────────────────

/**
 * One line, measured points only, honest axis (≥ 4 kg visible, round-kg gridlines).
 * Time runs right → left like the rest of the app (RTL): the newest weigh-in is on the left.
 */
function WeightChart({ points, range, today }: { points: WeightPoint[]; range: WeightRange; today: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(340)
  const [active, setActive] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => setActive(null), [range])

  const shown = inRange(points, range, today)
  const H = 210
  const padT = 12
  const padB = 26
  const padR = 34 // kg labels (start side in RTL)
  const padL = 10
  const { from, to } = xAxis(shown.length ? shown : points, range, today)
  const { lo, hi, ticks } = yAxis(shown.map((p) => p.kg))
  const innerW = w - padL - padR
  const x = (date: string) => padL + ((to - dayNum(date)) / Math.max(1, to - from)) * innerW
  const y = (kg: number) => padT + ((hi - kg) / (hi - lo || 1)) * (H - padT - padB)
  const px = shown.map((p) => ({ x: x(p.date), y: y(p.kg) })).sort((a, b) => a.x - b.x)
  const line = smoothPath(px)
  const xTicks = [0, 1, 2, 3].map((i) => Math.round(from + ((to - from) * i) / 3))
  const dateOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10)
  const first = shown[0]
  const last = shown.at(-1)
  const label = first && last ? `גרף משקל: ${fmtKg(first.kg)} ק״ג ב-${dateShort(first.date)}, ${fmtKg(last.kg)} ק״ג ב-${dateShort(last.date)}` : 'אין שקילות בטווח הזה'

  return (
    <div ref={ref} className="relative w-full select-none" data-testid="weight-chart">
      <svg width={w} height={H} role="img" aria-label={label} className="block overflow-visible" direction="ltr">
        <defs>
          <linearGradient id="wfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--ink)" stopOpacity="0.08" />
            <stop offset="1" stopColor="var(--ink)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={w - 2} y={y(t) + 4} fontSize={11} fill="var(--ink-3)" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {xTicks.map((n, i) => (
          <text key={i} x={x(dateOf(n))} y={H - 6} fontSize={11} fill="var(--ink-3)" textAnchor={i === 0 ? 'end' : i === 3 ? 'start' : 'middle'}>
            {dateShort(dateOf(n))}
          </text>
        ))}
        {px.length > 1 && <path d={`${line}L${px.at(-1)!.x},${H - padB}L${px[0].x},${H - padB}Z`} fill="url(#wfill)" />}
        {px.length > 1 && <path d={line} fill="none" stroke="var(--ink)" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />}
        {shown.map((p, i) => {
          const newest = i === shown.length - 1
          // dots only while they have room (≥ 9 px apart); the newest weigh-in is always marked
          if (!newest && active !== i && innerW / Math.max(1, shown.length - 1) < 9) return null
          return (
            <circle
              key={p.date}
              cx={x(p.date)}
              cy={y(p.kg)}
              r={newest || active === i ? 5 : 3.25}
              fill={newest || active === i ? 'var(--ink)' : 'var(--surface)'}
              stroke="var(--ink)"
              strokeWidth={2}
            />
          )
        })}
        {/* tap targets: the nearest weigh-in */}
        {shown.map((p, i) => (
          <rect
            key={`t-${p.date}`}
            x={x(p.date) - 18}
            y={0}
            width={36}
            height={H - padB}
            fill="transparent"
            onClick={() => setActive(active === i ? null : i)}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <title>{`${dateShort(p.date)}: ${fmtKg(p.kg)} ק״ג`}</title>
          </rect>
        ))}
      </svg>
      {!shown.length && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-ink-3">אין שקילות בטווח הזה</p>}
      {active !== null && shown[active] && (
        <div
          className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-full flex-col items-center rounded-xl bg-ink px-3 py-1.5 text-xs whitespace-nowrap text-inverse shadow-[var(--shadow-2)]"
          style={{ left: Math.min(w - 50, Math.max(50, x(shown[active].date))), top: y(shown[active].kg) - 10 }}
        >
          <b className="num text-sm">{fmtKg(shown[active].kg)} ק״ג</b>
          <span className="opacity-70">{dateShort(shown[active].date)}</span>
        </div>
      )}
    </div>
  )
}
