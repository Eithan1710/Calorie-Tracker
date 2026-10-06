import { useEffect, useState } from 'react'
import { Copy, ChevronDown } from 'lucide-react'
import { Sheet, PrimaryButton, NumberField, GhostButton } from '../primitives'
import { setSteps, useStore } from '../../data/store'
import { createIngestToken, HEALTH_INGEST_URL } from '../../services/health'
import { hasSupabase } from '../../services/config'
import { isSignedIn } from '../../services/sync'
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
      title="צעדים"
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

export function HealthConnect() {
  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const appUrl = typeof window !== 'undefined' ? window.location.origin : ''
  const canBackground = hasSupabase && isSignedIn()

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
              <p className="font-medium text-ink">סנכרון אוטומטי ברקע (מומלץ)</p>
              <ol className="list-decimal space-y-1 ps-5">
                <li>קיצורים ← אוטומציה ← חדשה ← <b>שעה ביום</b> (למשל 21:15, ״הפעל מיד״).</li>
                <li>פעולה: <b>חיפוש דגימות בריאות</b> ← סוג: צעדים ← תאריך: היום.</li>
                <li>פעולה: <b>חישוב סטטיסטיקה</b> ← סכום.</li>
                <li>
                  פעולה: <b>קבלת תוכן מכתובת URL</b> ← שיטה POST ← כותרת <span className="ltr">Authorization: Bearer &lt;הקוד&gt;</span> ← גוף JSON: <span className="ltr">steps</span> = הסכום.
                </li>
              </ol>
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
                    צור קוד אישי
                  </GhostButton>
                )}
                {token && <p className="text-xs text-ink-3">הקוד מוצג פעם אחת בלבד. יצירת קוד חדש מבטלת את הקודם.</p>}
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
                שים לב: באייפון הקישור נפתח בספארי, שמחזיק נתונים נפרדים מהאפליקציה שהותקנה למסך הבית. לסנכרון אמין לאפליקציה המותקנת — התחבר לסנכרון בהגדרות ותופיע כאן אפשרות הרקע.
              </p>
            </>
          )}
          <p className="text-sm text-ink-3">ובכל מקרה — אפשר פשוט להקליד את המספר למעלה.</p>
        </div>
      )}
    </div>
  )
}
