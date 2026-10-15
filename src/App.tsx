import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Camera, Home, LineChart, Plus } from 'lucide-react'
import { getState, upsertFood, useStore } from './data/store'
import { isValidProfile } from './domain/energy'
import { toDateKey } from './domain/goal'
import { Today } from './ui/screens/Today'
import { useAuth } from './services/auth'
import { useProfileChecked } from './services/sync'
import { AddFoodSheet, preloadFoodScreens } from './ui/sheets/FoodSheet'
import { Toaster, showToast } from './ui/toast'
import { Segmented } from './ui/primitives'
import { analyzeText, preloadOffline } from './services/ai'
import { ingestFromUrl } from './services/health'
import { scheduleLocalReminder, shouldShowInAppReminder } from './services/notifications'
import { markReady } from './services/perf'
import { fmt } from './ui/format'

// Everything that is not "open the app → photograph / type a meal" loads on demand,
// so the first screen and the upload buttons are ready as early as possible.
const History = lazy(() => import('./ui/screens/History').then((m) => ({ default: m.History })))
const Weight = lazy(() => import('./ui/screens/Weight').then((m) => ({ default: m.Weight })))
const Login = lazy(() => import('./ui/screens/Login').then((m) => ({ default: m.Login })))
const Onboarding = lazy(() => import('./ui/screens/Onboarding').then((m) => ({ default: m.Onboarding })))
const LegacyImportSheet = lazy(() => import('./ui/sheets/LegacyImportSheet').then((m) => ({ default: m.LegacyImportSheet })))
const EntrySheet = lazy(() => import('./ui/sheets/FoodSheet').then((m) => ({ default: m.EntrySheet })))
const ExerciseSheet = lazy(() => import('./ui/sheets/ExerciseSheet').then((m) => ({ default: m.ExerciseSheet })))
const StepsSheet = lazy(() => import('./ui/sheets/StepsSheet').then((m) => ({ default: m.StepsSheet })))
const SettingsSheet = lazy(() => import('./ui/sheets/SettingsSheet').then((m) => ({ default: m.SettingsSheet })))

type Tab = 'today' | 'history'
type HistoryView = 'log' | 'weight'
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

/** true once the browser is idle after the first paint (or after 2.5 s at the latest) */
function useIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(() => setIdle(true), { timeout: 2500 })
    else setTimeout(() => setIdle(true), 1200)
  }, [])
  return idle
}

/** Mount a lazily loaded sheet once it was needed (kept mounted for its close animation). */
function Later({ when, children }: { when: boolean; children: ReactNode }) {
  const [seen, setSeen] = useState(when)
  useEffect(() => {
    if (when) setSeen(true)
  }, [when])
  return seen ? <Suspense fallback={null}>{children}</Suspense> : null
}

/** same shapes as the skeleton in index.html, so loading never flashes blank */
const Splash = ({ label }: { label?: string }) => (
  <div className="safe-top mx-auto min-h-dvh max-w-xl px-4" aria-busy="true" aria-label={label ?? 'טוען'}>
    <div className="skeleton mt-2 mb-[18px] h-[34px] w-2/5 rounded-[22px]" />
    <div className="skeleton h-[150px] rounded-[22px]" />
    <div className="skeleton mt-3 h-[180px] rounded-[22px]" />
  </div>
)

