import { useSyncExternalStore } from 'react'
import { getSupabase } from './supabase'
import { hasSupabase } from './config'
import {
  exercisesForDate, foodForDate, getState, markClean, onLocalChange, setSteps, updateSettings, upsertExercise, upsertFood,
} from '../data/store'
import type { Exercise, FoodEntry } from '../data/types'
import { summarizeDay } from '../domain/day'
import { isValidProfile } from '../domain/energy'
import { isValidTarget } from '../domain/goal'
import { uploadPendingPhotos } from './photos'

/**
 * Offline-first sync with Supabase (optional).
 *  - Every local write marks the record `dirty`; push() upserts dirty records.
 *  - pull() fetches rows changed since the last pull; last-write-wins on updated_at,
 *    except a local dirty record newer than the server copy always wins.
 *  - Deletes are soft (deleted_at) so they propagate.
 * Triggers: startup, coming online, tab visible, and 1.5 s after any local change.
 *
 * Everything is scoped to the signed-in account: rows are written with its
 * user_id and RLS on the server only ever returns/accepts that user's rows.
 */

type Status = 'off' | 'idle' | 'syncing' | 'error'
let status: Status = hasSupabase ? 'idle' : 'off'
/** the account being synced (null = signed out / local mode) */
const currentUser = () => (hasSupabase ? getState().userId : null)
const statusListeners = new Set<(s: Status) => void>()
let running: Promise<void> | null = null
let runningUser: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function setStatus(s: Status) {
  status = s
  for (const l of statusListeners) l(s)
}
export function getSyncStatus() {
  return status
}
export function onSyncStatus(l: (s: Status) => void): () => void {
  statusListeners.add(l)
  return () => {
    statusListeners.delete(l)
  }
}

const foodToRow = (f: FoodEntry, uid: string) => ({
  id: f.id,
  user_id: uid,
  date: f.date,
  meal: f.meal,
  title: f.title,
  emoji: f.emoji,
  items: f.items,
  calories: f.totals.calories,
  protein_g: f.totals.protein_g,
  fat_g: f.totals.fat_g,
  carbs_g: f.totals.carbs_g,
  calories_low: f.totals.calories_low ?? null,
  calories_high: f.totals.calories_high ?? null,
  confidence: f.confidence,
  provider: f.provider,
  raw_text: f.raw_text ?? null,
  status: f.status,
  photo_path: f.photo_path && f.photo_path.startsWith(`${uid}/`) ? f.photo_path : null,
  created_at: f.created_at,
  updated_at: f.updated_at,
  deleted_at: f.deleted ? f.updated_at : null,
})

interface FoodRow extends ReturnType<typeof foodToRow> {}

const rowToFood = (r: FoodRow): FoodEntry => ({
  id: r.id,
  date: r.date,
  meal: r.meal,
  title: r.title,
  emoji: r.emoji,
  items: r.items,
  totals: {
    calories: Number(r.calories),
    protein_g: Number(r.protein_g),
    fat_g: Number(r.fat_g),
    carbs_g: Number(r.carbs_g),
    ...(r.calories_low != null ? { calories_low: Number(r.calories_low), calories_high: Number(r.calories_high) } : {}),
  },
  confidence: Number(r.confidence),
  provider: r.provider,
  raw_text: r.raw_text ?? undefined,
  status: r.status,
  photo_path: r.photo_path ?? undefined,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted: Boolean(r.deleted_at),
})

const exToRow = (e: Exercise, uid: string) => ({
  id: e.id,
  user_id: uid,
  date: e.date,
  type: e.type,
  duration_min: e.duration_min ?? null,
  distance_km: e.distance_km ?? null,
  intensity: e.intensity ?? null,
  rest: e.rest ?? null,
  lifts: e.lifts ?? [],
  muscles: e.muscles ?? [],
  volume_kg: e.volume_kg != null ? Math.round(e.volume_kg) : null,
  created_at: e.created_at,
  updated_at: e.updated_at,
  deleted_at: e.deleted ? e.updated_at : null,
})
interface ExRow extends ReturnType<typeof exToRow> {}
const rowToEx = (r: ExRow): Exercise => ({
  id: r.id,
  date: r.date,
  type: r.type,
  duration_min: r.duration_min ?? undefined,
  distance_km: r.distance_km != null ? Number(r.distance_km) : undefined,
  intensity: r.intensity ?? undefined,
  rest: r.rest ?? undefined,
  lifts: Array.isArray(r.lifts) && r.lifts.length ? r.lifts : undefined,
  muscles: Array.isArray(r.muscles) && r.muscles.length ? r.muscles : undefined,
  volume_kg: r.volume_kg != null ? Number(r.volume_kg) : undefined,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted: Boolean(r.deleted_at),
})

