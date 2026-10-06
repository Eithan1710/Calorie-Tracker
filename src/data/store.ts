import { useSyncExternalStore } from 'react'
import { getAll, putMany, clearAll } from './idb'
import { DEFAULT_SETTINGS, type Exercise, type FoodEntry, type HealthDay, type Settings } from './types'

/**
 * Local-first store. Everything renders from memory; IndexedDB persists
 * records, localStorage persists the tiny settings object (synchronous, so
 * the first paint already knows the profile). The sync engine (sync.ts)
 * pushes `dirty` records to Supabase when configured and online.
 */

export interface State {
  ready: boolean
  settings: Settings
  food: Record<string, FoodEntry>
  exercise: Record<string, Exercise>
  health: Record<string, HealthDay>
}

const SETTINGS_KEY = 'maazan:settings'

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    /* private mode etc. */
  }
  return { ...DEFAULT_SETTINGS }
}

let state: State = { ready: false, settings: loadSettings(), food: {}, exercise: {}, health: {} }
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

export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

const byId = <T extends { id: string }>(arr: T[]) => Object.fromEntries(arr.map((x) => [x.id, x]))

export async function initStore(): Promise<void> {
  const [food, exercise, health] = await Promise.all([
    getAll<FoodEntry>('food'),
    getAll<Exercise>('exercise'),
    getAll<HealthDay>('health'),
  ])
  state = {
    ...state,
    ready: true,
    food: byId(food),
    exercise: byId(exercise),
    health: Object.fromEntries(health.map((h) => [h.date, h])),
  }
  emit()
}

const now = () => new Date().toISOString()

// ── settings ──────────────────────────────────────────────────────────────

export function updateSettings(patch: Partial<Settings>) {
  state = { ...state, settings: { ...state.settings, ...patch } }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings))
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

export function foodForDate(s: State, date: string): FoodEntry[] {
  return Object.values(s.food)
    .filter((f) => f.date === date && !f.deleted)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export function exercisesForDate(s: State, date: string): Exercise[] {
  return Object.values(s.exercise)
    .filter((e) => e.date === date && !e.deleted)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** Most recent distinct meals (by title) for one-tap re-logging. */
export function recentMeals(s: State, limit = 6): FoodEntry[] {
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
