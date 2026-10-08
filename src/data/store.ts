import { useSyncExternalStore } from 'react'
import { getAll, putMany, clearAll, dbNameFor, dropDatabase, LEGACY_DB, useDatabase } from './idb'
import { DEFAULT_SETTINGS, type Exercise, type FoodEntry, type HealthDay, type Settings } from './types'

/**
 * Local-first store. Everything renders from memory; IndexedDB persists
 * records, localStorage persists the tiny settings object (synchronous, so
 * the first paint already knows the profile). The sync engine (sync.ts)
 * pushes `dirty` records to Supabase when configured and online.
 *
 * Each account has its own IndexedDB database and settings key, so accounts
 * sharing a device are isolated locally as well (the server enforces it with
 * RLS). Local mode (no backend configured) uses the original unsuffixed keys.
 */

export interface State {
  ready: boolean
  /** the signed-in account, or null in local mode */
  userId: string | null
  settings: Settings
  food: Record<string, FoodEntry>
  exercise: Record<string, Exercise>
  health: Record<string, HealthDay>
}

const LEGACY_SETTINGS_KEY = 'maazan:settings'
const settingsKeyFor = (userId: string | null) => (userId ? `maazan:settings:${userId}` : LEGACY_SETTINGS_KEY)
let settingsKey = LEGACY_SETTINGS_KEY

function readSettings(key: string): Settings | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* private mode etc. */
  }
  return null
}

function loadSettings(key: string): Settings {
  return readSettings(key) ?? { ...DEFAULT_SETTINGS }
}

let state: State = { ready: false, userId: null, settings: { ...DEFAULT_SETTINGS }, food: {}, exercise: {}, health: {} }
const listeners = new Set<() => void>()
const changeHooks = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function getState(): State {
  return state
}

export function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Called after any local data change (used by sync to schedule a push). */
export function onLocalChange(fn: () => void): () => void {
  changeHooks.add(fn)
  return () => changeHooks.delete(fn)
}

function localChanged() {
  for (const h of changeHooks) h()
}

/** Ask the sync engine to push soon (e.g. a photo was queued for upload). */
export function notifyLocalChange() {
  localChanged()
}

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

const byId = <T extends { id: string }>(arr: T[]) => Object.fromEntries(arr.map((x) => [x.id, x]))

/** Load the local copy for an account (or local mode when userId is null). */
export async function initStore(userId: string | null = null): Promise<void> {
  settingsKey = settingsKeyFor(userId)
  useDatabase(dbNameFor(userId))
  // render settings immediately; records follow from IndexedDB
  state = { ready: false, userId, settings: loadSettings(settingsKey), food: {}, exercise: {}, health: {} }
  emit()
  const [food, exercise, health] = await Promise.all([
    getAll<FoodEntry>('food'),
    getAll<Exercise>('exercise'),
    getAll<HealthDay>('health'),
  ])
  if (state.userId !== userId) return // account switched meanwhile
  state = {
    ...state,
    ready: true,
    food: byId(food),
    exercise: byId(exercise),
    health: Object.fromEntries(health.map((h) => [h.date, h])),
  }
  emit()
}

/** Forget the in-memory account (logout). */
export function resetStore() {
  state = { ready: false, userId: null, settings: { ...DEFAULT_SETTINGS }, food: {}, exercise: {}, health: {} }
  settingsKey = LEGACY_SETTINGS_KEY
  useDatabase(LEGACY_DB)
  emit()
}

/** True when the account's local copy has changes the server hasn't received. */
export function hasUnsyncedChanges(s: State = state): boolean {
  return [...Object.values(s.food), ...Object.values(s.exercise), ...Object.values(s.health)].some((r) => r.dirty)
}

/** Delete an account's local copy from this device (after logout, once everything is synced). */
export async function dropLocalAccount(userId: string) {
  await dropDatabase(dbNameFor(userId))
  try {
    localStorage.removeItem(settingsKeyFor(userId))
  } catch {
    /* ignore */
  }
}

// ── one-time import of data saved before accounts existed ─────────────────

const LEGACY_DECIDED_KEY = 'maazan:legacy-decided'

export interface LegacySummary {
  food: number
  exercise: number
  days: number
  hasProfile: boolean
}

/** Data from the single-owner era still on this device, if the user hasn't decided about it yet. */
export async function legacyDataSummary(): Promise<LegacySummary | null> {
  try {
    if (localStorage.getItem(LEGACY_DECIDED_KEY)) return null
  } catch {
    return null
  }
  const [food, exercise, health] = await Promise.all([
    getAll<FoodEntry>('food', LEGACY_DB),
    getAll<Exercise>('exercise', LEGACY_DB),
    getAll<HealthDay>('health', LEGACY_DB),
  ])
  const legacySettings = readSettings(LEGACY_SETTINGS_KEY)
  const summary = {
    food: food.filter((f) => !f.deleted).length,
    exercise: exercise.filter((e) => !e.deleted).length,
    days: health.length,
    hasProfile: Boolean(legacySettings?.profile),
  }
  if (!summary.food && !summary.exercise && !summary.days && !summary.hasProfile) return null
  return summary
}

export function decideLegacy() {
  try {
    localStorage.setItem(LEGACY_DECIDED_KEY, new Date().toISOString())
  } catch {
    /* ignore */
  }
}

