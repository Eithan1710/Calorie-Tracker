import { useEffect, useState } from 'react'
import { ChevronDown, Cloud, CloudOff, LogOut, Loader2 } from 'lucide-react'
import { Sheet, NumberField, Segmented, PrimaryButton, GhostButton } from '../primitives'
import { updateSettings, useStore } from '../../data/store'
import { isValidProfile, type Profile, type Sex } from '../../domain/energy'
import { hasSupabase } from '../../services/config'
import { currentEmail, getSyncStatus, onSyncStatus, pushProfile, sendLoginCode, signOut, syncNow, verifyLoginCode } from '../../services/sync'
import { disableReminders, enableReminders, isIOS, isStandalone, notificationSupport } from '../../services/notifications'
import { HealthConnect } from './StepsSheet'
import { useDaySummary } from '../screens/Today'
import { toDateKey } from '../../domain/goal'
import { fmt, KCAL } from '../format'
import { showToast } from '../toast'

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

  const toggleReminders = async () => {
    if (settings.remindersEnabled) {
      await disableReminders()
      setNotifyMsg(null)
      return
    }
    const r = await enableReminders()
    if (!r.ok) setNotifyMsg(r.message ?? null)
    else setNotifyMsg(r.push ? 'מעולה — תזכורת אחת ביום ב-21:30, גם כשהאפליקציה סגורה.' : 'התזכורת תופיע כשהאפליקציה פתוחה ברקע. לתזכורת גם כשהיא סגורה — התחבר לסנכרון.')
  }

  const support = typeof window !== 'undefined' ? notificationSupport() : 'unsupported'

  return (
    <Sheet open={open} onClose={onClose} title="הגדרות">
      <div className="flex flex-col gap-6 pt-1 pb-4">
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

        <HowItWorks />

        {isIOS() && !isStandalone() && (
          <p className="rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
            טיפ: באייפון, שיתוף ← <b>״הוספה למסך הבית״</b> — נפתח מהר כמו אפליקציה, ומאפשר תזכורות.
          </p>
        )}
      </div>
    </Sheet>
  )
}

function SyncSection() {
  const [status, setStatus] = useState(getSyncStatus())
  const [email, setEmail] = useState('')
  const [signedEmail, setSignedEmail] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const off = onSyncStatus(setStatus)
    return () => {
      off()
    }
  }, [])
  useEffect(() => {
    void currentEmail().then(setSignedEmail)
  }, [status])

  if (!hasSupabase) {
    return (
      <section className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4">
        <CloudOff className="mt-0.5 size-5 shrink-0 text-ink-3" aria-hidden />
        <p className="text-sm text-ink-2">הנתונים נשמרים במכשיר הזה. לגיבוי וסנכרון בין מכשירים יש לחבר Supabase (ראה README).</p>
      </section>
    )
  }

  if (signedEmail) {
    return (
      <section className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
        <Cloud className="size-5 shrink-0 text-good" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-medium">מסונכרן</p>
          <p className="ltr truncate text-end text-sm text-ink-3">{signedEmail}</p>
          {status === 'error' && <p className="text-sm text-surplus">הסנכרון נכשל — ננסה שוב אוטומטית.</p>}
        </div>
        <button type="button" onClick={() => void syncNow()} className="pressable min-h-10 rounded-xl px-3 text-sm font-medium" aria-label="סנכרן עכשיו">
          {status === 'syncing' ? <Loader2 className="size-4 animate-spin" /> : 'סנכרן'}
        </button>
        <button type="button" onClick={() => void signOut().then(() => setSignedEmail(null))} className="pressable grid size-10 place-items-center rounded-xl text-ink-3" aria-label="התנתקות">
          <LogOut className="size-4 -scale-x-100" />
        </button>
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="font-semibold">גיבוי וסנכרון</h3>
        <p className="text-sm text-ink-3">התחברות עם קוד למייל — בלי סיסמה. מאפשר גם ניתוח AI ותזכורות כשהאפליקציה סגורה.</p>
      </div>
      {step === 'email' ? (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            const err = await sendLoginCode(email.trim())
            setBusy(false)
            if (err) setMsg(err)
            else {
              setStep('code')
              setMsg('שלחנו קוד למייל.')
            }
          }}
        >
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" aria-label="אימייל" className="ltr min-h-12 w-full min-w-0 rounded-2xl bg-surface-2 px-4 outline-none focus:ring-2 focus:ring-info" />
          <PrimaryButton type="submit" className="min-h-12 px-5 text-base" disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : 'שלח קוד'}
          </PrimaryButton>
        </form>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            const err = await verifyLoginCode(email.trim(), code)
            setBusy(false)
            if (err) setMsg(err)
            else {
              showToast('מחובר ✓')
              setMsg(null)
            }
          }}
        >
          <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" aria-label="קוד" className="ltr num min-h-12 w-full min-w-0 rounded-2xl bg-surface-2 px-4 text-center text-xl tracking-[0.3em] outline-none focus:ring-2 focus:ring-info" />
          <PrimaryButton type="submit" className="min-h-12 px-5 text-base" disabled={busy || code.trim().length < 6}>
            אישור
          </PrimaryButton>
          <GhostButton onClick={() => setStep('email')} className="min-h-12 px-3 text-sm">
            חזרה
          </GhostButton>
        </form>
      )}
      {msg && <p className="text-sm text-ink-2" role="status">{msg}</p>}
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
            BMR לפי נוסחת Mifflin-St Jeor. צעדים ואימונים מחושבים <b>מעל</b> המנוחה, כדי שאותה אנרגיה לא תיספר פעמיים, וצעדים שנעשו בזמן ריצה מנוכים. השריפה לא מחושבת ע״י AI. כל המספרים הם הערכות — העקביות חשובה יותר מהדיוק.
          </p>
        </div>
      )}
    </section>
  )
}
