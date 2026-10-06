import { useState } from 'react'
import { ChevronDown, Loader2, Minus, Plus, Send, Sparkles, Trash2, MessageCircleQuestion } from 'lucide-react'
import type { Analysis, FoodItem } from '../../data/types'
import { totalsOf, overallConfidence, withGrams } from '../../../supabase/functions/_shared/nutrition.ts'
import { parseLocally } from '../../../supabase/functions/_shared/localParser.ts'
import { correctAnalysis } from '../../services/ai'
import { confidenceLabel, fmt, KCAL } from '../format'

export function recompute(a: Analysis, items: FoodItem[]): Analysis {
  return { ...a, items, totals: totalsOf(items), overall_confidence: overallConfidence(items) }
}

/**
 * Instant offline correction for the common case "זה היה 250 גרם אורז":
 * if every food in the correction already exists in the list and has an explicit
 * amount, just change the grams. Anything else goes to the AI.
 */
export function tryLocalCorrection(a: Analysis, text: string): Analysis | null {
  if (!/\d/.test(text)) return null
  if (/בלי|ללא|הוספתי|תוסיף|הוסף|גם|במקום|לא היה/.test(text)) return null
  const parsed = parseLocally(text)
  if (!parsed.analysis || parsed.unmatched.length) return null
  let items = [...a.items]
  for (const p of parsed.analysis.items) {
    const idx = items.findIndex((i) => i.db_key && i.db_key === p.db_key)
    if (idx < 0) return null
    items[idx] = { ...withGrams(items[idx], p.grams), assumptions: ['כמות לפי התיקון שלך'] }
  }
  items = items.map((i) => i)
  return { ...recompute(a, items), clarification: null }
}

const SOURCE_LABEL: Record<FoodItem['source'], string> = { db: 'מאגר', usda: 'USDA', ai: 'הערכה', manual: 'ידני' }

