import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Sparkles } from 'lucide-react'
import { deleteFood, upsertFood, useStore } from '../../data/store'
import { mealForTime, type FoodEntry } from '../../data/types'
import type { DaySummary } from '../../domain/day'
import { suggest, type Needs, type Suggestion } from '../../domain/suggest'
import { newId, totalsOf, withGrams } from '../../../supabase/functions/_shared/nutrition.ts'
import { fmt, haptic, KCAL } from '../format'
import { showToast } from '../toast'

/** "now", refreshed every few minutes and when the app comes back to the foreground */
function useNow(everyMs = 5 * 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const tick = () => setNow(new Date())
    const id = setInterval(tick, everyMs)
    const onVis = () => document.visibilityState === 'visible' && tick()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [everyMs])
  return now
}

function needLine(n: Needs): string {
  if (n.protein === 'low') return `חסרים עוד ${fmt(n.proteinGap)} ג׳ חלבון${n.carbs === 'high' ? ' · פחמימות כבר גבוהות' : ''}`
  if (n.carbs === 'low' && n.fat === 'low') return 'חסרות עוד פחמימות ושומן'
  if (n.carbs === 'low') return 'חסרות עוד פחמימות'
  if (n.fat === 'low') return 'חסר עוד שומן'
  return ''
}

/**
 * Up to three foods the user has actually eaten around this time of day that fit what is
 * still missing today (see domain/suggest.ts). Today only; quiet when nothing is missing.
 */
export function Suggestions({ s, date }: { s: DaySummary; date: string }) {
  const food = useStore((st) => st.food)
  const deficit = useStore((st) => st.settings.deficitTarget)
  const now = useNow()
  const result = useMemo(
    () =>
      suggest({
        history: Object.values(food),
        intake: { calories: s.eaten, protein_g: s.protein, fat_g: s.fat, carbs_g: s.carbs },
        targets: { burned: s.burned, deficitMin: deficit.min, deficitMax: deficit.max, proteinTarget: s.proteinTarget },
        now,
      }),
    [food, s.eaten, s.protein, s.fat, s.carbs, s.burned, s.proteinTarget, deficit.min, deficit.max, now],
  )
  const hasAnyHistory = useMemo(() => Object.values(food).some((f) => !f.deleted && f.status === 'ok' && f.date !== date), [food, date])

  if (result.kind === 'not_enough_history') {
    if (!hasAnyHistory || result.needs.balanced) return null
    return (
      <p className="animate-rise rounded-2xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-ink-3" data-testid="suggestions-empty">
        <Sparkles className="me-1.5 inline size-4 align-[-2px]" aria-hidden />
        הצעות מהאוכל שלך יופיעו אחרי שתרשום ארוחות בשעות האלה בכמה ימים.
      </p>
    )
  }
  if (result.kind !== 'suggestions') return null

  return (
    <section aria-label="הצעה לעכשיו" className="card animate-rise p-4" style={{ animationDelay: '90ms' }}>
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="flex items-center gap-1.5 font-semibold">
          <Sparkles className="size-4 text-protein" aria-hidden /> הצעה לעכשיו
        </h2>
        <p className="truncate text-sm text-ink-3" data-testid="suggestions-need">
          {needLine(result.needs)}
        </p>
      </div>
      <ul className="mt-2 flex flex-col">
        {result.items.map((sug) => (
          <SuggestionRow key={sug.key} sug={sug} date={date} />
        ))}
      </ul>
      <p className="px-1 pt-1 text-xs text-ink-3">מתוך מה שאכלת בשעות האלה · לפי הכמות הרגילה שלך</p>
    </section>
  )
}

function SuggestionRow({ sug, date }: { sug: Suggestion; date: string }) {
  const [open, setOpen] = useState(false)
  const [grams, setGrams] = useState(sug.grams)
  const adding = useRef(false)
  useEffect(() => setGrams(sug.grams), [sug.grams])
  const item = useMemo(() => withGrams({ ...sug.item, id: 'preview' }, grams), [sug.item, grams])
  const step = Math.max(5, Math.round(sug.grams / 4 / 5) * 5)

  function add() {
    if (adding.current || grams <= 0) return
    adding.current = true
    const at = new Date()
    const it = withGrams({ ...sug.item, id: newId() }, grams)
    const entry: FoodEntry = {
      id: newId(),
      date,
      meal: mealForTime(at),
      title: sug.name,
      emoji: sug.emoji ?? '🍽️',
      items: [it],
      totals: totalsOf([it]),
      confidence: it.confidence,
      provider: 'history',
      status: 'ok',
      created_at: at.toISOString(),
      updated_at: at.toISOString(),
    }
    upsertFood(entry)
    haptic(18)
    showToast(`נוסף · ${sug.name} · ${fmt(entry.totals.calories)} ${KCAL}`, { label: 'ביטול', run: () => deleteFood(entry.id) })
    // the row disappears once the log updates (eaten just now → not suggested again)
    setTimeout(() => (adding.current = false), 800)
  }

  return (
    <li className="rounded-2xl">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="pressable flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-1 py-1.5 text-start hover:bg-surface-2"
          aria-label={`${sug.name}, ${fmt(item.grams)} גרם, ${fmt(item.calories)} קלוריות, חלבון ${fmt(item.protein_g)} גרם. לשינוי כמות`}
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-xl" aria-hidden>
            {sug.emoji ?? '🍽️'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{sug.name}</span>
            <span className="num block truncate text-sm text-ink-3">
              {fmt(item.grams)} ג׳ · {fmt(item.calories)} {KCAL} · <span className="text-protein">חלבון {fmt(item.protein_g)}</span> · פחמ׳ {fmt(item.carbs_g)} · שומן {fmt(item.fat_g)}
            </span>
          </span>
        </button>
        <button type="button" onClick={add} className="pressable grid size-11 shrink-0 place-items-center rounded-full bg-ink text-inverse" aria-label={`הוסף ${sug.name}`}>
          <Plus className="size-5" strokeWidth={2.6} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="flex items-center justify-center gap-3 pb-2" role="group" aria-label={`כמות ${sug.name}`}>
          <button type="button" onClick={() => setGrams((g) => Math.max(step, g - step))} className="pressable grid size-10 place-items-center rounded-full bg-surface-2" aria-label="פחות">
            <Minus className="size-4" aria-hidden />
          </button>
          <span className="num min-w-20 text-center font-semibold" aria-live="polite">
            {fmt(grams)} ג׳
          </span>
          <button type="button" onClick={() => setGrams((g) => Math.min(2000, g + step))} className="pressable grid size-10 place-items-center rounded-full bg-surface-2" aria-label="יותר">
            <Plus className="size-4" aria-hidden />
          </button>
          {grams !== sug.grams && (
            <button type="button" onClick={() => setGrams(sug.grams)} className="pressable min-h-10 rounded-full px-3 text-sm text-ink-3">
              כרגיל ({fmt(sug.grams)})
            </button>
          )}
        </div>
      )}
    </li>
  )
}