export default function App() {
  const auth = useAuth()
  const ready = useStore((s) => s.ready)
  const userId = useStore((s) => s.userId)
  const profile = useStore((s) => s.settings.profile)
  const profileChecked = useProfileChecked(userId)
  const [tab, setTab] = useState<Tab>('today')
  const [historyView, setHistoryView] = useState<HistoryView>('log')
  const [date, setDate] = useState(() => toDateKey(new Date()))
  const [sheet, setSheet] = useState<SheetName>(null)
  const [entryId, setEntryId] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  /** a fresh add sheet per opening: never a frame of the previous meal's result */
  const [addKey, setAddKey] = useState(0)
  const [reminder, setReminder] = useState(false)
  const idle = useIdle()

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
      setAddKey((k) => k + 1)
      setSheet('add')
      window.history.replaceState(null, '', window.location.pathname)
    }
    setReminder(shouldShowInAppReminder())
    scheduleLocalReminder()
    // not urgent: after the first screen is up
    const t = setTimeout(() => void processPending(), 1500)
    const onOnline = () => void processPending()
    window.addEventListener('online', onOnline)
    return () => {
      clearTimeout(t)
      window.removeEventListener('online', onOnline)
    }
  }, [ready])

  const food = useStore((s) => s.food)
  useEffect(() => {
    if (ready) setReminder(shouldShowInAppReminder())
  }, [food, ready])

  const openAdd = useCallback(() => {
    setPhoto(null)
    setAddKey((k) => k + 1)
    setSheet('add')
  }, [])
  const onPhoto = useCallback((f: File) => {
    setPhoto(f)
    setAddKey((k) => k + 1)
    setSheet('add')
  }, [])
  const closeSheet = useCallback(() => setSheet(null), [])
  const goToday = useCallback(() => {
    setTab('today')
    setDate(toDateKey(new Date()))
    window.scrollTo({ top: 0 })
  }, [])
  const goHistory = useCallback(() => {
    setTab('history')
    window.scrollTo({ top: 0 })
  }, [])

  if (auth.status === 'unconfigured')
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center text-ink-2">
        <p>האפליקציה לא מחוברת לשרת. אין גישה בלי חשבון.</p>
      </main>
    )
  if (auth.status === 'signedOut')
    return (
      <Suspense fallback={<Splash />}>
        <Login />
      </Suspense>
    )
  if (auth.status === 'loading' || !ready) return <Splash />
  if (!isValidProfile(profile)) {
    // signed in on a new device: wait for the profile from the server before asking for it
    if (!profileChecked) return <Splash label="טוען את החשבון" />
    return (
      <Suspense fallback={<Splash />}>
        <Onboarding />
        <LegacyImportSheet />
      </Suspense>
    )
  }

  const switcher = (
    <Segmented<HistoryView>
      label="תצוגה"
      value={historyView}
      onChange={(v) => {
        setHistoryView(v)
        window.scrollTo({ top: 0 })
      }}
      options={[
        { value: 'log', label: 'יומן' },
        { value: 'weight', label: 'משקל' },
      ]}
    />
  )

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
          <Suspense fallback={<Splash />}>
            {historyView === 'weight' ? (
              <Weight switcher={switcher} />
            ) : (
              <History
                switcher={switcher}
                onOpenDay={(d) => {
                  setDate(d)
                  setTab('today')
                  window.scrollTo({ top: 0 })
                }}
              />
            )}
          </Suspense>
        )}
      </main>

      <Dock tab={tab} onToday={goToday} onHistory={goHistory} onAdd={openAdd} onPhoto={onPhoto} />
      <ReadyMark />

      <AddFoodSheet key={addKey} open={sheet === 'add'} onClose={closeSheet} date={date} initialPhoto={photo} />
      <Later when={entryId !== null || idle}>
        <EntrySheet entryId={entryId} onClose={() => setEntryId(null)} />
      </Later>
      <Later when={sheet === 'exercise' || idle}>
        <ExerciseSheet open={sheet === 'exercise'} onClose={closeSheet} date={date} />
      </Later>
      <Later when={sheet === 'steps' || idle}>
        <StepsSheet open={sheet === 'steps'} onClose={closeSheet} date={date} />
      </Later>
      <Later when={sheet === 'settings' || idle}>
        <SettingsSheet open={sheet === 'settings'} onClose={closeSheet} />
      </Later>
      <Later when={idle}>
        <LegacyImportSheet />
      </Later>
      <Toaster />
    </>
  )
}

/** Records "the upload buttons are usable" for the launch timing (Settings → מהירות). */
function ReadyMark() {
  useEffect(() => {
    requestAnimationFrame(() => {
      markReady()
      // right after the first paint: what offline logging needs
      setTimeout(() => void preloadOffline([preloadFoodScreens()]), 0)
    })
  }, [])
  return null
}

/**
 * Bottom navigation. Every item is a real button / label with its own text, a ≥ 56 px
 * touch target, and a clear selected state. The camera is a <label> around the file
 * input: the system camera opens from the tap itself, with no script in between
 * (the reliable way on iOS, also in the installed app).
 */
function Dock({ tab, onToday, onHistory, onAdd, onPhoto }: { tab: Tab; onToday: () => void; onHistory: () => void; onAdd: () => void; onPhoto: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <nav
      aria-label="ניווט ראשי"
      className="safe-bottom fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pt-3"
      style={{ background: 'linear-gradient(to top, var(--bg) 70%, transparent)' }}
    >
      <div className="flex w-full max-w-md items-stretch gap-1.5 rounded-[26px] border border-line bg-surface p-1.5 shadow-[var(--shadow-2)]">
        <DockItem active={tab === 'today'} label="היום" onClick={onToday} icon={<Home className="size-[22px]" aria-hidden />} />
        <button type="button" onClick={onAdd} className="pressable flex min-h-14 flex-1 items-center justify-center gap-2 rounded-[20px] bg-ink text-[17px] font-semibold text-inverse">
          <Plus className="size-6" strokeWidth={2.6} aria-hidden /> הוסף אוכל
        </button>
        <label className="pressable relative flex min-h-14 w-[64px] shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[20px] bg-surface-2 text-ink" aria-label="צלם אוכל"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              input.current?.click()
            }
          }}
        >
          <Camera className="size-[22px]" aria-hidden />
          <span className="text-[11px] leading-none font-medium">צילום</span>
          <input
            ref={input}
            type="file"
            accept="image/*"
            /* the dock opens the camera directly; the gallery stays available via "הוסף תמונה" in the food sheet */
            capture="environment"
            /* clipped to nothing: WebKit gives an opacity-0 file input real size, which then covered the next button */
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            data-testid="dock-photo-input"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) onPhoto(f)
            }}
          />
        </label>
        <DockItem active={tab === 'history'} label="היסטוריה" onClick={onHistory} icon={<LineChart className="size-[22px]" aria-hidden />} />
      </div>
    </nav>
  )
}

function DockItem({ active, label, onClick, icon }: { active: boolean; label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`pressable flex min-h-14 w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[20px] transition-colors ${active ? 'bg-surface-2 text-ink' : 'text-ink-3'}`}
    >
      {icon}
      <span className={`text-[11px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
    </button>
  )
}
