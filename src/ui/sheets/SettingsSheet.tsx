import { useEffect, useState } from 'react'
import { ChevronDown, Cloud, CloudOff, Loader2, LogOut, UserRound } from 'lucide-react'
import { Sheet, NumberField, Segmented } from '../primitives'
import { hasUnsyncedChanges, updateSettings, useStore } from '../../data/store'
import { isValidProfile, type Profile, type Sex } from '../../domain/energy'
import { TARGET_PRESETS } from '../../domain/goal'
import { hasSupabase } from '../../services/config'
import { useAuth } from '../../services/auth'
import { logout } from '../../services/session'
import { showToast } from '../toast'
import { InstallApp } from '../InstallApp'
import { getSyncStatus, onSyncStatus, pushProfile, syncNow } from '../../services/sync'
import { disableReminders, enableReminders, notificationSupport } from '../../services/notifications'
import { HealthConnect } from './StepsSheet'
import { useDaySummary } from '../screens/Today'
import { toDateKey } from '../../domain/goal'
import { fmt, KCAL } from '../format'

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

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const [draft, setDraft] = useState<Partial<Profile>>(settings.profile ?? { sex: 'male' })
  const [protein, setProtein] = useState<number | ''>(settings.proteinTarget)
  const [notifyMsg, setNotifyMsg] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(settings.profile ?? { sex: 'male' })
      setProtein(settings.proteinTarget)
      setNotifyMsg(null)
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

  const presetId = TARGET_PRESETS.find((t) => t.target.min === settings.deficitTarget.min && t.target.max === settings.deficitTarget.max)?.id ?? 'recomp'

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

        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">היעד היומי</h3>
          <div role="radiogroup" aria-label="היעד היומי" className="grid grid-cols-2 gap-2">
            {TARGET_PRESETS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={presetId === t.id}
                onClick={() => {
                  updateSettings({ deficitTarget: t.target })
                  void pushProfile()
                }}
                className={`pressable flex min-h-16 flex-col items-start justify-center rounded-2xl px-4 py-2 text-start transition-colors ${presetId === t.id ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink'}`}
              >
                <span className="font-semibold">{t.label}</span>
                <span className={`text-sm ${presetId === t.id ? 'opacity-80' : 'text-ink-3'}`}>{t.hint}</span>
              </button>
            ))}
          </div>
          <p className="text-sm text-ink-3">המאזן היומי נבדק מול הטווח הזה. אין כאן יעדים קיצוניים.</p>
        </section>

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
          <HealthConnect />
        </section>

        <InstallApp variant="row" />

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
          <p>
            BMR לפי נוסחת Mifflin-St Jeor (מין, גיל, גובה ומשקל). אימונים לפי ערכי MET מה-Compendium of Physical Activities (2024):
            ‏MET × 3.5 × משקל ÷ 200 לדקה, פחות המנוחה האישית שלך שכבר נספרת ב-BMR. באימון כוח הערכים הם ממוצע לאימון שלם כולל
            מנוחות בין סטים, לפי עצימות וקצב — המשקל שהרמת לא משנה את החישוב. צעדים שנעשו בזמן ריצה או הליכה מנוכים. השריפה לא
            מחושבת ע״י AI. כל המספרים הם הערכות (בדרך כלל ±20–30%) — העקביות חשובה יותר מהדיוק.
          </p>
        </div>
      )}
    </section>
  )
}
