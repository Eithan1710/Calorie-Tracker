import { useId, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { PrimaryButton, Segmented } from '../primitives'
import { Logo } from './Onboarding'
import { register, signIn } from '../../services/auth'
import { PASSWORD_MIN } from '../../../supabase/functions/_shared/account.ts'

type Mode = 'login' | 'register'

/** Login / register with a username and password. Hebrew, RTL, one screen. */
export function Login() {
  const [mode, setMode] = useState<Mode>('login')
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
    const res = mode === 'login' ? await signIn(username, password) : await register(username, password)
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
          <Segmented<Mode>
            label="כניסה או הרשמה"
            value={mode}
            onChange={(m) => {
              setMode(m)
              setError(null)
            }}
            options={[
              { value: 'login', label: 'התחברות' },
              { value: 'register', label: 'משתמש חדש' },
            ]}
          />

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
                className="w-full min-w-0 bg-transparent text-lg outline-none placeholder:text-ink-3/60"
                placeholder="למשל: זובקוב"
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
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                dir="ltr"
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
            {mode === 'register' && <span className="text-sm text-ink-3">לפחות {PASSWORD_MIN} תווים</span>}
          </label>

          {error && (
            <p id={errId} role="alert" className="rounded-2xl bg-surplus-soft px-4 py-3 text-[15px] text-surplus">
              {error.message}
            </p>
          )}

          <PrimaryButton type="submit" disabled={busy || !username.trim() || !password}>
            {busy && <Loader2 className="size-5 animate-spin" aria-hidden />}
            {mode === 'login' ? 'כניסה' : 'יצירת חשבון'}
          </PrimaryButton>
        </form>

        <p className="text-center text-sm text-ink-3">
          {mode === 'login' ? 'אין לך חשבון? בחר ״משתמש חדש״.' : 'כל משתמש רואה רק את הנתונים שלו. נשארים מחוברים גם אחרי סגירת האפליקציה.'}
        </p>
      </div>
    </main>
  )
}
