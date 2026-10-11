import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Clock, Loader2, Search, X } from 'lucide-react'
import { PrimaryButton } from '../primitives'
import { fmt, KCAL } from '../format'
import { useStore } from '../../data/store'
import { CATEGORIES, mergeResults, recentFoods, searchLocal, searchRemote, type FoodCategory } from '../../services/foods'
import { displayName, itemFromDb, STATE_LABEL_HE, trustBadge, type DbFood } from '../../../supabase/functions/_shared/foodMatch.ts'
import { FOOD_BY_KEY } from '../../../supabase/functions/_shared/foodDb.ts'
import { newId, per100FromRef, scale } from '../../../supabase/functions/_shared/nutrition.ts'
import type { FoodItem } from '../../data/types'
import type { Per100 } from '../../../supabase/functions/_shared/schema.ts'

const UNIT_HE: Record<string, string> = {
  unit: 'יחידה', slice: 'פרוסה', tbsp: 'כף', tsp: 'כפית', cup: 'כוס', handful: 'חופן', can: 'קופסה', container: 'גביע',
  scoop: 'סקופ', bag: 'שקית', piece: 'חתיכה', serving: 'מנה',
}

export function TrustBadge({ verification, origin, small = false }: { verification?: FoodItem['verification']; origin?: string; small?: boolean }) {
  const b = trustBadge(verification, origin, small)
  const tone = b.tone === 'good' ? 'bg-good-soft text-good' : b.tone === 'info' ? 'bg-info-soft text-info' : 'bg-warn-soft text-warn'
  return <span className={`shrink-0 rounded-md px-1.5 py-0.5 ${small ? 'text-[11px]' : 'text-xs'} font-medium ${tone}`}>{b.text}</span>
}

/**
 * Find a food in the database and log it with a clear amount.
 * Inline panel (used inside the add-food and edit sheets): search → pick → amount → add.
 */
