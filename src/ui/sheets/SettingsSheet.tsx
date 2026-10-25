import { useEffect, useState } from 'react'
import { ChevronDown, Cloud, CloudOff, Loader2, LogOut, UserRound } from 'lucide-react'
import { Sheet, NumberField, Segmented } from '../primitives'
import { hasUnsyncedChanges, logProfileWeight, updateSettings, useStore } from '../../data/store'
import { isValidProfile, type Profile, type Sex } from '../../domain/energy'
import { bandFrom, bandLabel, bandParts, CUSTOM_LIMITS, customBandError, intakeRangeFor, isValidTarget, phaseOf, range, TARGET_PRESETS, type BandDirection, type CalorieMode } from '../../domain/goal'
import { hasSupabase } from '../../services/config'
import { useAuth } from '../../services/auth'
import { logout } from '../../services/session'
import { showToast } from '../toast'
import { InstallApp } from '../InstallApp'
import { getSyncStatus, onSyncStatus, pushProfile, pushWeightsNow, syncNow } from '../../services/sync'
import { disableReminders, enableReminders, notificationSupport } from '../../services/notifications'
import { HealthConnect, StepGoalField } from './StepsSheet'
import { healthDeviceOf, routineEnergy, type HealthDevice } from '../../domain/routine'
import { useDaySummary } from '../screens/Today'
import { toDateKey } from '../../domain/goal'
import { fmt, KCAL } from '../format'
import { getPerf, median } from '../../services/perf'

