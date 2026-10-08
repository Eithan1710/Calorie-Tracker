import { getAuth, initAuth, onAuthChange, signOutSession } from './auth'
import { dropLocalAccount, getState, hasUnsyncedChanges, initStore, resetStore } from '../data/store'
import { startSync, stopSync, syncNow } from './sync'
import { releaseRemindersForLogout } from './notifications'

/**
 * Ties the auth state to the local store and the sync engine:
 *   signed in  → open that account's local copy, then sync it
 *   signed out → drop the in-memory data (the login screen shows)
 *   local mode → the original single local profile (no backend configured)
 */

let active: string | null | undefined // undefined = nothing loaded

async function apply() {
  const a = getAuth()
  if (a.status === 'local') {
    if (active !== null) {
      active = null
      await initStore(null)
    }
    return
  }
  if (a.status === 'signedIn' && a.userId && a.userId !== active) {
    active = a.userId
    await initStore(a.userId)
    void startSync()
    return
  }
  if (a.status === 'signedOut' && active !== undefined) {
    active = undefined
    stopSync()
    resetStore()
  }
}

export function startSession() {
  onAuthChange(() => void apply())
  void apply()
  void initAuth()
}

/**
 * Log out on this device. Unsynced changes are pushed first; if that's not
 * possible (offline) they stay on this device and sync at the next login.
 * Otherwise the account's local copy is removed from the device.
 */
export async function logout(): Promise<{ keptLocal: boolean }> {
  const uid = getState().userId
  await syncNow().catch(() => {})
  const keptLocal = hasUnsyncedChanges()
  await releaseRemindersForLogout()
  stopSync()
  await signOutSession()
  if (uid && !keptLocal) await dropLocalAccount(uid)
  return { keptLocal }
}
