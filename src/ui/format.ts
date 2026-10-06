import { fromDateKey, toDateKey, addDays } from '../domain/goal'

const nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 })
export const fmt = (n: number) => nf.format(Math.round(n))
export const KCAL = 'קק״ל'

/** Signed balance as the user thinks of it: deficit shown as "−150". */
export function fmtBalance(deficit: number): string {
  const v = -Math.round(deficit)
  if (v === 0) return '0'
  return `${v < 0 ? '−' : '+'}${nf.format(Math.abs(v))}`
}

export function dayTitle(key: string, today = toDateKey(new Date())): string {
  if (key === today) return 'היום'
  if (key === addDays(today, -1)) return 'אתמול'
  if (key === addDays(today, 1)) return 'מחר'
  return fromDateKey(key).toLocaleDateString('he-IL', { weekday: 'long' })
}

export function dateLong(key: string): string {
  return fromDateKey(key).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function dateShort(key: string): string {
  return fromDateKey(key).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })
}

export function weekdayShort(key: string): string {
  return fromDateKey(key).toLocaleDateString('he-IL', { weekday: 'narrow' })
}

export function fmtPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function confidenceLabel(c: number): { text: string; tone: 'good' | 'warn' | 'low' } {
  if (c >= 0.8) return { text: 'הערכה טובה', tone: 'good' }
  if (c >= 0.6) return { text: 'הערכה סבירה', tone: 'warn' }
  return { text: 'הערכה גסה', tone: 'low' }
}

export function haptic(ms = 12) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* ignore */
  }
}