async function push() {
  const sb = await getSupabase()
  const userId = currentUser()
  if (!sb || !userId) return
  // photos first, so a synced entry never points at a file that isn't there yet
  await uploadPendingPhotos(sb, userId)
  const s = getState()
  if (s.userId !== userId) return
  const dirtyFood = Object.values(s.food).filter((f) => f.dirty)
  const dirtyEx = Object.values(s.exercise).filter((e) => e.dirty)
  const dirtyHealth = Object.values(s.health).filter((h) => h.dirty)
  const touchedDates = new Set([...dirtyFood, ...dirtyEx, ...dirtyHealth].map((r) => r.date))

  if (dirtyFood.length) {
    const { error } = await sb.from('mz_food_entries').upsert(dirtyFood.map((f) => foodToRow(f, userId!)))
    if (error) throw error
    markClean('food', dirtyFood.map((f) => f.id))
  }
  if (dirtyEx.length) {
    const { error } = await sb.from('mz_exercises').upsert(dirtyEx.map((e) => exToRow(e, userId!)))
    if (error) throw error
    markClean('exercise', dirtyEx.map((e) => e.id))
  }
  if (dirtyHealth.length) {
    const { error } = await sb.from('mz_health_data').upsert(
      dirtyHealth.map((h) => ({ user_id: userId, date: h.date, steps: h.steps, source: h.source, updated_at: h.updated_at })),
      { onConflict: 'user_id,date' },
    )
    if (error) throw error
    markClean('health', dirtyHealth.map((h) => h.date))
  }

  // cached per-day numbers: used by the reminder job ("already logged today?") and server-side history
  if (touchedDates.size) {
    const st = getState()
    const rows = [...touchedDates].map((date) => {
      const sum = summarizeDay({
        date,
        food: foodForDate(st, date),
        exercises: exercisesForDate(st, date),
        steps: st.health[date]?.steps ?? 0,
        profile: st.settings.profile,
        proteinTarget: st.settings.proteinTarget,
        target: st.settings.deficitTarget,
      })
      return {
        user_id: userId,
        date,
        calories_in: sum.eaten,
        calories_out: sum.burned,
        protein_g: sum.protein,
        fat_g: sum.fat,
        carbs_g: sum.carbs,
        steps: sum.steps,
        entries: foodForDate(st, date).length,
        updated_at: new Date().toISOString(),
      }
    })
    await sb.from('mz_daily_summaries').upsert(rows, { onConflict: 'user_id,date' })
  }
}

async function pull() {
  const sb = await getSupabase()
  const userId = currentUser()
  if (!sb || !userId) return
  const since = getState().settings.lastPulledAt
  // small overlap so clock skew never drops a row
  const sinceIso = since ? new Date(new Date(since).getTime() - 120_000).toISOString() : '1970-01-01T00:00:00Z'
  const startedAt = new Date().toISOString()

  const [food, ex, health] = await Promise.all([
    sb.from('mz_food_entries').select('*').eq('user_id', userId).gt('updated_at', sinceIso).limit(5000),
    sb.from('mz_exercises').select('*').eq('user_id', userId).gt('updated_at', sinceIso).limit(5000),
    sb.from('mz_health_data').select('date,steps,source,updated_at').eq('user_id', userId).gt('updated_at', sinceIso).limit(5000),
  ])
  if (food.error) throw food.error
  if (ex.error) throw ex.error
  if (health.error) throw health.error

  const s = getState()
  if (s.userId !== userId) return // signed out / switched account meanwhile
  for (const row of (food.data ?? []) as FoodRow[]) {
    const local = s.food[row.id]
    if (local?.dirty && local.updated_at > row.updated_at) continue
    upsertFood(rowToFood(row), { fromServer: true })
  }
  for (const row of (ex.data ?? []) as ExRow[]) {
    const local = s.exercise[row.id]
    if (local?.dirty && local.updated_at > row.updated_at) continue
    upsertExercise(rowToEx(row), { fromServer: true })
  }
  for (const row of (health.data ?? []) as { date: string; steps: number; source: 'manual' | 'shortcut' | 'url'; updated_at: string }[]) {
    const local = s.health[row.date]
    if (local && local.updated_at >= row.updated_at) continue
    setSteps(row.date, row.steps, row.source, { fromServer: true, updatedAt: row.updated_at })
  }
  updateSettings({ lastPulledAt: startedAt })
}