export function ProfileFields({ value, onChange }: { value: Partial<Profile>; onChange: (p: Partial<Profile>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Segmented<Sex>
        label="מין"
        value={(value.sex ?? 'male') as Sex}
        onChange={(sex) => onChange({ ...value, sex })}
        options={[
          { value: 'male', label: 'גבר' },
          { value: 'female', label: 'אישה' },
        ]}
      />
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="גיל" value={value.age ?? ''} onChange={(v) => onChange({ ...value, age: v === '' ? undefined : v })} inputMode="numeric" min={14} max={100} />
        <NumberField label="גובה" unit="ס״מ" value={value.heightCm ?? ''} onChange={(v) => onChange({ ...value, heightCm: v === '' ? undefined : v })} inputMode="numeric" min={120} max={230} />
        <NumberField label="משקל" unit="ק״ג" value={value.weightKg ?? ''} onChange={(v) => onChange({ ...value, weightKg: v === '' ? undefined : v })} step={0.1} min={35} max={250} />
      </div>
    </div>
  )
}

/**
 * What measures Active Energy. iPhone alone → the app adds the daily routine the phone can't see
 * (getting up, shower, dressing); Apple Watch measures it itself → nothing is added.
 */
function HealthDeviceField() {
  const settings = useStore((s) => s.settings)
  const exercise = useStore((s) => s.exercise)
  const device = healthDeviceOf(settings, Object.values(exercise))
  const weightKg = settings.profile?.weightKg
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented<HealthDevice>
        label="מה מודד את הפעילות"
        value={device}
        onChange={(v) => {
          // the cached server copy of each day is recomputed with the new rule on the next sync
          updateSettings({ healthDevice: v, summariesVersion: undefined })
          void pushProfile()
        }}
        options={[
          { value: 'phone', label: 'אייפון בלבד' },
          { value: 'watch', label: 'גם Apple Watch' },
        ]}
      />
      <p className="text-sm text-ink-3" data-testid="health-device-note">
        {device === 'phone'
          ? `האייפון לא רואה קימה, מקלחת והתלבשות — מתווסף ${weightKg ? `כ-${fmt(routineEnergy({ weightKg }).kcal)} קק״ל` : 'חישוב'} ״שגרה יומית״ ליום עם נתוני Apple Health.`
          : 'השעון מודד גם את תנועות השגרה, אז לא מתווסף עליהן כלום.'}
      </p>
    </div>
  )
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const [draft, setDraft] = useState<Partial<Profile>>(settings.profile ?? { sex: 'male' })
  const [protein, setProtein] = useState<number | ''>(settings.proteinTarget)
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null)

  // the weight when the sheet opened: a changed weight becomes today's weigh-in when it closes
  const [openedWeight, setOpenedWeight] = useState<number | null>(null)
  useEffect(() => {
    if (open) {
      setDraft(settings.profile ?? { sex: 'male' })
      setProtein(settings.proteinTarget)
      setNotifyMsg(null)
      setOpenedWeight(settings.profile?.weightKg ?? null)
    } else if (openedWeight !== null) {
      const now = settings.profile?.weightKg
      if (now != null && Math.abs(now - openedWeight) >= 0.05 && logProfileWeight(now)) {
        void pushWeightsNow().then((r) => showToast(r.ok ? `נוסף ליומן המשקל · ${now} ק״ג` : `המשקל נשמר במכשיר, עוד לא בחשבון: ${r.message}`))
      }
      setOpenedWeight(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const changeProfile = (p: Partial<Profile>) => {
    setDraft(p)
    if (isValidProfile(p)) {
      updateSettings({ profile: p })
      void pushProfile()
    }
  }

  const toggleReminders = async () => {
    if (settings.remindersEnabled) {
      await disableReminders()
      setNotifyMsg(null)
      return
    }
    const r = await enableReminders()
    if (!r.ok) setNotifyMsg(r.message ?? null)
    else setNotifyMsg(r.push ? 'מעולה — תזכורת אחת ביום ב-21:30, גם כשהאפליקציה סגורה.' : 'התזכורת תופיע כשהאפליקציה פתוחה ברקע (התראות כשהיא סגורה לא זמינות בדפדפן הזה).')
  }

  const support = typeof window !== 'undefined' ? notificationSupport() : 'unsupported'

  return (
    <Sheet open={open} onClose={onClose} title="הגדרות">
      <div className="flex flex-col gap-6 pt-1 pb-4">
        <AccountSection onLoggedOut={onClose} />

        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">הפרופיל שלך</h3>
          <ProfileFields value={draft} onChange={changeProfile} />
          {!isValidProfile(draft) && <p className="text-sm text-surplus">צריך גיל, גובה ומשקל כדי לחשב שריפה.</p>}
        </section>

        <section>
          <NumberField
            label="יעד חלבון יומי"
            unit="ג׳"
            value={protein}
            inputMode="numeric"
            min={40}
            max={300}
            onChange={(v) => {
              setProtein(v)
              if (v !== '' && v >= 40 && v <= 300) {
                updateSettings({ proteinTarget: v })
                void pushProfile()
              }
            }}
          />
          {isValidProfile(draft) && (
            <p className="mt-1.5 text-sm text-ink-3">
              {(Number(protein || 0) / draft.weightKg).toFixed(1)} ג׳ לק״ג — לריקומפ מקובל <span className="ltr">1.6–2.2</span> ג׳ לק״ג.
            </p>
          )}
        </section>

        <CalorieTargetSection />

        <section className="flex flex-col gap-2">
          <div className="flex min-h-14 items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">תזכורת יומית</h3>
              <p className="text-sm text-ink-3">״לא שכחת לעדכן את היום?״ ב-21:30, פעם אחת ביום</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.remindersEnabled}
              aria-label="תזכורת יומית"
              onClick={() => void toggleReminders()}
              className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${settings.remindersEnabled ? 'bg-good' : 'bg-surface-3'}`}
            >
              <span className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${settings.remindersEnabled ? 'start-7' : 'start-1'}`} />
            </button>
          </div>
          {support === 'ios_needs_install' && !notifyMsg && (
            <p className="text-sm text-ink-3">באייפון: שיתוף ← ״הוספה למסך הבית״, ואז להפעיל כאן.</p>
          )}
          {notifyMsg && <p className="text-sm text-ink-2" role="status">{notifyMsg}</p>}
        </section>

        <SyncSection />

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">צעדים</h3>
          <StepGoalField />
          <HealthDeviceField />
          <HealthConnect />
        </section>

        <InstallApp variant="row" />

        <SpeedInfo />

        <HowItWorks />
      </div>
    </Sheet>
  )
}

function SyncSection() {
  const [status, setStatus] = useState(getSyncStatus())
  useEffect(() => {
    const off = onSyncStatus(setStatus)
    return () => {
      off()
    }
  }, [])

  if (!hasSupabase) {
    return (
      <section className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
        <CloudOff className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
        <p className="text-sm text-ink-2">הנתונים נשמרים במכשיר הזה בלבד.</p>
      </section>
    )
  }

  return (
    <section className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
      <Cloud className={`size-5 shrink-0 ${status === 'error' ? 'text-surplus' : 'text-good'}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{status === 'error' ? 'הסנכרון נכשל — ננסה שוב אוטומטית' : 'מסונכרן לענן'}</p>
        <p className="text-sm text-ink-3">הנתונים שלך זמינים בכל מכשיר שבו תתחבר לחשבון</p>
      </div>
      <button type="button" onClick={() => void syncNow()} className="pressable min-h-11 rounded-xl px-3 text-sm font-medium" aria-label="סנכרן עכשיו">
        {status === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : 'סנכרן'}
      </button>
    </section>
  )
}

function AccountSection({ onLoggedOut }: { onLoggedOut: () => void }) {
  const auth = useAuth()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  if (auth.status !== 'signedIn') return null

  const doLogout = async () => {
    setBusy(true)
    const { keptLocal } = await logout()
    setBusy(false)
    onLoggedOut()
    showToast(keptLocal ? 'התנתקת. שינויים שלא סונכרנו נשמרו במכשיר ויסונכרנו בכניסה הבאה.' : 'התנתקת')
  }

  return (
    <section className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-ink-2" aria-hidden>
          <UserRound className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-3">מחובר כ־</p>
          <p className="truncate font-semibold" dir="auto">{auth.username ?? 'משתמש'}</p>
        </div>
        <button
          type="button"
          onClick={() => (hasUnsyncedChanges() && !navigator.onLine ? setConfirm(true) : void doLogout())}
          disabled={busy}
          className="pressable flex min-h-11 items-center gap-1.5 rounded-xl bg-surface px-3 text-sm font-medium"
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogOut className="size-4 -scale-x-100" aria-hidden />}
          התנתקות
        </button>
      </div>
      {confirm && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-warn-soft p-3 text-sm">
          <p>אין חיבור, ויש שינויים שעוד לא סונכרנו. הם יישארו במכשיר הזה ויסונכרנו כשתתחבר שוב. להתנתק בכל זאת?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => void doLogout()} className="pressable min-h-10 flex-1 rounded-lg bg-ink font-medium text-inverse">
              להתנתק
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="pressable min-h-10 flex-1 rounded-lg bg-surface font-medium">
              ביטול
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function HowItWorks() {
  const [open, setOpen] = useState(false)
  const { summary } = useDaySummary(toDateKey(new Date()))
  const b = summary.burn
  return (
    <section className="rounded-3xl bg-surface-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-14 w-full items-center justify-between px-4 text-start font-medium" aria-expanded={open}>
        איך מחושבת השריפה?
        <ChevronDown className={`size-5 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="px-4 pb-4 text-[15px] leading-relaxed text-ink-2">
          {b && (
            <dl className="mb-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-2xl bg-surface p-3">
              <dt>חילוף חומרים במנוחה (BMR)</dt>
              <dd className="num">{fmt(b.bmr)}</dd>
              <dt>פעילות יומיומית בסיסית</dt>
              <dd className="num">{fmt(b.baseline)}</dd>
              <dt>צעדים ({fmt(b.stepsCounted)})</dt>
              <dd className="num">{fmt(b.steps)}</dd>
              <dt>אימונים</dt>
              <dd className="num">{fmt(b.exercise)}</dd>
              <dt>עיכול מזון (~10%)</dt>
              <dd className="num">{fmt(b.tef)}</dd>
              <dt className="font-semibold text-ink">סה״כ היום</dt>
              <dd className="num font-semibold text-ink">
                {fmt(b.total)} {KCAL}
              </dd>
            </dl>
          )}
          {summary.energy?.mode === 'health' && (
            <p className="mb-3 rounded-2xl bg-surface p-3">
              היום יש נתונים מ-Apple Health, ולכן הסה״כ הוא <b>אנרגיה במנוחה + אנרגיה פעילה</b> כפי שאפל מדווחת. הטבלה למעלה היא
              ההערכה של המודל, להשוואה בלבד. אימונים לא מתווספים לאנרגיה הפעילה של אפל — הם כבר כלולים בה.
            </p>
          )}
          <p>
            כשאין נתונים מ-Apple Health: BMR לפי נוסחת Mifflin-St Jeor (מין, גיל, גובה ומשקל). אימונים לפי ערכי MET מה-Compendium of Physical Activities (2024):
            ‏MET × 3.5 × משקל ÷ 200 לדקה, פחות המנוחה האישית שלך שכבר נספרת ב-BMR. באימון כוח הערכים הם ממוצע לאימון שלם כולל
            מנוחות בין סטים, לפי עצימות וקצב — המשקל שהרמת לא משנה את החישוב. צעדים שנעשו בזמן ריצה או הליכה מנוכים. השריפה לא
            מחושבת ע״י AI. כל המספרים הם הערכות (בדרך כלל ±20–30%) — העקביות חשובה יותר מהדיוק.
          </p>
        </div>
      )}
    </section>
  )
}

