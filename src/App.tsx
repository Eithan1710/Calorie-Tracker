import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Home, LineChart, Plus } from 'lucide-react'
import { getState, upsertFood, useStore } from './data/store'
import { isValidProfile } from './domain/energy'
import { toDateKey } from './domain/goal'
import { Today } from './ui/screens/Today'
import { Onboarding } from './ui/screens/Onboarding'
import { Login } from './ui/screens/Login'
import { LegacyImportSheet } from './ui/sheets/LegacyImportSheet'
import { useAuth } from './services/auth'
import { useProfileChecked } from './services/sync'
import { AddFoodSheet, EntrySheet } from './ui/sheets/FoodSheet'
import { ExerciseSheet } from './ui/sheets/ExerciseSheet'
import { StepsSheet } from './ui/sheets/StepsSheet'
import { SettingsSheet } from './ui/sheets/SettingsSheet'
import { Toaster, showToast } from './ui/toast'
import { analyzeText } from './services/ai'
import { ingestFromUrl } from './services/health'
import { scheduleLocalReminder, shouldShowInAppReminder } from './services/notifications'
import { fmt } from './ui/format'

const History = lazy(() => import('./ui/screens/History').then((m) => ({ default: m.History })))

type Tab = 'today' | 'history'
type SheetName = 'add' | 'exercise' | 'steps' | 'settings' | null

/** Analyze entries that were saved while offline. */
async function processPending() {
  if (!navigator.onLine) return
  const pending = Object.values(getState().food).filter((f) => f.status === 'pending' && !f.deleted)
  for (const p of pending) {
    const res = await analyzeText(p.raw_text ?? p.title)
    if (res.ok && !res.offline) {
      const a = res.analysis
      upsertFood({ ...p, title: a.title, emoji: a.emoji, items: a.items, totals: a.totals, confidence: a.overall_confidence, provider: a.provider, status: 'ok' })
      showToast(`נותח: ${a.title} · ${fmt(a.totals.calories)} קק״ל`)
    }
  }
}

export default function App() {
  const auth = useAuth()
  const ready = useStore((s) => s.ready)
  const userId = useStore((s) => s.userId)
  const profile = useStore((s) => s.settings.profile)
  const profileChecked = useProfileChecked(userId)
  const [tab, setTab] = useState<Tab>('today')
  const [date, setDate] = useState(() => toDateKey(new Date()))
  const [sheet, setSheet] = useState<SheetName>(null)
  const [entryId, setEntryId] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [reminder, setReminder] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)

  // follow midnight: if the app stays open across days, "today" moves on
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      setReminder(shouldShowInAppReminder())
      scheduleLocalReminder()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (!ready) return
    const imported = ingestFromUrl()
    if (imported) showToast(`עודכנו ${fmt(imported.steps)} צעדים`)
    const params = new URLSearchParams(window.location.search)
    if (params.get('add') === '1') {
      setSheet('add')
      window.history.replaceState(null, '', window.location.pathname)
    }
    setReminder(shouldShowInAppReminder())
    scheduleLocalReminder()
    void processPending()
    const onOnline = () => void processPending()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [ready])

  const food = useStore((s) => s.food)
  useEffect(() => {
    if (ready) setReminder(shouldShowInAppReminder())
  }, [food, ready])

  const openAdd = useCallback(() => {
    setPhoto(null)
    setSheet('add')
  }, [])
  const closeSheet = useCallback(() => setSheet(null), [])

  if (auth.status === 'unconfigured')
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-ink-2">
        <p>האפליקציה לא מחוברת לשרת. אין גישה בלי חשבון.</p>
      </main>
    )
  if (auth.status === 'signedOut') return <Login />
  if (auth.status === 'loading' || !ready) return <div className="min-h-dvh bg-bg" aria-busy="true" />
  if (!isValidProfile(profile)) {
    // signed in on a new device: wait for the profile from the server before asking for it
    if (!profileChecked) return <div className="min-h-dvh bg-bg" aria-busy="true" aria-label="טוען את החשבון" />
    return (
      <>
        <Onboarding />
        <LegacyImportSheet />
      </>
    )
  }

  return (
    <>
      <main>
        {tab === 'today' ? (
          <Today
            date={date}
            reminder={reminder}
            actions={{
              onAddFood: openAdd,
              onOpenEntry: setEntryId,
              onExercise: () => setSheet('exercise'),
              onSteps: () => setSheet('steps'),
              onSettings: () => setSheet('settings'),
              onDate: setDate,
            }}
          />
        ) : (
          <Suspense fallback={<div className="min-h-dvh" />}>
            <History
              onOpenDay={(d) => {
                setDate(d)
                setTab('today')
                window.scrollTo({ top: 0 })
              }}
            />
          </Suspense>
        )}
      </main>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        /* the dock camera button opens the camera directly; the gallery stays available via "הוסף תמונה" in the food sheet */
        capture="environment"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        data-testid="dock-photo-input"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) {
            setPhoto(f)
            setSheet('add')
          }
        }}
      />

      <nav aria-label="ניווט ראשי" className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pt-6" style={{ background: 'linear-gradient(to top, var(--bg) 55%, transparent)' }}>
        <div className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-[26px] border border-line bg-surface/90 p-2 shadow-[var(--shadow-2)] backdrop-blur-xl">
          <DockTab active={tab === 'today'} label="היום" onClick={() => { setTab('today'); setDate(toDateKey(new Date())) }}>
            <Home className="size-[22px]" />
          </DockTab>
          <button type="button" onClick={openAdd} className="pressable flex min-h-14 flex-1 items-center justify-center gap-2 rounded-[20px] bg-ink text-lg font-semibold text-inverse">
            <Plus className="size-6" strokeWidth={2.6} aria-hidden /> הוסף אוכל
          </button>
          <button type="button" onClick={() => cameraRef.current?.click()} className="pressable grid size-14 shrink-0 place-items-center rounded-[20px] bg-surface-2 text-ink" aria-label="צלם אוכל">
            <Camera className="size-6" />
          </button>
          <DockTab active={tab === 'history'} label="היסטוריה" onClick={() => setTab('history')}>
            <LineChart className="size-[22px]" />
          </DockTab>
        </div>
      </nav>

      <AddFoodSheet open={sheet === 'add'} onClose={closeSheet} date={date} initialPhoto={photo} />
      <EntrySheet entryId={entryId} onClose={() => setEntryId(null)} />
      <ExerciseSheet open={sheet === 'exercise'} onClose={closeSheet} date={date} />
      <StepsSheet open={sheet === 'steps'} onClose={closeSheet} date={date} />
      <SettingsSheet open={sheet === 'settings'} onClose={closeSheet} />
      <LegacyImportSheet />
      <Toaster />
    </>
  )
}

function DockTab({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`pressable grid size-14 shrink-0 place-items-center rounded-[20px] transition-colors ${active ? 'text-ink' : 'text-ink-3'}`}
    >
      {children}
    </button>
  )
}
