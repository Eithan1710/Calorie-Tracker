import { useSyncExternalStore } from 'react'
import { getSupabase } from './supabase'
import { hasSupabase } from './config'
import {
  applyHealthRow, applyWeightRow, exercisesForDate, foodForDate, getState, markClean, markWeightsDirty, onLocalChange, updateSettings, upsertExercise, upsertFood,
} from '../data/store'
import type { Exercise, FoodEntry, HealthDay, WeightEntry } from '../data/types'
import { summarizeDay } from '../domain/day'
import { isValidProfile } from '../domain/energy'
import { dayTarget, isValidTarget, TARGET_PRESETS, type GoalPhase } from '../domain/goal'
import { uploadPendingPhotos } from './photos'
import { isValidStepGoal } from '../domain/steps'
import { healthDeviceOf } from '../domain/routine'

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
  origin: e.origin ?? 'manual',
  started_at: e.started_at ?? null,
  ended_at: e.ended_at ?? null,
  source_app: e.source_app ?? null,
  title: e.title ?? null,
  reported_kcal: e.reported_kcal ?? null,
  outside_health: Boolean(e.outside_health),
  created_at: e.created_at,
  updated_at: e.updated_at,
  deleted_at: e.deleted ? e.updated_at : null,
})
/** columns added by 20261012000000_health_energy_workouts.sql — left out until the database has them */
const HEALTH_EX_COLUMNS = ['origin', 'started_at', 'ended_at', 'source_app', 'title', 'reported_kcal', 'outside_health'] as const
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
  origin: r.origin === 'apple_health' ? 'apple_health' : undefined,
  started_at: r.started_at ?? undefined,
  ended_at: r.ended_at ?? undefined,
  source_app: r.source_app ?? undefined,
  title: r.title ?? undefined,
  reported_kcal: r.reported_kcal != null ? Number(r.reported_kcal) : undefined,
  outside_health: r.outside_health ? true : undefined,
  created_at: r.created_at,
  updated_at: r.updated_at,
  deleted: Boolean(r.deleted_at),
})

type HealthRow = Pick<HealthDay, 'date' | 'steps' | 'source' | 'updated_at'> & { active_kcal?: number | string | null; resting_kcal?: number | string | null; health_as_of?: string | null }
const numOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))

interface WeightRow { date: string; weight_kg: number | string; created_at: string; updated_at: string; deleted_at: string | null }
/**
 * Only a missing table (20261015000000_body_weight.sql not applied) keeps weights on the device
 * quietly. Every other error — permissions, an expired login, a refused value — is a real
 * failure: it is thrown and shown, and the entry stays dirty for the next attempt.
 */
const weightsTableMissing = (e: { code?: string; message?: string } | null) => Boolean(e && (e.code === 'PGRST205' || e.code === '42P01'))

const sentVersion = <T extends { updated_at: string }>(recs: T[], key: (r: T) => string) => recs.map((r) => ({ key: key(r), updated_at: r.updated_at }))

const weightToRow = (w: WeightEntry, uid: string) => ({
  user_id: uid,
  date: w.date,
  weight_kg: w.weight_kg,
  created_at: w.created_at,
  updated_at: w.updated_at,
  deleted_at: w.deleted ? w.updated_at : null,
})

/** Upsert every weight the server hasn't confirmed. Throws on failure (the entries stay dirty). */
async function pushWeights(sb: NonNullable<Awaited<ReturnType<typeof getSupabase>>>, userId: string) {
  const dirty = Object.values(getState().weights).filter((w) => w.dirty)
  if (!dirty.length) return
  const { error } = await sb.from('mz_weights').upsert(dirty.map((w) => weightToRow(w, userId)), { onConflict: 'user_id,date' })
  if (error && weightsTableMissing(error)) return
  if (error) throw error
  if (getState().userId === userId) markClean('weights', sentVersion(dirty, (w) => w.date))
}

export type WeightSaveResult = { ok: true } | { ok: false; offline: boolean; message: string }

