import { useEffect, useState, type ReactNode } from 'react'
import { Copy, ChevronDown, RefreshCw } from 'lucide-react'
import { Sheet, PrimaryButton, NumberField, GhostButton } from '../primitives'
import { setSteps, updateSettings, useStore } from '../../data/store'
import { DEFAULT_STEP_GOAL, STEP_GOAL_LIMITS, STEP_GOAL_PRESETS, stepGoalError, stepGoalOf } from '../../domain/steps'
import { pushProfile, syncNow } from '../../services/sync'
import { createIngestToken, HEALTH_INGEST_URL } from '../../services/health'
import { hasSupabase } from '../../services/config'
import { fmt, haptic } from '../format'
import { showToast } from '../toast'

export function StepsSheet({ open, onClose, date }: { open: boolean; onClose: () => void; date: string }) {
  const current = useStore((s) => s.health[date])
  const [value, setValue] = useState<number | ''>('')
  useEffect(() => {
    if (open) setValue(current?.steps ?? '')
  }, [open, current?.steps])

  const save = () => {
    if (value === '' || value < 0) return
    setSteps(date, value, 'manual')
    haptic()
    onClose()
    showToast(`${fmt(value)} צעדים`)
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="צעדים ו-Apple Health"
      footer={
        <PrimaryButton className="w-full" onClick={save} disabled={value === ''}>
          עדכון
        </PrimaryButton>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <NumberField label="צעדים היום" value={value} onChange={setValue} inputMode="numeric" min={0} max={150000} autoFocus placeholder="7,842" />
        {current && (
          <p className="-mt-2 text-sm text-ink-3">
            עודכן {current.source === 'shortcut' ? 'אוטומטית מ-Apple Health' : current.source === 'url' ? 'מקיצור דרך' : 'ידנית'} ·{' '}
            {new Date(current.updated_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        <StepGoalField />
        <HealthConnect />
      </div>
    </Sheet>
  )
}

/**
 * The daily step goal: quick presets + any number. Saved to the account (mz_profiles.step_goal)
 * as soon as it is valid; an invalid value is explained and never saved.
 */
export function StepGoalField() {
  const saved = useStore((s) => stepGoalOf(s.settings))
  const [value, setValue] = useState<number | ''>(saved)
  useEffect(() => setValue(saved), [saved])
  const error = stepGoalError(value)
  const save = (v: number | '') => {
    setValue(v)
    if (stepGoalError(v) === null && v !== saved) {
      updateSettings({ stepGoal: Number(v) })
      void pushProfile()
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <NumberField label="יעד צעדים יומי" value={value} onChange={save} inputMode="numeric" min={STEP_GOAL_LIMITS.min} max={STEP_GOAL_LIMITS.max} step={500} placeholder={fmt(DEFAULT_STEP_GOAL)} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="יעדים מוכנים">
        {STEP_GOAL_PRESETS.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={saved === g}
            onClick={() => save(g)}
            className={`pressable min-h-9 rounded-full px-3 text-sm font-medium ${saved === g ? 'bg-ink text-inverse' : 'bg-surface-2 text-ink-2'}`}
          >
            {fmt(g)}
          </button>
        ))}
      </div>
      {error && value !== saved ? (
        <p role="alert" className="text-sm text-surplus">
          {error} · נשמר: {fmt(saved)}
        </p>
      ) : null}
    </div>
  )
}

/** When Apple Health data last arrived (any day), and what it contained. */
function LastAppleSync() {
  const last = useStore((st) =>
    Object.values(st.health)
      .filter((h) => h.source === 'shortcut' || h.active_kcal != null || h.resting_kcal != null)
      .sort((a, b) => (b.health_as_of ?? b.updated_at).localeCompare(a.health_as_of ?? a.updated_at))[0],
  )
  if (!last) return <p className="rounded-2xl bg-surface p-3 text-sm text-ink-3">עוד לא התקבלו נתונים מ-Apple Health.</p>
  const at = new Date(last.health_as_of ?? last.updated_at)
  const parts = [
    last.steps ? `${fmt(last.steps)} צעדים` : '',
    last.active_kcal != null ? `פעילה ${fmt(last.active_kcal)}` : '',
    last.resting_kcal != null ? `מנוחה ${fmt(last.resting_kcal)}` : '',
  ].filter(Boolean)
  return (
    <p className="rounded-2xl bg-surface p-3 text-sm text-ink-2" data-testid="apple-last-sync">
      התקבל לאחרונה: {at.toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })} {at.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
      {parts.length ? ` · ${parts.join(' · ')}` : ''}
      {last.active_kcal == null && last.resting_kcal == null && <span className="block text-ink-3">רק צעדים — הוסף לקיצור את האנרגיה הפעילה והאנרגיה במנוחה (למטה).</span>}
    </p>
  )
}

export function HealthConnect() {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const appUrl = typeof window !== 'undefined' ? `${window.location.origin}${import.meta.env.BASE_URL}`.replace(/\/$/, '') : ''
  const canBackground = hasSupabase

  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s)
      showToast('הועתק')
    } catch {
      showToast('לא הצלחתי להעתיק')
    }
  }

  return (
    <div className="rounded-3xl bg-surface-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-h-14 w-full items-center justify-between gap-2 px-4 text-start font-medium" aria-expanded={open}>
        <span> חיבור ל-Apple Health</span>
        <ChevronDown className={`size-5 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4 text-[15px] leading-relaxed text-ink-2">
          <p>
            אפליקציית אינטרנט לא יכולה לקרוא את Apple Health ישירות — אפל מאפשרת את זה רק לאפליקציות מותקנות. הגשר: אפליקציית <b>קיצורים</b> (Shortcuts) של אפל, חינמית ומובנית באייפון.
          </p>
          {canBackground ? (
            <HealthSetupSteps
              token={token}
              busy={busy}
              copy={copy}
              onCreateToken={async () => {
                setBusy(true)
                setToken(await createIngestToken())
                setBusy(false)
              }}
            />
          ) : (
            <>
              <p className="font-medium text-ink">דרך קיצור דרך שפותח את האפליקציה</p>
              <ol className="list-decimal space-y-1 ps-5">
                <li>קיצורים ← קיצור חדש ← <b>חיפוש דגימות בריאות</b> (צעדים, היום) ← <b>חישוב סטטיסטיקה</b> (סכום).</li>
                <li>
                  פעולה: <b>פתיחת כתובת URL</b>: <span className="ltr break-all">{appUrl}/?steps=</span>
                  [הסכום]
                </li>
              </ol>
              <p className="text-sm text-ink-3">
                שים לב: באייפון הקישור נפתח בספארי, שמחזיק נתונים נפרדים מהאפליקציה שהותקנה למסך הבית.
              </p>
            </>
          )}
          <p className="text-sm text-ink-3">ובכל מקרה — אפשר פשוט להקליד את המספר למעלה.</p>
        </div>
      )}
    </div>
  )
}

/** One numbered step of the setup guide. */
function SetupStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-2xl bg-surface p-3.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-sm font-semibold text-inverse" aria-hidden>
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">{title}</p>
        <div className="mt-1 flex flex-col gap-1.5 text-sm text-ink-2">{children}</div>
      </div>
    </li>
  )
}

/** An action name in the Shortcuts app, in both languages (it depends on the iPhone's language). */
const Action = ({ he, en }: { he: string; en: string }) => (
  <b className="text-ink">
    {he} <span className="ltr inline-block font-normal text-ink-3">({en})</span>
  </b>
)

/**
 * Background sync, step by step, for a member setting it up alone: a personal code, one shortcut
 * (steps + active + resting energy → POST), automations a few times a day, and a check that the
 * numbers arrived. Exactly the body health-ingest accepts: steps, active_kcal, resting_kcal, as_of.
 */
function HealthSetupSteps({ token, busy, copy, onCreateToken }: { token: string | null; busy: boolean; copy: (s: string) => Promise<void>; onCreateToken: () => Promise<void> }) {
  const [checking, setChecking] = useState(false)
  const fields: [string, string, string][] = [
    ['steps', 'מספר (Number)', 'הסכום של הצעדים'],
    ['active_kcal', 'מספר (Number)', 'הסכום של האנרגיה הפעילה'],
    ['resting_kcal', 'מספר (Number)', 'הסכום של האנרגיה במנוחה'],
    ['as_of', 'טקסט (Text)', 'התאריך המעוצב'],
  ]
  return (
    <>
      <LastAppleSync />
      <p className="font-medium text-ink">הגדרה חד-פעמית, בערך 5 דקות, באפליקציית קיצורים באייפון:</p>
      <ol className="flex flex-col gap-2" aria-label="שלבי חיבור Apple Health">
        <SetupStep n={1} title="קוד אישי">
          <p>הקוד מזהה אותך בלי סיסמה. שמור אותו להמשך — הוא מוצג פעם אחת.</p>
          {token ? (
            <button type="button" onClick={() => void copy(token)} className="ltr flex min-h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-start text-sm break-all" data-testid="ingest-token">
              <Copy className="size-4 shrink-0" aria-hidden /> {token}
            </button>
          ) : (
            <GhostButton disabled={busy} onClick={() => void onCreateToken()}>
              צור קוד אישי
            </GhostButton>
          )}
          <p className="text-xs text-ink-3">{token ? 'קוד חדש מבטל את הקודם.' : 'כבר הגדרת קיצור עם קוד? הוא ממשיך לעבוד, אין צורך בחדש.'}</p>
        </SetupStep>

        <SetupStep n={2} title="קיצור חדש: שלושה מספרים מ-Apple Health">
          <p>
            בלשונית <b>קיצורים</b> ← <b>+</b>. הוסף <Action he="מצא דגימות בריאות" en="Find Health Samples" />: סוג <b>צעדים</b>, תאריך התחלה <b>היום</b>, ואחריה{' '}
            <Action he="חשב סטטיסטיקה" en="Calculate Statistics" /> ← <b>סכום</b>.
          </p>
          <p>
            חזור על זה פעמיים: עם <b>אנרגיה פעילה</b> (Active Energy) ועם <b>אנרגיה במנוחה</b> (Resting Energy).
          </p>
          <p>
            הוסף <Action he="תאריך נוכחי" en="Current Date" /> ← <Action he="עצב תאריך" en="Format Date" /> בתבנית <b className="ltr inline-block">ISO 8601</b> עם השעה.
          </p>
        </SetupStep>

        <SetupStep n={3} title="שליחה למאזן">
          <p>
            הוסף <Action he="קבל תוכן של URL" en="Get Contents of URL" /> עם הכתובת:
          </p>
          <button type="button" onClick={() => void copy(HEALTH_INGEST_URL ?? '')} className="ltr flex min-h-10 items-center gap-2 rounded-xl bg-surface-2 px-3 text-start text-sm break-all">
            <Copy className="size-4 shrink-0" aria-hidden /> {HEALTH_INGEST_URL}
          </button>
          <p>
            שיטה <b className="ltr inline-block">POST</b>. כותרת (Header): <span className="ltr inline-block font-mono text-xs">Authorization</span> ={' '}
            <span className="ltr inline-block font-mono text-xs">Bearer הקוד-שלך</span> (המילה Bearer, רווח, והקוד משלב 1).
          </p>
          <p>
            גוף הבקשה: <b className="ltr inline-block">JSON</b>, עם ארבעה שדות:
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-3">
                <th className="py-1 text-start font-medium">שם השדה</th>
                <th className="py-1 text-start font-medium">סוג</th>
                <th className="py-1 text-start font-medium">ערך</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(([k, t, v]) => (
                <tr key={k} className="border-t border-[var(--line)]">
                  <td className="ltr py-1 text-start font-mono">{k}</td>
                  <td className="py-1">{t}</td>
                  <td className="py-1">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SetupStep>

        <SetupStep n={4} title="שיפעל לבד, כמה פעמים ביום">
          <p>
            בלשונית <b>אוטומציה</b> ← <b>+</b> ← <b>שעה ביום</b>. צור כמה כאלה — למשל 12:00, 18:00 ו-<b>23:50</b> (האחרונה סוגרת את היום מלא) — ובכל אחת בחר את
            הקיצור ו<b>״הפעל מיד״</b> (בלי לשאול).
          </p>
        </SetupStep>

        <SetupStep n={5} title="בדיקה">
          <p>הפעל את הקיצור פעם אחת ידנית, ואז:</p>
          <GhostButton
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              await syncNow().catch(() => {})
              setChecking(false)
            }}
          >
            <RefreshCw className={`size-4 ${checking ? 'animate-spin' : ''}`} aria-hidden /> בדוק אם הנתונים הגיעו
          </GhostButton>
          <p className="text-xs text-ink-3">כשזה עובד, השורה ״התקבל לאחרונה״ למעלה מתעדכנת עם הצעדים והאנרגיה של היום. אם לא — בדוק את הקוד בכותרת ואת שמות השדות.</p>
        </SetupStep>
      </ol>
      <details className="rounded-2xl bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-medium text-ink">אימונים אוטומטיים (Strava, Hevy, השעון) — לא חובה</summary>
        <div className="mt-2 flex flex-col gap-1.5">
          <p>הקלוריות של האימונים כבר נכללות באנרגיה הפעילה, אז אין בזה צורך לחישוב. זה רק כדי לראות את האימונים ברשימה.</p>
          <p>
            אם ב<b>מצא דגימות בריאות</b> מופיע הסוג <b>אימונים</b> (Workouts — תלוי בגרסת iOS): עבור על כל אימון עם <b>חזור עם כל פריט</b>, בנה <b>מילון</b> עם{' '}
            <span className="ltr">type, start, end, duration_min, distance_km, kcal, source</span>, הוסף למשתנה, ושלח בגוף ה-JSON כשדה <span className="ltr">workouts</span>{' '}
            (Array). שליחה חוזרת לא יוצרת כפילות.
          </p>
        </div>
      </details>
    </>
  )
}