/**
 * Profile & targets live in mz_profiles (one row per account) so every device
 * of the same user computes with the same body data. Newest change wins.
 */
async function syncProfile() {
  const sb = await getSupabase()
  const userId = currentUser()
  if (!sb || !userId) return
  const { data, error } = await sb.from('mz_profiles').select('*').eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (getState().userId !== userId) return
  const st = getState().settings
  const localAt = st.profileUpdatedAt ? Date.parse(st.profileUpdatedAt) : 0
  const serverAt = data?.updated_at ? Date.parse(data.updated_at) : 0

  if (data && (!isValidProfile(st.profile) || serverAt > localAt)) {
    const target = { min: Number(data.deficit_min ?? 100), max: Number(data.deficit_max ?? 300) }
    updateSettings({
      profile: { sex: data.sex, age: Number(data.age), heightCm: Number(data.height_cm), weightKg: Number(data.weight_kg) },
      proteinTarget: Number(data.protein_target_g ?? 120),
      deficitTarget: isValidTarget(target) ? target : st.deficitTarget,
      profileUpdatedAt: new Date(serverAt).toISOString(),
    })
    return
  }
  if (isValidProfile(st.profile) && (!data || localAt > serverAt)) {
    const updatedAt = st.profileUpdatedAt || new Date().toISOString()
    const { error: upErr } = await sb.from('mz_profiles').upsert({
      user_id: userId,
      sex: st.profile.sex,
      age: Math.round(st.profile.age),
      height_cm: st.profile.heightCm,
      weight_kg: st.profile.weightKg,
      protein_target_g: Math.round(st.proteinTarget),
      deficit_min: Math.round(st.deficitTarget.min),
      deficit_max: Math.round(st.deficitTarget.max),
      reminder_enabled: st.remindersEnabled,
      reminder_time: st.reminderTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      updated_at: updatedAt,
    })
    if (upErr) throw upErr
    if (!st.profileUpdatedAt) updateSettings({ profileUpdatedAt: updatedAt })
  }
}

// After sign-in on a new device the profile lives only on the server: the app
// waits for the first profile check (or a failure / offline) before asking for it.
const profileChecked = new Set<string>()
const profileListeners = new Set<() => void>()
function markProfileChecked(userId: string) {
  if (profileChecked.has(userId)) return
  profileChecked.add(userId)
  for (const l of profileListeners) l()
}
export function useProfileChecked(userId: string | null): boolean {
  return useSyncExternalStore(
    (l) => {
      profileListeners.add(l)
      return () => profileListeners.delete(l)
    },
    () => !userId || profileChecked.has(userId),
    () => true,
  )
}

export function syncNow(): Promise<void> {
  const uid = currentUser()
  if (!uid) return Promise.resolve()
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    markProfileChecked(uid)
    return Promise.resolve()
  }
  if (running) return runningUser === uid ? running : running.then(() => syncNow())
  setStatus('syncing')
  runningUser = uid
  running = (async () => {
    try {
      await syncProfile().finally(() => markProfileChecked(uid))
      await push()
      await pull()
      await push() // anything that changed meanwhile
      setStatus('idle')
    } catch (e) {
      console.warn('sync failed', e)
      setStatus('error')
    } finally {
      running = null
    }
  })()
  return running
}

export function scheduleSync(delay = 1500) {
  if (!currentUser()) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void syncNow(), delay)
}

let started = false

/** Wire the triggers once; each run syncs whichever account is signed in. */
export async function startSync() {
  if (!hasSupabase) return
  if (!started) {
    started = true
    onLocalChange(() => scheduleSync())
    window.addEventListener('online', () => void syncNow())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncNow()
    })
  }
  await syncNow()
}

/** Stop pending work for the current account (logout). */
export function stopSync() {
  if (timer) clearTimeout(timer)
  timer = null
}

/** Profile/targets changed on this device: stamp and push. */
export async function pushProfile() {
  updateSettings({ profileUpdatedAt: new Date().toISOString() })
  await syncProfile().catch(() => {})
}
