import { useId, useState } from 'react'
import { Activity, Camera, Eye, EyeOff, Loader2, Scale, Sigma } from 'lucide-react'
import { PrimaryButton } from '../primitives'
import { Logo } from './Onboarding'
import { signIn } from '../../services/auth'
import { InstallApp } from '../InstallApp'

/** What מאזן does, for someone who lands here without an account. */
const FEATURES = [
  { icon: Camera, title: 'מצלמים — וזהו', text: 'צילום של הצלחת או של התווית, והערכים התזונתיים מוכנים. כל פריט אפשר לתקן במגע.' },
  { icon: Activity, title: 'השריפה מ-Apple Health', text: 'אנרגיה במנוחה ופעילה מהאייפון, בלי לספור אימונים פעמיים.' },
  { icon: Sigma, title: 'כל מספר מוסבר', text: 'רואים מאיפה כל קלוריה באה — מה נמדד ומה הערכה, ובאיזה טווח.' },
  { icon: Scale, title: 'בודק את עצמו מול המשקל', text: 'משווה את הגירעון שנרשם לשינוי במשקל, כולל מים מקריאטין.' },
] as const

/**
 * The logged-out screen: what the app does + login with a username and password. Hebrew, RTL.
 * Closed app: there is no sign-up — accounts are created by the owner.
 */
export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; field?: 'username' | 'password' } | null>(null)
  const userId = useId()
  const passId = useId()
  const errId = useId()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const res = await signIn(username, password)
    setBusy(false)
    if (!res.ok) setError({ message: res.message, field: res.field })
  }

  const fieldCls = (bad: boolean) =>
    `flex min-h-14 items-center rounded-2xl bg-surface-2 px-4 focus-within:ring-2 ${bad ? 'ring-2 ring-surplus' : 'focus-within:ring-info'}`

  return (
    <main className="safe-top mx-auto grid min-h-dvh w-full max-w-md gap-x-12 px-5 pb-8 lg:max-w-5xl lg:grid-cols-[1.1fr_1fr] lg:items-center lg:px-8">
      <div className="animate-rise flex flex-col gap-6 pt-8 lg:py-8">
        <div className="flex flex-col gap-4">
          <Logo className="size-14" />
          <div>
            <h1 className="text-[34px] leading-tight font-bold tracking-tight lg:text-[44px]">מאזן</h1>
            <p className="mt-1 text-lg text-ink-2 lg:text-xl">כמה נכנס, כמה נשרף, כמה חלבון. 10 שניות ביום.</p>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="מה מאזן עושה">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-3 rounded-2xl bg-surface p-3.5 shadow-[var(--shadow-1)]">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-surface-2" aria-hidden>
                <Icon className="size-5 text-ink-2" />
              </span>
              <span>
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm leading-relaxed text-ink-3">{text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="animate-rise flex flex-col justify-center gap-5 py-8">

        <form onSubmit={(e) => void submit(e)} className="card flex flex-col gap-4 p-5" noValidate>
          <h2 className="text-xl font-semibold">התחברות</h2>

          <label htmlFor={userId} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">שם משתמש</span>
            <span className={fieldCls(error?.field === 'username')}>
              <input
                id={userId}
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                dir="auto"
                enterKeyHint="next"
                aria-invalid={error?.field === 'username' || undefined}
                aria-describedby={error ? errId : undefined}
                className="w-full min-w-0 bg-transparent text-lg outline-none"
              />
            </span>
          </label>

          <label htmlFor={passId} className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink-2">סיסמה</span>
            <span className={fieldCls(error?.field === 'password')}>
              <input
                id={passId}
                name="password"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                dir="auto"
                enterKeyHint="go"
                aria-invalid={error?.field === 'password' || undefined}
                aria-describedby={error ? errId : undefined}
                className="w-full min-w-0 bg-transparent text-lg outline-none"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="pressable -me-2 grid size-11 shrink-0 place-items-center rounded-xl text-ink-3"
                aria-label={show ? 'הסתר סיסמה' : 'הצג סיסמה'}
                aria-pressed={show}
              >
                {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
              </button>
            </span>
          </label>

          {error && (
            <p id={errId} role="alert" className="rounded-2xl bg-surplus-soft px-4 py-3 text-[15px] text-surplus">
              {error.message}
            </p>
          )}

          <PrimaryButton type="submit" disabled={busy || !username.trim() || !password}>
            {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}
            כניסה
          </PrimaryButton>
        </form>

        <p className="text-center text-sm text-ink-3">מאזן פתוח כרגע בהזמנה בלבד — החשבונות נפתחים אישית. נשארים מחוברים גם אחרי סגירת האפליקציה.</p>
        <InstallApp variant="link" />
      </div>
    </main>
  )
}