/** Copy the pre-account data into the signed-in account (marked dirty so it syncs). */
export async function importLegacyData(): Promise<number> {
  const [food, exercise, health] = await Promise.all([
    getAll<FoodEntry>('food', LEGACY_DB),
    getAll<Exercise>('exercise', LEGACY_DB),
    getAll<HealthDay>('health', LEGACY_DB),
  ])
  const t = now()
  const f = food.map((r) => ({ ...r, updated_at: t, dirty: true }))
  const e = exercise.map((r) => ({ ...r, updated_at: t, dirty: true }))
  // keep the newer copy of a day's steps if the account already has one
  const h = health.filter((r) => !state.health[r.date] || state.health[r.date].updated_at < r.updated_at).map((r) => ({ ...r, dirty: true }))
  await Promise.all([putMany('food', f), putMany('exercise', e), putMany('health', h)])
  state = {
    ...state,
    food: { ...state.food, ...byId(f) },
    exercise: { ...state.exercise, ...byId(e) },
    health: { ...state.health, ...Object.fromEntries(h.map((r) => [r.date, r])) },
  }
  const legacySettings = readSettings(LEGACY_SETTINGS_KEY)
  if (legacySettings?.profile && !state.settings.profile) {
    updateSettings({ profile: legacySettings.profile, proteinTarget: legacySettings.proteinTarget, profileUpdatedAt: t })
  }
  decideLegacy()
  emit()
  localChanged()
  return f.length + e.length + h.length
}

const now = () => new Date().toISOString()

// ── settings ──────────────────────────────────────────────────────────────

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, settings: { ...state.settings, ...patch } }
  try {
    localStorage.setItem(settingsKey, JSON.stringify(state.settings))
  } catch {
    /* ignore */
  }
  emit()
}

// ── food ──────────────────────────────────────────────────────────────────

export function upsertFood(entry: FoodEntry, opts: { fromServer?: boolean } = {}) {
  const rec: FoodEntry = opts.fromServer ? { ...entry, dirty: false } : { ...entry, updated_at: now(), dirty: true }
  state = { ...state, food: { ...state.food, [rec.id]: rec } }
  emit()
  void putMany('food', [rec])
  if (!opts.fromServer) localChanged()
}

export function deleteFood(id: string) {
  const cur = state.food[id]
  if (!cur) return
  upsertFood({ ...cur, deleted: true })
}

export function restoreFood(id: string) {
  const cur = state.food[id]
  if (!cur) return
  upsertFood({ ...cur, deleted: false })
}

// ── exercise ──────────────────────────────────────────────────────────────

export function upsertExercise(ex: Exercise, opts: { fromServer?: boolean } = {}) {
  const rec: Exercise = opts.fromServer ? { ...ex, dirty: false } : { ...ex, updated_at: now(), dirty: true }
  state = { ...state, exercise: { ...state.exercise, [rec.id]: rec } }
  emit()
  void putMany('exercise', [rec])
  if (!opts.fromServer) localChanged()
}

export function deleteExercise(id: string) {
  const cur = state.exercise[id]
  if (cur) upsertExercise({ ...cur, deleted: true })
}

// ── health ────────────────────────────────────────────────────────────────

export function setSteps(date: string, steps: number, source: HealthDay['source'], opts: { fromServer?: boolean; updatedAt?: string } = {}) {
  const rec: HealthDay = {
    date,
    steps: Math.max(0, Math.round(steps)),
    source,
    updated_at: opts.updatedAt ?? now(),
    dirty: !opts.fromServer,
  }
  state = { ...state, health: { ...state.health, [date]: rec } }
  emit()
  void putMany('health', [rec])
  if (!opts.fromServer) localChanged()
}

export function markClean(kind: 'food' | 'exercise' | 'health', ids: string[]) {
  if (!ids.length) return
  const coll = { ...state[kind] } as Record<string, { dirty?: boolean }>
  const changed: unknown[] = []
  for (const id of ids) {
    if (coll[id]) {
      coll[id] = { ...coll[id], dirty: false }
      changed.push(coll[id])
    }
  }
  state = { ...state, [kind]: coll }
  void putMany(kind, changed)
}

export async function wipeLocalData() {
  await clearAll()
  state = { ...state, food: {}, exercise: {}, health: {} }
  emit()
}

// ── selectors ─────────────────────────────────────────────────────────────

export function foodForDate(s: Pick<State, 'food'>, date: string): FoodEntry[] {
  return Object.values(s.food)
    .filter((f) => f.date === date && !f.deleted)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export function exercisesForDate(s: Pick<State, 'exercise'>, date: string): Exercise[] {
  return Object.values(s.exercise)
    .filter((e) => e.date === date && !e.deleted)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Most recent distinct meals (by title) for one-tap re-logging. */
export function recentMeals(s: Pick<State, 'food'>, limit = 6): FoodEntry[] {
  const seen = new Set<string>()
  const out: FoodEntry[] = []
  const all = Object.values(s.food)
    .filter((f) => !f.deleted && f.status === 'ok')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const f of all) {
    const k = f.title.trim()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(f)
    if (out.length >= limit) break
  }
  return out
}