export function FoodSearch({
  initialQuery = '',
  onPick,
  onCancel,
  pickLabel = 'הוסף',
  keepGrams,
}: {
  initialQuery?: string
  onPick: (item: FoodItem) => void
  onCancel: () => void
  pickLabel?: string
  /** swap mode: keep this amount for the replacement */
  keepGrams?: number
}) {
  const [q, setQ] = useState(initialQuery)
  const [state, setState] = useState<'raw' | 'cooked' | null>(null)
  const [category, setCategory] = useState<FoodCategory | null>(null)
  const [remote, setRemote] = useState<DbFood[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState(false)
  const [chosen, setChosen] = useState<DbFood | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const foodMap = useStore((s) => s.food)
  const recents = useMemo(() => recentFoods(Object.values(foodMap), 12), [foodMap])

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const local = useMemo(() => (q.trim().length >= 2 ? searchLocal(q, { state }) : []), [q, state])

  useEffect(() => {
    setRemote(null)
    if (q.trim().length < 2) return
    const ctrl = new AbortController()
    setLoading(true)
    const t = setTimeout(async () => {
      const rows = await searchRemote(q.trim(), { state, category, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setRemote(rows)
      setOffline(rows === null)
      setLoading(false)
    }, 220)
    return () => {
      ctrl.abort()
      clearTimeout(t)
      setLoading(false)
    }
  }, [q, state, category])

  const results = useMemo(() => mergeResults(local, remote, { state, category }), [local, remote, state, category])

  if (chosen) {
    return (
      <AmountPicker
        food={chosen}
        keepGrams={keepGrams}
        pickLabel={pickLabel}
        onBack={() => setChosen(null)}
        onPick={(grams, basis) => onPick(itemFromDb(chosen, grams, basis))}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="food-search">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onCancel} className="pressable grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2" aria-label="חזרה">
          <ArrowRight className="size-5" />
        </button>
        <label className="flex min-h-12 flex-1 items-center gap-2 rounded-2xl bg-surface-2 px-3 focus-within:ring-2 focus-within:ring-info">
          <Search className="size-5 shrink-0 text-ink-3" aria-hidden />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חפש מאכל או מוצר, למשל: קוטג׳ 5%"
            aria-label="חיפוש במאגר המזון"
            className="min-h-11 w-full min-w-0 bg-transparent text-[17px] outline-none placeholder:text-ink-3"
            enterKeyHint="search"
            type="search"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="grid size-8 place-items-center text-ink-3" aria-label="נקה">
              <X className="size-4" />
            </button>
          )}
        </label>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="סינון">
        {([[null, 'הכל'], ['cooked', 'מבושל / מוכן'], ['raw', 'לא מבושל']] as const).map(([v, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={state === v}
            onClick={() => setState(v)}
            className={`pressable min-h-9 shrink-0 rounded-full px-3 text-sm ${state === v ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2'}`}
          >
            {label}
          </button>
        ))}
        <select
          value={category ?? ''}
          onChange={(e) => setCategory((e.target.value || null) as FoodCategory | null)}
          className="min-h-9 shrink-0 rounded-full bg-surface-2 px-3 text-sm text-ink-2"
          aria-label="קטגוריה"
        >
          <option value="">כל הקטגוריות</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {q.trim().length < 2 ? (
        recents.length > 0 ? (
          <section>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-ink-3">
              <Clock className="size-4" aria-hidden /> אכלת לאחרונה
            </p>
            <ul className="flex flex-col" aria-label="אחרונים">
              {recents.map(({ item, count }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onPick({ ...item, id: newId(), ...(keepGrams ? rescale(item, keepGrams) : {}) })}
                    className="pressable flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 text-start hover:bg-surface-2"
                  >
                    <span className="text-xl" aria-hidden>{item.emoji ?? '🍽️'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{item.name}</span>
                      <span className="block text-sm text-ink-3">
                        <span className="num">{fmt(keepGrams ?? item.grams)}</span> ג׳ · <span className="num">{fmt(keepGrams ? (item.per100.kcal * keepGrams) / 100 : item.calories)}</span> {KCAL}
                        {count > 1 && <span> · {count} פעמים</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="px-1 text-sm text-ink-3">אפשר לחפש בעברית או באנגלית — גם עם שגיאות כתיב. התוצאות המאומתות מופיעות קודם.</p>
        )
      ) : (
        <>
          <ul className="flex flex-col" aria-label="תוצאות" aria-busy={loading}>
            {results.map((f) => (
              <li key={f.id}>
                <ResultRow food={f} onClick={() => setChosen(f)} />
              </li>
            ))}
          </ul>
          {loading && (
            <p className="flex items-center gap-2 px-1 text-sm text-ink-3">
              <Loader2 className="size-4 animate-spin" aria-hidden /> מחפש במאגר המלא…
            </p>
          )}
          {!loading && results.length === 0 && <p className="px-1 text-[15px] text-ink-2">לא נמצא. נסה מילה אחרת, או כתוב מה אכלת בחלון הקודם והניתוח החכם יחשב.</p>}
          {!loading && offline && results.length > 0 && <p className="px-1 text-xs text-ink-3">מוצגות רק התוצאות השמורות במכשיר (המאגר המלא לא זמין כרגע).</p>}
        </>
      )}
      <p className="px-1 text-[11px] leading-relaxed text-ink-3">
        מקורות: מאגר התזונה הלאומי של משרד הבריאות, USDA FoodData Central, ו-Open Food Facts (ODbL) למוצרים ארוזים. ערכים ל-100 גרם.
      </p>
    </div>
  )
}

function rescale(item: FoodItem, grams: number): Partial<FoodItem> {
  return { grams, ...scale(item.per100, grams) }
}

function ResultRow({ food, onClick }: { food: DbFood; onClick: () => void }) {
  const cur = food.curated_key ? FOOD_BY_KEY[food.curated_key] : undefined
  const state = STATE_LABEL_HE[food.state]
  return (
    <button type="button" onClick={onClick} className="pressable flex min-h-14 w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-start hover:bg-surface-2">
      <span className="text-xl" aria-hidden>{cur?.emoji ?? '🍽️'}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{cur?.he ?? displayName(food)}</span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink-3">
          <span>
            <span className="num">{fmt(food.kcal)}</span> {KCAL} · חלבון <span className="num">{Math.round(food.protein_g * 10) / 10}</span> ל-100 ג׳
          </span>
          {state && <span className="rounded-md bg-surface-2 px-1.5 text-[11px] text-ink-2">{state}</span>}
          {food.fat_added && <span className="rounded-md bg-surface-2 px-1.5 text-[11px] text-ink-2">כולל שמן</span>}
        </span>
      </span>
      <TrustBadge verification={cur?.verification ?? food.verification} origin={cur?.source ?? food.source} small />
    </button>
  )
}

function AmountPicker({
  food,
  keepGrams,
  pickLabel,
  onBack,
  onPick,
}: {
  food: DbFood
  keepGrams?: number
  pickLabel: string
  onBack: () => void
  onPick: (grams: number, basis: 'stated' | 'counted') => void
}) {
  const cur = food.curated_key ? FOOD_BY_KEY[food.curated_key] : undefined
  const per100: Per100 = cur ? per100FromRef(cur) : { kcal: food.kcal, protein_g: food.protein_g, fat_g: food.fat_g, carbs_g: food.carbs_g }
  const servings: [string, number][] = cur
    ? Object.entries(cur.units).filter(([k]) => k !== 'serving').map(([k, g]) => [UNIT_HE[k] ?? k, g as number] as [string, number])
    : food.servings
  const defaultGrams = keepGrams ?? cur?.units.serving ?? servings[0]?.[1] ?? 100
  const [grams, setGrams] = useState<number>(Math.round(defaultGrams))
  const [basis, setBasis] = useState<'stated' | 'counted'>(keepGrams ? 'stated' : 'counted')
  const [count, setCount] = useState(1)
  const [unit, setUnit] = useState<[string, number] | null>(null)
  const t = scale(per100, grams)
  const extra = (v: number | null | undefined, unitLabel: string) => (v === null || v === undefined ? 'לא דווח' : `${Math.round(((v * grams) / 100) * 10) / 10} ${unitLabel}`)
  const name = cur?.he ?? displayName(food)
  const note = cur?.note

  const choose = (label: string, g: number) => {
    setUnit([label, g])
    setCount(1)
    setGrams(Math.round(g))
    setBasis('counted')
  }

  return (
    <div className="flex flex-col gap-4" data-testid="food-amount">
      <div className="flex items-start gap-2">
        <button type="button" onClick={onBack} className="pressable grid size-11 shrink-0 place-items-center rounded-xl bg-surface-2" aria-label="חזרה לתוצאות">
          <ArrowRight className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-ink-3">
            <TrustBadge verification={cur?.verification ?? food.verification} origin={cur?.source ?? food.source} />
            <span>
              {fmt(per100.kcal)} {KCAL} ל-100 ג׳
            </span>
            {STATE_LABEL_HE[food.state] && <span>· {STATE_LABEL_HE[food.state]}</span>}
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-ink-3">כמה?</p>
        <div className="flex flex-wrap gap-2">
          {servings.slice(0, 6).map(([label, g]) => (
            <button
              key={`${label}${g}`}
              type="button"
              aria-pressed={unit?.[0] === label && unit[1] === g}
              onClick={() => choose(label, g)}
              className={`pressable min-h-10 rounded-full px-3 text-sm ${unit?.[0] === label && unit[1] === g ? 'bg-ink text-inverse' : 'bg-surface-2'}`}
            >
              {label} · <span className="num">{fmt(g)}</span> ג׳
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          {unit && (
            <label className="flex items-center gap-2 text-sm">
              <span>כמות</span>
              <input
                inputMode="decimal"
                className="num w-14 rounded-xl bg-surface-2 px-2 py-2 text-center font-semibold"
                value={count}
                aria-label="מספר יחידות"
                onChange={(e) => {
                  const c = Math.max(0, Number(e.target.value.replace(/[^\d.]/g, '')) || 0)
                  setCount(c)
                  setGrams(Math.round(c * unit[1]))
                }}
              />
              <span className="text-ink-3">×</span>
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              inputMode="numeric"
              className="num w-20 rounded-xl bg-surface-2 px-2 py-2 text-center text-lg font-semibold"
              value={grams}
              aria-label="גרמים"
              onChange={(e) => {
                setGrams(Math.max(0, Number(e.target.value.replace(/[^\d]/g, '')) || 0))
                setUnit(null)
                setBasis('stated')
              }}
            />
            <span>גרם</span>
          </label>
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-2 rounded-2xl bg-surface-2 p-3 text-center">
        {(
          [
            [KCAL, fmt(t.calories)],
            ['חלבון', `${t.protein_g}`],
            ['שומן', `${t.fat_g}`],
            ['פחמ׳', `${t.carbs_g}`],
          ] as const
        ).map(([l, v]) => (
          <div key={l}>
            <dt className="text-xs text-ink-3">{l}</dt>
            <dd className="num text-lg font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-2 text-xs leading-relaxed text-ink-3">
        סיבים {extra(per100.fiber_g ?? food.fiber_g, 'ג׳')} · סוכר {extra(per100.sugar_g ?? food.sugar_g, 'ג׳')} · שומן רווי {extra(per100.sat_fat_g ?? food.sat_fat_g, 'ג׳')} · נתרן{' '}
        {extra(per100.sodium_mg ?? food.sodium_mg, 'מ״ג')}
        {note && <span className="block text-warn">{note}</span>}
        {food.source === 'off' && <span className="block">מקור: Open Food Facts (ODbL) — ערכים שהוזנו מתווית המוצר, לא נבדקו.</span>}
      </p>

      <PrimaryButton onClick={() => grams > 0 && onPick(grams, basis)} disabled={grams <= 0}>
        {pickLabel} · {fmt(t.calories)} {KCAL}
      </PrimaryButton>
    </div>
  )
}
