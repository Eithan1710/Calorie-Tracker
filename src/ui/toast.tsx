import { useSyncExternalStore } from 'react'

interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function showToast(text: string, action?: Toast['action'], ms = 4500) {
  const t: Toast = { id: ++seq, text, action }
  toasts = [t] // one at a time: calm, and the undo always belongs to the latest action
  emit()
  setTimeout(() => dismiss(t.id), ms)
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => toasts,
  )
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite" role="status">
      {list.map((t) => (
        <div key={t.id} className="animate-rise pointer-events-auto flex min-h-12 max-w-md items-center gap-3 rounded-2xl bg-ink py-2 ps-4 pe-2 text-inverse shadow-[var(--shadow-2)]">
          <span className="text-[15px]">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="pressable min-h-9 rounded-xl px-3 font-semibold text-inverse underline-offset-4 hover:underline"
              onClick={() => {
                t.action!.run()
                dismiss(t.id)
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