/** Measured on this phone: launch → upload buttons usable, and photo → result (median of recent ones). */
function SpeedInfo() {
  const [open, setOpen] = useState(false)
  const p = open ? getPerf() : null
  const sec = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} שנ׳`)
  const flows = p?.flows.filter((f) => f.ok) ?? []
  const m = (k: 'prepare_ms' | 'request_ms' | 'render_ms' | 'total_ms') => median(flows.map((f) => f[k]))
  const server = (k: string) => median(flows.map((f) => f.server?.[k]).filter((v): v is number => typeof v === 'number'))
  return (
    <section className="rounded-2xl bg-surface-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-12 w-full items-center justify-between px-4 font-semibold">
        מהירות
        <ChevronDown className={`size-4 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {p && (
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 px-4 pb-4 text-sm" data-testid="speed-info">
          <dt className="text-ink-2">פתיחה עד שאפשר לצלם</dt>
          <dd className="num">{sec(median(p.launches.map((l) => l.ready_ms)))}</dd>
          <dt className="text-ink-2">תמונה → תוצאה (סה״כ)</dt>
          <dd className="num font-semibold">{sec(m('total_ms'))}</dd>
          <dt className="ps-3 text-ink-3">הכנת התמונה בטלפון</dt>
          <dd className="num text-ink-3">{sec(m('prepare_ms'))}</dd>
          <dt className="ps-3 text-ink-3">שליחה + ניתוח</dt>
          <dd className="num text-ink-3">{sec(m('request_ms'))}</dd>
          {server('ai') !== null && (
            <>
              <dt className="ps-6 text-ink-3">מתוכם AI</dt>
              <dd className="num text-ink-3">{sec(server('ai'))}</dd>
            </>
          )}
          <dt className="ps-3 text-ink-3">הצגה</dt>
          <dd className="num text-ink-3">{sec(m('render_ms'))}</dd>
          <dd className="col-span-2 pt-1 text-xs text-ink-3">חציון של {flows.length} תמונות ו-{p.launches.length} פתיחות אחרונות במכשיר הזה.</dd>
        </dl>
      )}
    </section>
  )
}

