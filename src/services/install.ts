import { useSyncExternalStore } from 'react'

/**
 * "Install the app" (PWA).
 *
 *  • Android Chrome / Edge / Samsung Internet and desktop Chrome fire
 *    `beforeinstallprompt` once the site meets the install criteria (HTTPS,
 *    manifest with name + 192/512 icons + start_url + display, service worker).
 *    We keep that event and show the browser's own install dialog only when the
 *    user taps our button.
 *  • Where that event doesn't exist (Firefox for Android, iOS Safari, or Chrome
 *    before it decides the site is installable) we show short instructions for the
 *    browser menu instead.
 *  • Already installed (running standalone, or `appinstalled` fired) → nothing is shown.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>
}

export type Platform = 'android' | 'ios' | 'desktop'

export interface InstallState {
  /** the app is running installed (home screen / app window) */
  installed: boolean
  /** the browser's native install dialog can be shown */
  canPrompt: boolean
  platform: Platform
}

const INSTALLED_KEY = 'maazan:installed'
const DISMISS_KEY = 'maazan:install-dismissed'

export function detectPlatform(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): Platform {
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

function runningStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith('android-app://')
  )
}

function rememberedInstalled(): boolean {
  try {
    return localStorage.getItem(INSTALLED_KEY) === '1'
  } catch {
    return false
  }
}

let deferred: BeforeInstallPromptEvent | null = null
let state: InstallState = { installed: runningStandalone(), canPrompt: false, platform: detectPlatform() }
const listeners = new Set<() => void>()

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

let started = false
/** Call once, as early as possible (main.tsx): the browser fires the event only once per page load. */
export function initInstall() {
  if (started || typeof window === 'undefined') return
  started = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // keep Chrome's mini-infobar away; we show our own, quiet button
    deferred = e as BeforeInstallPromptEvent
    // the event only fires when the app is NOT installed in this browser
    try {
      localStorage.removeItem(INSTALLED_KEY)
    } catch {
      /* ignore */
    }
    set({ canPrompt: true, installed: runningStandalone() })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    try {
      localStorage.setItem(INSTALLED_KEY, '1')
    } catch {
      /* ignore */
    }
    set({ installed: true, canPrompt: false })
  })
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => set({ installed: runningStandalone() || state.installed }))
}

export function getInstall(): InstallState {
  return state
}

export function useInstall(): InstallState & { installedHere: boolean } {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
  // In a normal browser tab, a remembered install with no new install event means the app
  // is already on this phone (Chrome stops firing the event once it's installed).
  return { ...s, installedHere: s.installed || (!s.canPrompt && rememberedInstalled()) }
}

/** Show the browser's install dialog. Must be called from a user gesture (button tap). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred
  if (!e) return 'unavailable'
  deferred = null // an event can be used once
  set({ canPrompt: false })
  try {
    await e.prompt()
    const { outcome } = await e.userChoice
    if (outcome === 'accepted') {
      try {
        localStorage.setItem(INSTALLED_KEY, '1')
      } catch {
        /* ignore */
      }
      set({ installed: true })
    }
    return outcome
  } catch {
    return 'unavailable'
  }
}

/** The small banner on the home screen can be dismissed; the settings entry stays. */
export function bannerDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
export function dismissBanner() {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* ignore */
  }
}
