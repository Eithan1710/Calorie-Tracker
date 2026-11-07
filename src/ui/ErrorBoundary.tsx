import { Component, type ReactNode } from 'react'
import { reportError } from '../services/errors'

/**
 * A rendering error used to leave a blank page. Now the screen says what happened, that nothing
 * logged is lost (data is kept on the device and in the account), and offers to reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    reportError(error, 'render')
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="safe-top mx-auto grid min-h-dvh w-full max-w-md place-items-center px-5" role="alert">
        <div className="card flex flex-col gap-3 p-6 text-center">
          <p className="text-xl font-semibold">משהו השתבש בתצוגה</p>
          <p className="text-[15px] leading-relaxed text-ink-2">כל מה שרשמת שמור — במכשיר ובחשבון. טעינה מחדש בדרך כלל פותרת את זה.</p>
          <button type="button" onClick={() => location.reload()} className="pressable min-h-12 rounded-2xl bg-ink px-5 font-semibold text-inverse">
            טעינה מחדש
          </button>
        </div>
      </main>
    )
  }
}