/**
 * Daily target: the fitness phase (as before) + how the band is set.
 *  - אוטומטי: the phase's deficit band (the original behaviour);
 *  - מותאם אישית: the user's own band of deficit or surplus, e.g. a deficit of 200–300 kcal.
 * Phase and custom band are saved independently: changing one never overwrites the other.
 */
function CalorieTargetSection() {
  const settings = useStore((s) => s.settings)
  const phase = phaseOf(settings)
  const mode: CalorieMode = settings.calorieMode ?? 'auto'
  const { summary } = useDaySummary(toDateKey(new Date()))
  const burned = summary.burn ? summary.burned : null
  const saved = isValidTarget(settings.customDeficit) ? settings.customDeficit : null
  const start = bandParts(saved ?? settings.deficitTarget)
  const [dir, setDir] = useState<BandDirection>(start.dir)
  const [from, setFrom] = useState<number | ''>(start.from)
  const [to, setTo] = useState<number | ''>(start.to)
  const error = customBandError(dir, from, to)
  // a band that arrives from the account (another device) replaces what the fields show
  useEffect(() => {
    if (!saved) return
    const p = bandParts(saved)
    setDir(p.dir)
    setFrom(p.from)
    setTo(p.to)
  }, [saved?.min, saved?.max])

  const save = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch)
    void pushProfile()
  }
  const change = (d: BandDirection, f: number | '', t: number | '') => {
    setDir(d)
    setFrom(f)
    setTo(t)
    if (customBandError(d, f, t) === null) save({ customDeficit: bandFrom(d, Number(f), Number(t)) })
  }
  const chooseMode = (m: CalorieMode) => {
    // first time custom: start from what the fields show, so the target never jumps to nothing
    if (m === 'custom' && !saved && error === null) save({ calorieMode: m, customDeficit: bandFrom(dir, Number(from), Number(to)) })
    else save({ calorieMode: m })
  }
  const autoBand = settings.deficitTarget
  const autoToday = intakeRangeFor(autoBand, burned)
  const shown = mode === 'custom' && error === null ? bandFrom(dir, Number(from), Number(to)) : null
  const shownToday = shown ? intakeRangeFor(shown, burned) : null

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">היעד היומי</h3>
      <div role="radiogroup" aria-label="היעד היומי" className="grid grid-cols-2 gap-2">
        {TARGET_PRESETS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={phase === t.id}
            // the phase sets the automatic band; a custom band stays exactly as it is
            onClick={() => save({ goalPhase: t.id, deficitTarget: t.target })}
            className={`pressable flex min-h-16 flex-col items-start justify-center rounded-2xl px-4 py-2 text-start transition-colors ${phase === t.id ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink'}`}
          >
            <span className="font-semibold">{t.label}</span>
            <span className={`text-sm ${phase === t.id ? 'opacity-80' : 'text-ink-3'}`}>{t.hint}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3">
        <Segmented<CalorieMode>
          label="יעד קלוריות"
          value={mode}
          onChange={chooseMode}
          options={[
            { value: 'auto', label: 'אוטומטי' },
            { value: 'custom', label: 'מותאם אישית' },
          ]}
        />
        {mode === 'auto' ? (
          <p className="px-1 text-sm text-ink-2" data-testid="auto-target">
            לפי השלב: <span className="font-semibold">{bandLabel(autoBand)} {KCAL}</span>
            {autoToday && <> · היום לאכול {range(autoToday.min, autoToday.max)}</>}
          </p>
        ) : (
          <>
            <Segmented<BandDirection>
              label="סוג היעד"
              value={dir}
              onChange={(d) => change(d, from, to)}
              options={[
                { value: 'deficit', label: 'גירעון' },
                { value: 'surplus', label: 'עודף' },
              ]}
            />
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="מ-" unit={KCAL} value={from} inputMode="numeric" min={0} max={CUSTOM_LIMITS[dir]} onChange={(v) => change(dir, v, to)} />
              <NumberField label="עד" unit={KCAL} value={to} inputMode="numeric" min={0} max={CUSTOM_LIMITS[dir]} onChange={(v) => change(dir, from, v)} />
            </div>
            {error || !shown ? (
              <p role="alert" className="px-1 text-sm text-surplus">
                {error}
                {saved ? ` · נשמר: ${bandLabel(saved)}` : ''}
              </p>
            ) : (
              <p className="px-1 text-sm text-ink-2" data-testid="custom-target">
                יעד יומי: <span className="font-semibold">{bandLabel(shown)} {KCAL}</span>
                {shownToday && <> · היום לאכול {range(shownToday.min, shownToday.max)}</>}
              </p>
            )}
          </>
        )}
      </div>
      <p className="text-sm text-ink-3">{mode === 'custom' ? 'המאזן היומי (נשרפו פחות נכנסו) נבדק מול הטווח הזה, וכל הטווח נחשב ביעד. השלב נשמר, והמעבר בין המצבים לא מוחק את הערכים.' : 'המאזן היומי נבדק מול הטווח הזה. אין כאן יעדים קיצוניים.'}</p>
    </section>
  )
}
