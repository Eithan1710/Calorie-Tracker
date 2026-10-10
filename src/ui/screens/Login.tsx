import { useId, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { PrimaryButton } from '../primitives'
import { Logo } from './Onboarding'
import { signIn } from '../../services/auth'
import { InstallApp } from '../InstallApp'

/**
 * Login with a username and password. Hebrew, RTL, one screen.
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
    <main className="safe-top mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8">
      <div className="animate-rise flex flex-1 flex-col justify-center gap-7 py-8">
        <div className="flex flex-col gap-4">
          <Logo className="size-14" />
          <div>
            <h1 className="text-[34px] leading-tight font-bold tracking-tight">מאזן</h1>
            <p className="mt-1 text-lg text-ink-2">כמה נכנס, כמה נשרף, כמה חלבון. 10 שניות ביום.</p>
          </div>
        </div>

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

        <p className="text-center text-sm text-ink-3">הגישה רק למשתמשים קיימים. נשארים מחוברים גם אחרי סגירת האפליקציה.</p>
        <InstallApp variant="link" />
      </div>
    </main>
  )
}