export function Review({
  analysis,
  onChange,
  originalText,
}: {
  analysis: Analysis
  onChange: (a: Analysis) => void
  originalText?: string
}) {
  const [correction, setCorrection] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showWhy, setShowWhy] = useState(false)
  const t = analysis.totals
  const conf = confidenceLabel(analysis.overall_confidence)
  const hasRange = t.calories_low !== undefined && t.calories_high !== undefined && t.calories_high - t.calories_low >= 20

  const setItem = (id: string, grams: number) => onChange(recompute(analysis, analysis.items.map((i) => (i.id === id ? withGrams(i, grams) : i))))
  const removeItem = (id: string) => onChange(recompute(analysis, analysis.items.filter((i) => i.id !== id)))

  async function submitCorrection(text: string) {
    const c = text.trim()
    if (!c || busy) return
    setError(null)
    const local = tryLocalCorrection(analysis, c)
    if (local) {
      onChange(local)
      setCorrection('')
      return
    }
    setBusy(true)
    const res = await correctAnalysis(analysis, c, originalText)
    setBusy(false)
    if (res.ok) {
      onChange(res.analysis)
      setCorrection('')
    } else {
      setError(res.message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="animate-rise rounded-3xl bg-surface-2 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-surface text-2xl" aria-hidden>
            {analysis.emoji}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{analysis.title}</p>
            <p className="flex items-baseline gap-1.5">
              <span className="text-[34px] leading-tight font-semibold tracking-tight" data-testid="analysis-total">
                <span className="text-ink-3">≈</span> {fmt(t.calories)}
              </span>
              <span className="text-ink-3">{KCAL}</span>
            </p>
            {hasRange && (
              <p className="text-sm text-ink-3">
                טווח סביר: <span className="ltr num">{fmt(t.calories_low!)}–{fmt(t.calories_high!)}</span>
              </p>
            )}
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              conf.tone === 'good' ? 'bg-good-soft text-good' : conf.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-surplus-soft text-surplus'
            }`}
          >
            {conf.text}
          </span>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ['חלבון', t.protein_g, 'var(--protein)'],
            ['שומן', t.fat_g, 'var(--fat)'],
            ['פחמימות', t.carbs_g, 'var(--carbs)'],
          ].map(([label, v, c]) => (
            <div key={label as string} className="rounded-2xl bg-surface px-2 py-2">
              <dt className="flex items-center justify-center gap-1 text-xs text-ink-3">
                <span className="size-1.5 rounded-full" style={{ background: c as string }} aria-hidden />
                {label as string}
              </dt>
              <dd className="text-lg font-semibold">{fmt(v as number)} ג׳</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-ink-3">
          {analysis.provider === 'local'
            ? 'חושב מהמאגר בלי AI, לפי הכמויות שכתבת. כדאי לבדוק את הגרמים.'
            : 'משוער — הכמות המדויקת תלויה בגודל המנה. אפשר לתקן כל פריט.'}
        </p>
      </div>

      {analysis.clarification && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-info-soft px-4 py-3">
          <MessageCircleQuestion className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
          <p className="text-[15px]">{analysis.clarification}</p>
        </div>
      )}

      <ul className="flex flex-col gap-1" aria-label="פריטים">
        {analysis.items.map((it) => (
          <ItemRow key={it.id} item={it} onGrams={(g) => setItem(it.id, g)} onRemove={() => removeItem(it.id)} />
        ))}
      </ul>

      <button type="button" onClick={() => setShowWhy((v) => !v)} className="flex min-h-10 items-center gap-1 self-start text-sm text-ink-3" aria-expanded={showWhy}>
        על מה זה מבוסס
        <ChevronDown className={`size-4 transition-transform ${showWhy ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {showWhy && (
        <ul className="-mt-2 flex flex-col gap-1.5 rounded-2xl bg-surface-2 p-3 text-sm text-ink-2">
          {analysis.items.map((it) => (
            <li key={it.id}>
              <span className="font-medium text-ink">{it.name}</span> · {fmt(it.per100.kcal)} {KCAL}/100ג׳ ({SOURCE_LABEL[it.source]})
              {it.assumptions.length > 0 && <span className="text-ink-3"> — {it.assumptions.join(' · ')}</span>}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submitCorrection(correction)
        }}
        className="flex items-center gap-2 rounded-2xl bg-surface-2 py-1.5 ps-4 pe-1.5 focus-within:ring-2 focus-within:ring-info"
      >
        <Sparkles className="size-4 shrink-0 text-ink-3" aria-hidden />
        <input
          value={correction}
          onChange={(e) => setCorrection(e.target.value)}
          placeholder={analysis.clarification ? 'התשובה שלך…' : 'תיקון? למשל: זה היה 250 גרם אורז'}
          aria-label="תיקון לניתוח"
          className="min-h-11 w-full min-w-0 bg-transparent outline-none placeholder:text-ink-3"
          enterKeyHint="send"
        />
        <button type="submit" disabled={!correction.trim() || busy} className="pressable grid size-11 shrink-0 place-items-center rounded-xl bg-ink text-inverse disabled:opacity-30" aria-label="שלח תיקון">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5 -scale-x-100" />}
        </button>
      </form>
      {error && <p className="-mt-2 text-sm text-surplus" role="alert">{error}</p>}
    </div>
  )
}

function ItemRow({ item, onGrams, onRemove }: { item: FoodItem; onGrams: (g: number) => void; onRemove: () => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const step = item.grams >= 200 ? 25 : item.grams >= 60 ? 10 : 5
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 0 && n <= 5000) onGrams(n)
    setDraft(null)
  }
  return (
    <li className="flex items-center gap-2 rounded-2xl px-1 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {item.emoji && <span aria-hidden>{item.emoji} </span>}
          {item.name}
        </p>
        <p className="text-sm text-ink-3">
          <span className="num">{fmt(item.calories)}</span> {KCAL} · חלבון {fmt(item.protein_g)} ג׳
          {item.source === 'ai' && <span className="ms-1 rounded-md bg-warn-soft px-1.5 py-0.5 text-[11px] text-warn">הערכה</span>}
        </p>
      </div>
      <div className="flex shrink-0 items-center rounded-xl bg-surface-2">
        <button type="button" className="pressable grid size-10 place-items-center text-ink-2" aria-label={`פחות ${item.name}`} onClick={() => onGrams(Math.max(0, item.grams - step))}>
          <Minus className="size-4" />
        </button>
        <label className="flex items-baseline">
          <span className="sr-only">גרמים של {item.name}</span>
          <input
            inputMode="numeric"
            className="num w-12 bg-transparent text-center font-semibold outline-none"
            value={draft ?? String(item.grams)}
            onFocus={(e) => {
              setDraft(String(item.grams))
              e.target.select()
            }}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="text-xs text-ink-3">ג׳</span>
        </label>
        <button type="button" className="pressable grid size-10 place-items-center text-ink-2" aria-label={`יותר ${item.name}`} onClick={() => onGrams(item.grams + step)}>
          <Plus className="size-4" />
        </button>
      </div>
      <button type="button" onClick={onRemove} className="pressable grid size-10 shrink-0 place-items-center rounded-xl text-ink-3 hover:bg-surface-2 hover:text-surplus" aria-label={`הסר ${item.name}`}>
        <Trash2 className="size-4" />
      </button>
    </li>
  )
}