/** Hebrew reason for a failed save — never a raw error. */
function saveErrorMessage(e: unknown): string {
  const err = e as { code?: string; message?: string; status?: number }
  const msg = err?.message ?? ''
  if (err?.code === '42501' || /row-level security/i.test(msg)) return 'אין הרשאה לשמור בחשבון הזה — נסה להתחבר מחדש'
  if (err?.code === 'PGRST301' || err?.code === 'PGRST303' || /jwt/i.test(msg)) return 'ההתחברות פגה — התחבר מחדש כדי לשמור'
  if (err?.code === '23514') return 'השרת לא קיבל את הערך (משקל בין 20 ל-400 ק״ג)'
  if (/fetch|network|load failed/i.test(msg)) return 'אין חיבור לשרת'
  return 'השמירה לשרת נכשלה'
}

/**
 * Save the weight log to the account right now and report what really happened, so the UI
 * says "נשמר" only once the database has the entry. The entry is already on this device;
 * on failure it stays dirty and every later sync retries it.
 */
export async function pushWeightsNow(): Promise<WeightSaveResult> {
  const userId = currentUser()
  // local mode (no account configured): the device is the only store, nothing to confirm
  if (!hasSupabase || !userId) return { ok: true }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ok: false, offline: true, message: 'אין רשת — נשמר במכשיר ויישלח כשהחיבור יחזור' }
  try {
    const sb = await getSupabase()
    if (!sb) return { ok: false, offline: true, message: 'שמור במכשיר הזה בלבד' }
    await pushWeights(sb, userId)
    return { ok: true }
  } catch (e) {
    console.warn('weight save failed', e)
    const message = saveErrorMessage(e)
    return { ok: false, offline: message === 'אין חיבור לשרת', message }
  }
}

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
  for (const d of summaryRefresh) touchedDates.add(d)

  if (dirtyFood.length) {
    const { error } = await sb.from('mz_food_entries').upsert(dirtyFood.map((f) => foodToRow(f, userId!)))
    if (error) throw error
    markClean('food', sentVersion(dirtyFood, (f) => f.id))
  }
  if (dirtyEx.length) {
    const rows = dirtyEx.map((e) => exToRow(e, userId!))
    let { error } = await sb.from('mz_exercises').upsert(rows)
    if (error && HEALTH_EX_COLUMNS.some((c) => error!.message?.includes(c))) {
      // database not migrated yet: keep manual logging working
      ;({ error } = await sb.from('mz_exercises').upsert(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !(HEALTH_EX_COLUMNS as readonly string[]).includes(k))))))
    }
    if (error) throw error
    markClean('exercise', sentVersion(dirtyEx, (e) => e.id))
  }
  if (dirtyHealth.length) {
    const { error } = await sb.from('mz_health_data').upsert(
      dirtyHealth.map((h) => ({ user_id: userId, date: h.date, steps: h.steps, source: h.source, updated_at: h.updated_at })),
      { onConflict: 'user_id,date' },
    )
    if (error) throw error
    markClean('health', sentVersion(dirtyHealth, (h) => h.date))
  }
  await pushWeights(sb, userId)

  // cached per-day numbers in mz_daily_summaries (a server-side copy of what the app shows).
  // Rewritten whenever a day's inputs change here — food, workouts, steps — and also when a
  // day's Apple Health energy arrives from the server, so the copy never keeps an old burn.
  if (touchedDates.size) {
    const st = getState()
    const rows = [...touchedDates].map((date) => {
      const sum = summarizeDay({
        date,
        food: foodForDate(st, date),
        exercises: exercisesForDate(st, date),
        steps: st.health[date]?.steps ?? 0,
        health: st.health[date],
        profile: st.settings.profile,
        proteinTarget: st.settings.proteinTarget,
        target: dayTarget(st.settings),
        phoneOnly: healthDeviceOf(st.settings, Object.values(st.exercise)) === 'phone',
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
    const { error } = await sb.from('mz_daily_summaries').upsert(rows, { onConflict: 'user_id,date' })
    if (!error) {
      for (const d of touchedDates) summaryRefresh.delete(d)
      if (getState().settings.summariesVersion !== SUMMARIES_VERSION) updateSettings({ summariesVersion: SUMMARIES_VERSION })
    }
  }
}

/** Days whose cached summary must be rewritten on the next push (Apple Health data arrived, …). */
const summaryRefresh = new Set<string>()
/**
 * Bumped when summaries written by older versions may be stale: version 4 = office hours in the routine;
 * version 3 = daily-routine movement
 * for iPhone-only users; version 2 = summaries now follow
 * Apple Health energy that arrives after the day was logged (older ones kept the first estimate).
 */
const SUMMARIES_VERSION = 4

function queueSummaryBackfill() {
  const st = getState()
  if (st.settings.summariesVersion === SUMMARIES_VERSION) return
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  for (const f of Object.values(st.food)) if (f.date >= since) summaryRefresh.add(f.date)
}

async function pull() {
  const sb = await getSupabase()
  const userId = currentUser()
  if (!sb || !userId) return
  const since = getState().settings.lastPulledAt
  // small overlap so clock skew never drops a row
  const sinceIso = since ? new Date(new Date(since).getTime() - 120_000).toISOString() : '1970-01-01T00:00:00Z'
  const startedAt = new Date().toISOString()

  const [food, ex, health, weights] = await Promise.all([
    sb.from('mz_food_entries').select('*').eq('user_id', userId).gt('updated_at', sinceIso).limit(5000),
    sb.from('mz_exercises').select('*').eq('user_id', userId).gt('updated_at', sinceIso).limit(5000),
    sb.from('mz_health_data').select('*').eq('user_id', userId).gt('updated_at', sinceIso).limit(5000),
    // the weight log is small (one row a day): always read all of it, so an entry that reached the
    // server late (offline device, wrong clock) or never reached it is found either way
    sb.from('mz_weights').select('date, weight_kg, created_at, updated_at, deleted_at').eq('user_id', userId).limit(10000),
  ])
  if (food.error) throw food.error
  if (ex.error) throw ex.error
  if (health.error) throw health.error
  if (weights.error && !weightsTableMissing(weights.error)) throw weights.error

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
  for (const row of (health.data ?? []) as HealthRow[]) {
    const local = s.health[row.date]
    if (local && local.updated_at >= row.updated_at) continue
    summaryRefresh.add(row.date)
    applyHealthRow({
      date: row.date,
      steps: Number(row.steps) || 0,
      source: row.source,
      updated_at: row.updated_at,
      active_kcal: numOrNull(row.active_kcal),
      resting_kcal: numOrNull(row.resting_kcal),
      health_as_of: row.health_as_of ?? null,
    })
  }
  if (!weights.error) reconcileWeights((weights.data ?? []) as WeightRow[])
  updateSettings({ lastPulledAt: startedAt })
  queueSummaryBackfill()
}

/**
 * The server's weight log against this device's: the newer version of each day wins.
 * Server newer → applied here. Local newer, or a day the server never got → pushed again
 * (recovers entries a device kept but never managed to send). Nothing is ever duplicated:
 * the key is the day.
 */
function reconcileWeights(rows: WeightRow[]) {
  const s = getState()
  const server = new Map(rows.map((r) => [r.date, r]))
  // timestamps come back as "…+00:00" and are kept as "…Z": compare instants, not strings
  const at = (iso: string) => Date.parse(iso)
  for (const row of rows) {
    const local = s.weights[row.date]
    if (local && at(local.updated_at) >= at(row.updated_at)) continue
    applyWeightRow({ date: row.date, weight_kg: Number(row.weight_kg), created_at: row.created_at, updated_at: row.updated_at, deleted: Boolean(row.deleted_at) })
  }
  const resend = Object.values(s.weights)
    .filter((w) => !w.dirty)
    .filter((w) => {
      const r = server.get(w.date)
      if (!r) return !w.deleted // never reached the server
      return at(w.updated_at) > at(r.updated_at) // the server has an older version
    })
    .map((w) => w.date)
  markWeightsDirty(resend)
}

/**
 * Profile & targets live in mz_profiles (one row per account) so every device
 * of the same user computes with the same body data. Newest change wins.
 */
const TARGET_COLUMNS = ['goal_phase', 'calorie_mode', 'custom_deficit_min', 'custom_deficit_max', 'step_goal', 'health_device'] as const

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
    const custom = { min: Number(data.custom_deficit_min), max: Number(data.custom_deficit_max) }
    const phase = TARGET_PRESETS.some((t) => t.id === data.goal_phase) ? (data.goal_phase as GoalPhase) : st.goalPhase
    updateSettings({
      profile: { sex: data.sex, age: Number(data.age), heightCm: Number(data.height_cm), weightKg: Number(data.weight_kg) },
      proteinTarget: Number(data.protein_target_g ?? 120),
      deficitTarget: isValidTarget(target) ? target : st.deficitTarget,
      // columns absent before the 20261020 migration → keep what this device has
      goalPhase: phase,
      calorieMode: data.calorie_mode === 'custom' || data.calorie_mode === 'auto' ? data.calorie_mode : st.calorieMode,
      customDeficit: data.custom_deficit_min != null && data.custom_deficit_max != null && isValidTarget(custom) ? custom : st.customDeficit,
      // step_goal: null = the default goal; column absent before 20261023000100 → keep this device's
      stepGoal: data.step_goal === undefined ? st.stepGoal : isValidStepGoal(data.step_goal) ? data.step_goal : undefined,
      // health_device: null = not chosen (inferred); column absent before 20261025000000 → keep this device's
      healthDevice: data.health_device === undefined ? st.healthDevice : data.health_device === 'phone' || data.health_device === 'watch' ? data.health_device : undefined,
      profileUpdatedAt: new Date(serverAt).toISOString(),
    })
    return
  }
  if (isValidProfile(st.profile) && (!data || localAt > serverAt)) {
    const updatedAt = st.profileUpdatedAt || new Date().toISOString()
    const base = {
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
    }
    const row = {
      ...base,
      goal_phase: st.goalPhase ?? null,
      // custom without a valid band is judged as automatic on the device too (dayTarget)
      calorie_mode: st.calorieMode === 'custom' && isValidTarget(st.customDeficit) ? 'custom' : 'auto',
      custom_deficit_min: isValidTarget(st.customDeficit) ? Math.round(st.customDeficit.min) : null,
      custom_deficit_max: isValidTarget(st.customDeficit) ? Math.round(st.customDeficit.max) : null,
      step_goal: isValidStepGoal(st.stepGoal) ? st.stepGoal : null,
      health_device: st.healthDevice ?? null,
    }
    let { error: upErr } = await sb.from('mz_profiles').upsert(row)
    if (upErr && TARGET_COLUMNS.some((c) => upErr!.message?.includes(c))) {
      // database not migrated yet: the profile still syncs; the custom band stays on this device
      ;({ error: upErr } = await sb.from('mz_profiles').upsert(base))
    }
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
    // each step on its own: a refused profile must never keep food or weights from syncing
    let failed: unknown = null
    const step = async (fn: () => Promise<void>) => {
      try {
        await fn()
      } catch (e) {
        failed ??= e
      }
    }
    try {
      await step(() => syncProfile().finally(() => markProfileChecked(uid)))
      await step(push)
      await step(pull)
      await step(push) // anything that changed meanwhile
      if (failed) console.warn('sync failed', failed)
      setStatus(failed ? 'error' : 'idle')
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
  summaryRefresh.clear()
}

/** Profile/targets changed on this device: stamp and push. */
export async function pushProfile() {
  updateSettings({ profileUpdatedAt: new Date().toISOString() })
  await syncProfile().catch(() => {})
}
