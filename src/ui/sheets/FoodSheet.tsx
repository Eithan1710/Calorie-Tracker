import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, RotateCcw, Trash2, WifiOff } from 'lucide-react'
import { Sheet, PrimaryButton, GhostButton } from '../primitives'
import { Review } from './Review'
import { analyzePhoto, analyzeText } from '../../services/ai'
import { prepareImage } from '../../services/image'
import { deleteFood, getState, recentMeals, restoreFood, upsertFood, useStore } from '../../data/store'
import { MEALS, mealForTime, type Analysis, type FoodEntry, type Meal } from '../../data/types'
import { newId } from '../../../supabase/functions/_shared/nutrition.ts'
import { showToast } from '../toast'
import { fmt, haptic, KCAL } from '../format'

type Phase = 'input' | 'analyzing' | 'review' | 'error'

function entryFromAnalysis(a: Analysis, date: string, meal: Meal, rawText: string, base?: FoodEntry): FoodEntry {
  const now = new Date().toISOString()
  return {
    id: base?.id ?? newId(),
    date,
    meal,
    title: a.title,
    emoji: a.emoji,
    items: a.items,
    totals: a.totals,
    confidence: a.overall_confidence,
    provider: a.provider,
    raw_text: rawText || base?.raw_text,
    status: 'ok',
    created_at: base?.created_at ?? now,
    updated_at: now,
  }
}

function analysisFromEntry(e: FoodEntry): Analysis {
  return { title: e.title, emoji: e.emoji, items: e.items, totals: e.totals, overall_confidence: e.confidence, clarification: null, provider: e.provider }
}

export function MealPicker({ value, onChange }: { value: Meal; onChange: (m: Meal) => void }) {
  return (
    <div role="radiogroup" aria-label="ארוחה" className="grid grid-cols-4 gap-1.5">
      {MEALS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          onClick={() => onChange(m.id)}
          className={`pressable min-h-11 rounded-full px-1 text-[15px] font-medium whitespace-nowrap transition-colors ${value === m.id ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2'}`}
        >
          <span aria-hidden>{m.emoji}</span> {m.label}
        </button>
      ))}
    </div>
  )
}

