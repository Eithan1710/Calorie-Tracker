import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, Loader2, RotateCcw, Trash2, WifiOff, X } from 'lucide-react'
import { Sheet, PrimaryButton, GhostButton } from '../primitives'
import { Review } from './Review'
import { analyzePhoto, analyzeText } from '../../services/ai'
import { imageErrorMessage, prepareImage, type PreparedImage } from '../../services/image'
import { deletePhoto, newPhotoPath, photoUnavailable, savePhoto, usePhotoUrl } from '../../services/photos'
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
    photo_path: base?.photo_path,
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

/**
 * Opens the device's picker for an image. No `capture` attribute on purpose:
 * on iPhone that would force the camera; without it iOS offers the photo
 * library, the camera and Files, and desktops open the file chooser.
 */
export function PhotoInput({ inputRef, onFile, testId }: { inputRef: React.RefObject<HTMLInputElement | null>; onFile: (f: File) => void; testId?: string }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      className="hidden"
      tabIndex={-1}
      aria-hidden
      data-testid={testId}
      onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) onFile(f)
      }}
    />
  )
}

/** Preview of the photo attached to a meal, with a remove button. */
function AttachedPhoto({ src, onRemove, busy = false, compact = false }: { src: string; onRemove?: () => void; busy?: boolean; compact?: boolean }) {
  return (
    <div className="relative">
      <img src={src} alt="התמונה של הארוחה" className={`w-full rounded-3xl bg-surface-2 object-cover ${compact ? 'max-h-40' : 'max-h-56'} ${busy ? 'opacity-70' : ''}`} />
      {onRemove && (
        <button type="button" onClick={onRemove} className="pressable absolute top-2 start-2 grid size-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur" aria-label="הסר תמונה">
          <X className="size-5" />
        </button>
      )}
    </div>
  )
}

