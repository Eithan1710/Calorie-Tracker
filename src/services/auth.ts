import { useSyncExternalStore } from 'react'
import type { AuthError, Session } from '@supabase/supabase-js'
import { AUTH_STORAGE_KEY, getSupabase } from './supabase'
import { hasSupabase } from './config'
import { authPassword, usernameError, usernameToEmail } from '../../supabase/functions/_shared/account.ts'

/**
 * Accounts: username + password on Supabase Auth.
 *
 *  - 'local'     no backend configured, development/tests only: one local profile, no login
 *  - 'unconfigured' a production build without a backend: nothing is shown (never an open app)
 *  - 'loading'   checking for a stored session
 *  - 'signedOut' show the login / register screen
 *  - 'signedIn'  userId is the auth uid; every row and photo is scoped to it
 *
 * The session is persisted by supabase-js (localStorage) and refreshed
 * automatically. On startup we peek at the stored session synchronously so the
 * app (and its offline data) opens instantly — also without a connection.
 */

export type AuthStatus = 'local' | 'unconfigured' | 'loading' | 'signedOut' | 'signedIn'
export interface AuthState {
  status: AuthStatus
  userId: string | null
  username: string | null
}

function peekStoredSession(): { userId: string; username: string | null } | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as { user?: { id?: string; user_metadata?: { username?: string } } }
    const id = s.user?.id
    return id ? { userId: id, username: s.user?.user_metadata?.username ?? null } : null
  } catch {
    return null
  }
}

const peeked = hasSupabase ? peekStoredSession() : null
let state: AuthState = !hasSupabase
  ? { status: import.meta.env.DEV ? 'local' : 'unconfigured', userId: null, username: null }
  : peeked
    ? { status: 'signedIn', ...peeked }
    : { status: 'loading', userId: null, username: null }

const listeners = new Set<() => void>()
function set(next: AuthState) {
  if (next.status === state.status && next.userId === state.userId && next.username === state.username) return
  state = next
  for (const l of listeners) l()
}

export function getAuth(): AuthState {
  return state
}
export function onAuthChange(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function useAuth(): AuthState {
  return useSyncExternalStore(onAuthChange, getAuth, getAuth)
}

const fromSession = (s: Session): AuthState => ({
  status: 'signedIn',
  userId: s.user.id,
  username: (s.user.user_metadata?.username as string | undefined) ?? null,
})

let started = false
/** while signIn() runs it decides the outcome (membership check), not the SDK's SIGNED_IN event */
let signingIn = false
export async function initAuth(): Promise<void> {
  if (!hasSupabase || started) return
  started = true
  const sb = await getSupabase()
  if (!sb) return
  sb.auth.onAuthStateChange((event, session) => {
    if (session) {
      if (!signingIn) set(fromSession(session))
    } else if (event === 'SIGNED_OUT' && !signingIn) set({ status: 'signedOut', userId: null, username: null })
  })
  const { data, error } = await sb.auth.getSession()
  if (data.session) {
    if ((await isMember(data.session.user.id)) === false) return signOutSession()
    set(fromSession(data.session))
  } else {
    // an expired token that can't be refreshed *because we're offline* keeps the user in (offline-first);
    // a revoked / invalid session, or none at all, means "signed out"
    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    const networkError = error?.name === 'AuthRetryableFetchError' || (error as AuthError | null)?.status === 0
    if (!(state.status === 'signedIn' && (offline || networkError))) set({ status: 'signedOut', userId: null, username: null })
  }
}

/** Access token for calls to our edge functions (null when signed out / local). */
export async function getAccessToken(): Promise<string | null> {
  if (!hasSupabase) return null
  const sb = await getSupabase()
  const { data } = (await sb?.auth.getSession()) ?? { data: { session: null } }
  return data.session?.access_token ?? null
}

// ── sign in / sign out (closed app: accounts are created by the owner, no sign-up) ──

export type AuthResult = { ok: true } | { ok: false; message: string; field?: 'username' | 'password' }

const OFFLINE = 'אין חיבור לאינטרנט. התחברות דורשת חיבור — נסה שוב כשתהיה מחובר.'
const NOT_MEMBER = 'לחשבון הזה אין גישה למאזן.'

function authMessage(e: AuthError | Error | null | undefined): string {
  if (!e) return 'משהו השתבש. נסה שוב.'
  const code = (e as AuthError & { code?: string }).code
  const status = (e as AuthError).status
  const msg = (e.message ?? '').toLowerCase()
  if (typeof navigator !== 'undefined' && !navigator.onLine) return OFFLINE
  if (code === 'invalid_credentials' || msg.includes('invalid login')) return 'שם משתמש או סיסמה שגויים.'
  if (code === 'over_request_rate_limit' || status === 429) return 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות.'
  if (code === 'user_banned') return 'החשבון הזה חסום.'
  if (e.name === 'AuthRetryableFetchError' || msg.includes('fetch') || msg.includes('network')) return OFFLINE
  return 'ההתחברות נכשלה. נסה שוב בעוד רגע.'
}

/**
 * Only accounts listed in mz_members may use the app (the database enforces
 * this too, for every table and photo). An Auth account created any other way
 * is signed straight out again.
 */
async function isMember(userId: string): Promise<boolean | null> {
  const sb = await getSupabase()
  if (!sb) return null
  const { data, error } = await sb.from('mz_members').select('user_id').eq('user_id', userId).maybeSingle()
  if (error) return null // unknown (offline etc.) — the database still protects the data
  return Boolean(data)
}

export async function signIn(username: string, password: string): Promise<AuthResult> {
  const uErr = usernameError(username)
  if (uErr) return { ok: false, message: uErr, field: 'username' }
  if (!password) return { ok: false, message: 'צריך סיסמה', field: 'password' }
  const sb = await getSupabase()
  if (!sb) return { ok: false, message: 'השרת לא מוגדר.' }
  signingIn = true
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email: await usernameToEmail(username), password: authPassword(password) })
    if (error || !data.session) return { ok: false, message: authMessage(error) }
    if ((await isMember(data.session.user.id)) === false) {
      await sb.auth.signOut({ scope: 'local' }).catch(() => {})
      return { ok: false, message: NOT_MEMBER }
    }
    set(fromSession(data.session))
    return { ok: true }
  } catch (e) {
    return { ok: false, message: authMessage(e as Error) }
  } finally {
    signingIn = false
  }
}

/** Ends the session on this device only (other devices stay signed in). */
export async function signOutSession(): Promise<void> {
  const sb = await getSupabase()
  try {
    await sb?.auth.signOut({ scope: 'local' })
  } catch {
    /* offline: the local session is removed anyway */
  }
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    /* ignore */
  }
  set({ status: 'signedOut', userId: null, username: null })
}
