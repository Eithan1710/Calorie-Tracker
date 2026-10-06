import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

// ── Bottom sheet ─────────────────────────────────────────────────────────────

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  label,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  label?: string
}) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const restoreFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement as HTMLElement
      setMounted(true)
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(r)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 260)
    restoreFocus.current?.focus?.()
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Tab' && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>('button,[href],input,textarea,select,[tabindex]:not([tabindex="-1"])')
        const list = [...f].filter((el) => !el.hasAttribute('disabled'))
        if (!list.length) return
        const first = list[0]
        const last = list[list.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!mounted) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px] transition-opacity duration-250"
        style={{ opacity: shown ? 1 : 0 }}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        className="relative flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-[28px] bg-surface shadow-[var(--shadow-2)] sm:rounded-[28px]"
        style={{
          transform: shown ? 'translateY(0)' : 'translateY(105%)',
          transition: 'transform 300ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-surface-3 sm:hidden" aria-hidden />
        <div className="flex items-center justify-between gap-3 px-5 pt-3 pb-1">
          {title ? (
            <h2 id={titleId} className="text-xl font-semibold tracking-tight">
              {title}
            </h2>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="pressable -me-2 grid size-11 place-items-center rounded-full text-ink-3 hover:bg-surface-2"
            aria-label="סגירה"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="safe-bottom border-t border-line px-5 pt-3">{footer}</div>}
      </div>
    </div>
  )
}

// ── Animated number ──────────────────────────────────────────────────────────

export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const [display, setDisplay] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    const b = value
    if (a === b) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      from.current = b
      setDisplay(b)
      return
    }
    let raf = 0
    const dur = 650
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur)
      const e = 1 - Math.pow(1 - p, 3)
      const v = a + (b - a) * e
      setDisplay(v)
      if (p < 1) raf = requestAnimationFrame(tick)
      else from.current = b
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      from.current = b
    }
  }, [value])
  return <span className={className}>{format(display)}</span>
}

// ── Segmented control ────────────────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode }[]
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-2xl bg-surface-2 p-1">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`pressable flex-1 rounded-xl font-medium transition-colors ${size === 'sm' ? 'min-h-9 px-2 text-sm' : 'min-h-11 px-3'} ${
              active ? 'bg-surface text-ink shadow-[var(--shadow-1)]' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export function PrimaryButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`pressable inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-ink px-6 text-lg font-semibold text-inverse disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

export function GhostButton({ children, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`pressable inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-surface-2 px-5 font-medium text-ink disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  )
}

// ── Number field with label + unit ───────────────────────────────────────────

export function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  inputMode = 'decimal',
  autoFocus,
  placeholder,
}: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
  unit?: string
  step?: number
  min?: number
  max?: number
  inputMode?: 'decimal' | 'numeric'
  autoFocus?: boolean
  placeholder?: string
}) {
  const id = useId()
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-2">{label}</span>
      <span className="flex min-h-14 items-center rounded-2xl bg-surface-2 px-4 focus-within:ring-2 focus-within:ring-info">
        <input
          id={id}
          type="number"
          inputMode={inputMode}
          step={step}
          min={min}
          max={max}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="num w-full min-w-0 bg-transparent text-xl font-semibold outline-none placeholder:text-ink-3/60"
        />
        {unit && <span className="shrink-0 ps-2 text-ink-3">{unit}</span>}
      </span>
    </label>
  )
}

// ── Progress bar (RTL: fills from the right) ─────────────────────────────────

export function Bar({ value, max, color, track = 'var(--surface-2)', height = 10, label }: { value: number; max: number; color: string; track?: string; height?: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      className="w-full overflow-hidden rounded-full"
      style={{ background: track, height }}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)' }} />
    </div>
  )
}