export function AddFoodSheet({ open, onClose, date, initialPhoto }: { open: boolean; onClose: () => void; date: string; initialPhoto: File | null }) {
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [meal, setMeal] = useState<Meal>(mealForTime())
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [error, setError] = useState<{ message: string; canQueue?: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const foodMap = useStore((s) => s.food)
  const recents = useMemo(() => recentMeals({ ...getState(), food: foodMap }, 6), [foodMap])
  const lastRequest = useRef<() => void>(() => {})

  // reset each time the sheet opens
  useEffect(() => {
    if (!open) return
    setPhase('input')
    setText('')
    setMeal(mealForTime())
    setAnalysis(null)
    setPhoto(null)
    setError(null)
    if (initialPhoto) void runPhoto(initialPhoto)
    else setTimeout(() => textRef.current?.focus(), 320)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPhoto])

  async function runText() {
    const t = text.trim()
    if (!t) return
    lastRequest.current = runText
    setPhase('analyzing')
    setError(null)
    const res = await analyzeText(t)
    if (res.ok) {
      setAnalysis(res.analysis)
      setPhase('review')
      haptic()
    } else {
      setError({ message: res.message, canQueue: res.canQueue })
      setPhase('error')
    }
  }

  async function runPhoto(file: File) {
    lastRequest.current = () => void runPhoto(file)
    setPhase('analyzing')
    setError(null)
    try {
      const img = await prepareImage(file)
      setPhoto(img.previewUrl)
      const res = await analyzePhoto({ data: img.data, mimeType: img.mimeType }, text.trim())
      if (res.ok) {
        setAnalysis(res.analysis)
        setPhase('review')
        haptic()
      } else {
        setError({ message: res.message })
        setPhase('error')
      }
    } catch {
      setError({ message: 'לא הצלחתי לקרוא את התמונה. אפשר לנסות שוב או לכתוב מה אכלת.' })
      setPhase('error')
    }
  }

  function confirm() {
    if (!analysis || !analysis.items.length) return
    const entry = entryFromAnalysis(analysis, date, meal, text.trim())
    upsertFood(entry)
    haptic(18)
    onClose()
    showToast(`נוסף · ${fmt(entry.totals.calories)} ${KCAL}`, { label: 'ביטול', run: () => deleteFood(entry.id) })
  }

  function saveForLater() {
    const now = new Date().toISOString()
    const entry: FoodEntry = {
      id: newId(),
      date,
      meal,
      title: text.trim().slice(0, 60),
      emoji: '⏳',
      items: [],
      totals: { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 },
      confidence: 0,
      provider: 'pending',
      raw_text: text.trim(),
      status: 'pending',
      created_at: now,
      updated_at: now,
    }
    upsertFood(entry)
    onClose()
    showToast('נשמר — ננתח כשיחזור החיבור')
  }

  function quickAdd(src: FoodEntry) {
    const now = new Date().toISOString()
    const entry: FoodEntry = { ...src, id: newId(), date, meal, created_at: now, updated_at: now, items: src.items.map((i) => ({ ...i, id: newId() })), dirty: true, deleted: false }
    upsertFood(entry)
    haptic(18)
    onClose()
    showToast(`${entry.title} · ${fmt(entry.totals.calories)} ${KCAL}`, { label: 'ביטול', run: () => deleteFood(entry.id) })
  }

  const footer =
    phase === 'review' ? (
      <div className="flex gap-2">
        <PrimaryButton className="flex-1" onClick={confirm} disabled={!analysis?.items.length}>
          אישור
        </PrimaryButton>
        <GhostButton
          onClick={() => {
            setPhase('input')
            setAnalysis(null)
          }}
          aria-label="התחל מחדש"
        >
          <RotateCcw className="size-5" />
        </GhostButton>
      </div>
    ) : phase === 'input' ? (
      <div className="flex gap-2">
        <GhostButton onClick={() => fileRef.current?.click()} aria-label="צלם אוכל" className="min-h-14 px-4">
          <Camera className="size-6" />
        </GhostButton>
        <PrimaryButton className="flex-1" onClick={() => void runText()} disabled={!text.trim()}>
          חשב
        </PrimaryButton>
      </div>
    ) : null

  return (
    <Sheet open={open} onClose={onClose} title={phase === 'review' ? 'זה נראה נכון?' : 'מה אכלת?'} footer={footer}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void runPhoto(f)
        }}
      />
      <div className="flex flex-col gap-4 pt-1">
        <MealPicker value={meal} onChange={setMeal} />

        {phase === 'input' && (
          <>
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void runText()
                }
              }}
              rows={3}
              aria-label="תיאור האוכל"
              placeholder="למשל: 3 ביצים, 2 פרוסות לחם, קוטג׳ וסלט"
              className="min-h-28 w-full resize-none rounded-3xl bg-surface-2 p-4 text-lg leading-relaxed outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-info"
              enterKeyHint="go"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="pressable flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line font-medium text-ink-2"
            >
              <ImagePlus className="size-5" aria-hidden /> צלם את האוכל
            </button>
            {recents.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium text-ink-3">שוב אותו דבר? נגיעה אחת</p>
                <div className="flex flex-wrap gap-2">
                  {recents.map((r) => (
                    <button key={r.id} type="button" onClick={() => quickAdd(r)} className="pressable flex min-h-11 max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[15px]">
                      <span aria-hidden>{r.emoji}</span>
                      <span className="truncate">{r.title}</span>
                      <span className="num shrink-0 text-ink-3">{fmt(r.totals.calories)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {phase === 'analyzing' && (
          <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
            {photo && <img src={photo} alt="התמונה שצילמת" className="max-h-56 w-full rounded-3xl object-cover" />}
            {!photo && text && <p className="rounded-3xl bg-surface-2 p-4 text-lg text-ink-2">{text}</p>}
            <div className="flex items-center gap-2 text-ink-2">
              <Loader2 className="size-5 animate-spin" aria-hidden />
              <span>{photo ? 'מזהה מה בצלחת…' : 'מחשב…'}</span>
            </div>
            <div className="skeleton h-24" />
            <div className="skeleton h-10" />
            <div className="skeleton h-10 w-3/4" />
          </div>
        )}

        {phase === 'review' && analysis && (
          <>
            {photo && <img src={photo} alt="" className="max-h-40 w-full rounded-3xl object-cover" />}
            <Review analysis={analysis} onChange={setAnalysis} originalText={text} />
          </>
        )}

        {phase === 'error' && error && (
          <div className="flex flex-col gap-3 py-2" role="alert">
            {photo && <img src={photo} alt="" className="max-h-40 w-full rounded-3xl object-cover opacity-70" />}
            <div className="flex items-start gap-3 rounded-3xl bg-warn-soft p-4">
              {error.canQueue ? <WifiOff className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden /> : <span aria-hidden>🤔</span>}
              <p className="text-[15px] leading-relaxed">{error.message}</p>
            </div>
            <div className="flex gap-2">
              <GhostButton className="flex-1" onClick={() => setPhase('input')}>
                לערוך את התיאור
              </GhostButton>
              <GhostButton className="flex-1" onClick={() => lastRequest.current()}>
                לנסות שוב
              </GhostButton>
            </div>
            {error.canQueue && text.trim() && <PrimaryButton onClick={saveForLater}>לשמור ולנתח אחר כך</PrimaryButton>}
          </div>
        )}
      </div>
    </Sheet>
  )
}

export function EntrySheet({ entryId, onClose }: { entryId: string | null; onClose: () => void }) {
  const entry = useStore((s) => (entryId ? s.food[entryId] : undefined))
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [meal, setMeal] = useState<Meal>('lunch')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (entry) {
      setAnalysis(entry.status === 'ok' ? analysisFromEntry(entry) : null)
      setMeal(entry.meal)
      setError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId])

  if (!entry) return <Sheet open={false} onClose={onClose}>{null}</Sheet>

  const save = () => {
    if (!analysis) return
    if (!analysis.items.length) return remove()
    upsertFood(entryFromAnalysis(analysis, entry.date, meal, '', entry))
    haptic()
    onClose()
  }
  const remove = () => {
    deleteFood(entry.id)
    onClose()
    showToast('נמחק', { label: 'ביטול', run: () => restoreFood(entry.id) })
  }
  const analyzeNow = async () => {
    setBusy(true)
    setError(null)
    const res = await analyzeText(entry.raw_text ?? entry.title)
    setBusy(false)
    if (res.ok) setAnalysis(res.analysis)
    else setError(res.message)
  }

  return (
    <Sheet
      open={Boolean(entryId)}
      onClose={onClose}
      title={entry.status === 'pending' && !analysis ? 'ממתין לניתוח' : 'עריכה'}
      footer={
        <div className="flex gap-2">
          {analysis && (
            <PrimaryButton className="flex-1" onClick={save}>
              שמירה
            </PrimaryButton>
          )}
          <GhostButton onClick={remove} aria-label="מחיקה" className={analysis ? 'min-h-14 px-4 text-surplus' : 'min-h-14 flex-1 text-surplus'}>
            <Trash2 className="size-5" /> {!analysis && 'מחיקה'}
          </GhostButton>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <MealPicker value={meal} onChange={setMeal} />
        {analysis ? (
          <Review analysis={analysis} onChange={setAnalysis} originalText={entry.raw_text} />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="rounded-3xl bg-surface-2 p-4 text-lg">{entry.raw_text}</p>
            {error && <p className="text-sm text-surplus" role="alert">{error}</p>}
            <PrimaryButton onClick={() => void analyzeNow()} disabled={busy}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : null} נתח עכשיו
            </PrimaryButton>
          </div>
        )}
      </div>
    </Sheet>
  )
}