export function AddFoodSheet({ open, onClose, date, initialPhoto }: { open: boolean; onClose: () => void; date: string; initialPhoto: File | null }) {
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [meal, setMeal] = useState<Meal>(mealForTime())
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  /** the photo attached to this meal (compressed, not saved yet) */
  const [photo, setPhoto] = useState<PreparedImage | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
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
    if (initialPhoto) void attachAndAnalyze(initialPhoto)
    else setTimeout(() => textRef.current?.focus(), 320)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPhoto])

  async function loadPhoto(file: File): Promise<PreparedImage | null> {
    setPhotoBusy(true)
    try {
      const img = await prepareImage(file)
      setPhoto(img)
      return img
    } catch {
      return null
    } finally {
      setPhotoBusy(false)
    }
  }

  /** From the dock: photo → straight to analysis (the original quick flow). */
  async function attachAndAnalyze(file: File) {
    setPhase('analyzing')
    const img = await loadPhoto(file)
    if (img) await runPhoto(img, '')
    else {
      setError({ message: imageErrorMessage(file) })
      setPhase('error')
    }
  }

  /** Inside the sheet: attach (and preview); analysis runs on "חשב". In review it's only attached. */
  async function onPickPhoto(file: File) {
    const img = await loadPhoto(file)
    if (!img) showToast(imageErrorMessage(file))
    else if (phase === 'error') setPhase('input')
  }

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

  async function runPhoto(img: PreparedImage, note: string) {
    lastRequest.current = () => void runPhoto(img, note)
    setPhase('analyzing')
    setError(null)
    const res = await analyzePhoto({ data: img.data, mimeType: img.mimeType }, note)
    if (res.ok) {
      setAnalysis(res.analysis)
      setPhase('review')
      haptic()
      return
    }
    // a description was typed too → the text engine can still do the job; the photo stays attached
    if (note) {
      const t = await analyzeText(note)
      if (t.ok) {
        setAnalysis(t.analysis)
        setPhase('review')
        haptic()
        return
      }
    }
    setError({ message: res.message })
    setPhase('error')
  }

  function calculate() {
    if (photo) void runPhoto(photo, text.trim())
    else void runText()
  }

  /** Persist the attached photo for an entry; returns its path. */
  async function storePhoto(entryId: string): Promise<string | undefined> {
    if (!photo) return undefined
    const path = newPhotoPath(entryId)
    await savePhoto(path, photo.blob)
    return path
  }

  async function confirm() {
    if (!analysis || !analysis.items.length) return
    const entry = entryFromAnalysis(analysis, date, meal, text.trim())
    entry.photo_path = await storePhoto(entry.id)
    upsertFood(entry)
    haptic(18)
    onClose()
    showToast(`נוסף · ${fmt(entry.totals.calories)} ${KCAL}`, {
      label: 'ביטול',
      run: () => {
        deleteFood(entry.id)
      },
    })
  }

  async function saveForLater() {
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
    entry.photo_path = await storePhoto(entry.id)
    upsertFood(entry)
    onClose()
    showToast('נשמר — ננתח כשיחזור החיבור')
  }

  function quickAdd(src: FoodEntry) {
    const now = new Date().toISOString()
    const entry: FoodEntry = { ...src, id: newId(), date, meal, created_at: now, updated_at: now, items: src.items.map((i) => ({ ...i, id: newId() })), photo_path: undefined, dirty: true, deleted: false }
    upsertFood(entry)
    haptic(18)
    onClose()
    showToast(`${entry.title} · ${fmt(entry.totals.calories)} ${KCAL}`, { label: 'ביטול', run: () => deleteFood(entry.id) })
  }

  const canCalculate = Boolean(text.trim() || photo) && !photoBusy

  const footer =
    phase === 'review' ? (
      <div className="flex gap-2">
        <PrimaryButton className="flex-1" onClick={() => void confirm()} disabled={!analysis?.items.length}>
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
        <GhostButton onClick={() => fileRef.current?.click()} aria-label="הוסף תמונה" className="min-h-14 px-4">
          <ImagePlus className="size-6" />
        </GhostButton>
        <PrimaryButton className="flex-1" onClick={calculate} disabled={!canCalculate}>
          {photo && !text.trim() ? 'נתח את התמונה' : 'חשב'}
        </PrimaryButton>
      </div>
    ) : null

  return (
    <Sheet open={open} onClose={onClose} title={phase === 'review' ? 'זה נראה נכון?' : 'מה אכלת?'} footer={footer}>
      <PhotoInput inputRef={fileRef} onFile={(f) => void onPickPhoto(f)} testId="food-photo-input" />
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
                  if (canCalculate) calculate()
                }
              }}
              rows={3}
              aria-label="תיאור האוכל"
              placeholder={photo ? 'אפשר להוסיף פירוט (לא חובה), למשל: 200 גרם אורז' : 'למשל: 3 ביצים, 2 פרוסות לחם, קוטג׳ וסלט'}
              className="min-h-28 w-full resize-none rounded-3xl bg-surface-2 p-4 text-lg leading-relaxed outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-info"
              enterKeyHint="go"
            />
            {photo ? (
              <AttachedPhoto src={photo.previewUrl} onRemove={() => setPhoto(null)} />
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photoBusy}
                className="pressable flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line font-medium text-ink-2"
              >
                {photoBusy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />} הוסף תמונה
                <span className="font-normal text-ink-3">· מהגלריה או מצלמה</span>
              </button>
            )}
            {recents.length > 0 && !photo && (
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
            {photo && <AttachedPhoto src={photo.previewUrl} busy />}
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
            {photo ? (
              <AttachedPhoto src={photo.previewUrl} onRemove={() => setPhoto(null)} compact />
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="pressable flex min-h-11 items-center justify-center gap-2 self-start rounded-xl px-3 text-sm font-medium text-ink-2" disabled={photoBusy}>
                <ImagePlus className="size-4" aria-hidden /> צרף תמונה לארוחה
              </button>
            )}
            <Review analysis={analysis} onChange={setAnalysis} originalText={text} />
          </>
        )}

        {phase === 'error' && error && (
          <div className="flex flex-col gap-3 py-2" role="alert">
            {photo && <AttachedPhoto src={photo.previewUrl} busy onRemove={() => setPhoto(null)} compact />}
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
            {error.canQueue && text.trim() && <PrimaryButton onClick={() => void saveForLater()}>לשמור ולנתח אחר כך</PrimaryButton>}
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
        <EntryPhotoEditor entry={entry} />
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

/**
 * Photo of a saved entry: view, add, replace or remove. Changes apply right
 * away (the entry keeps its id, so the photo stays attached across devices,
 * refreshes and logins).
 */
function EntryPhotoEditor({ entry }: { entry: FoodEntry }) {
  const url = usePhotoUrl(entry.photo_path)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function replace(file: File) {
    setBusy(true)
    try {
      const img = await prepareImage(file)
      const path = newPhotoPath(entry.id)
      await savePhoto(path, img.blob)
      const old = entry.photo_path
      const cur = getState().food[entry.id] ?? entry
      upsertFood({ ...cur, photo_path: path })
      if (old) void deletePhoto(old)
      haptic()
    } catch {
      showToast(imageErrorMessage(file))
    } finally {
      setBusy(false)
    }
  }

  function remove() {
    const old = entry.photo_path
    const cur = getState().food[entry.id] ?? entry
    upsertFood({ ...cur, photo_path: undefined })
    void deletePhoto(old)
  }

  return (
    <>
      <PhotoInput inputRef={fileRef} onFile={(f) => void replace(f)} testId="entry-photo-input" />
      {entry.photo_path ? (
        <div className="flex flex-col gap-2">
          {url ? (
            <AttachedPhoto src={url} onRemove={remove} compact busy={busy} />
          ) : photoUnavailable(entry.photo_path) ? (
            <p className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-3">התמונה עוד לא זמינה כאן — היא תופיע אחרי שתסונכרן מהמכשיר שבו צולמה.</p>
          ) : (
            <div className="skeleton h-40" aria-label="טוען תמונה" />
          )}
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="pressable flex min-h-11 items-center justify-center gap-2 self-start rounded-xl px-3 text-sm font-medium text-ink-2">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />} החלף תמונה
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="pressable flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line font-medium text-ink-2">
          {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />} הוסף תמונה
        </button>
      )}
    </>
  )
}
