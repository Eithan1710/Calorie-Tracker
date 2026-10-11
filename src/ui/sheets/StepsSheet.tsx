import { useEffect, useState } from 'react'
import { Copy, ChevronDown } from 'lucide-react'
import { Sheet, PrimaryButton, NumberField, GhostButton } from '../primitives'
import { setSteps, useStore } from '../../data/store'
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
        <HealthConnect />
      </div>
    </Sheet>
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
            <>
              <LastAppleSync />
              <p className="font-medium text-ink">סנכרון אוטומטי ברקע (מומלץ)</p>
              <ol className="list-decimal space-y-1.5 ps-5">
                <li>קיצורים ← אוטומציה ← חדשה ← <b>שעה ביום</b> (כמה פעמים ביום, ופעם אחת ב-23:50 כדי שהיום ייסגר מלא) ← ״הפעל מיד״.</li>
                <li>
                  <b>חיפוש דגימות בריאות</b> ← סוג: <b>צעדים</b> ← תאריך התחלה: <b>היום</b> ← ואז <b>חישוב סטטיסטיקה</b> ← <b>סכום</b>.
                </li>
                <li>
                  אותו דבר עם סוג <b>אנרגיה פעילה</b> (Active Energy) ← סכום.
                </li>
                <li>
                  אותו דבר עם סוג <b>אנרגיה במנוחה</b> (Resting Energy) ← סכום.
                </li>
                <li>
                  <b>תאריך נוכחי</b> ← <b>עיצוב תאריך</b> ← תבנית <b>ISO 8601</b> (כולל שעה).
                </li>
                <li>
                  <b>קבלת תוכן מכתובת URL</b> ← שיטה POST ← כותרת <span className="ltr">Authorization: Bearer &lt;הקוד&gt;</span> ← גוף JSON עם השדות:
                  <span className="ltr mt-1 block rounded-xl bg-surface p-2 font-mono text-xs leading-relaxed">
                    steps (Number) · active_kcal (Number) · resting_kcal (Number) · as_of (Text)
                  </span>
                </li>
              </ol>
              <details className="rounded-2xl bg-surface p-3 text-sm">
                <summary className="cursor-pointer font-medium text-ink">אימונים אוטומטיים (Strava, Hevy, השעון) — אם האייפון מאפשר</summary>
                <div className="mt-2 flex flex-col gap-1.5">
                  <p>
                    אפשרי רק אם ברשימת הסוגים של <b>חיפוש דגימות בריאות</b> מופיע <b>אימונים</b> (Workouts) — זה תלוי בגרסת iOS. אם הוא לא מופיע, אין צורך: הקלוריות של האימונים כבר נכללות באנרגיה הפעילה.
                  </p>
                  <ol className="list-decimal space-y-1 ps-5">
                    <li>חיפוש דגימות בריאות ← סוג אימונים ← תאריך התחלה: היום.</li>
                    <li>
                      <b>חזרה עם כל פריט</b> ← <b>מילון</b> עם: <span className="ltr">type</span> (שם/סוג האימון), <span className="ltr">start</span> ו-<span className="ltr">end</span> (תאריכי ההתחלה והסיום בעיצוב ISO 8601), <span className="ltr">duration_min</span>, <span className="ltr">distance_km</span>, <span className="ltr">kcal</span>, <span className="ltr">source</span> — מה שזמין ב<b>פרטי דגימת בריאות</b>.
                    </li>
                    <li><b>הוספה למשתנה</b> ״אימונים״, ובגוף ה-JSON: <span className="ltr">workouts</span> (Array) = האימונים.</li>
                  </ol>
                  <p className="text-ink-3">שליחה חוזרת של אותו אימון מעדכנת אותו ולא יוצרת כפילות. אימון שמחקת באפליקציה לא יחזור.</p>
                </div>
              </details>
              <div className="flex flex-col gap-2 rounded-2xl bg-surface p-3">
                <p className="text-sm text-ink-3">כתובת:</p>
                <button type="button" onClick={() => void copy(HEALTH_INGEST_URL ?? '')} className="ltr flex items-center gap-2 text-start text-sm break-all">
                  <Copy className="size-4 shrink-0" aria-hidden /> {HEALTH_INGEST_URL}
                </button>
                {token ? (
                  <button type="button" onClick={() => void copy(token)} className="ltr flex items-center gap-2 text-start text-sm break-all">
                    <Copy className="size-4 shrink-0" aria-hidden /> {token}
                  </button>
                ) : (
                  <GhostButton
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      setToken(await createIngestToken())
                      setBusy(false)
                    }}
                  >
                    צור קוד אישי חדש
                  </GhostButton>
                )}
                {token ? (
                  <p className="text-xs text-ink-3">הקוד מוצג פעם אחת בלבד. יצירת קוד חדש מבטלת את הקודם.</p>
                ) : (
                  <p className="text-xs text-ink-3">כבר יש לך קוד בקיצור הקיים? אפשר להמשיך להשתמש בו — אין צורך בקוד חדש.</p>
                )}
              </div>
            </>
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
