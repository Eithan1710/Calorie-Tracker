/**
 * "What could I eat now?" — suggestions drawn ONLY from the user's own food log.
 *
 * Deterministic, on-device, no AI: the log is already on the phone, the rules are
 * simple, and nothing about the user's history leaves the device.
 *
 *  1. Time of day is a hard filter. A food is a candidate only if the user has
 *     logged it within ±WINDOW_MIN minutes of the current time of day (local
 *     time). No fallback to other meal times: too little history → say so.
 *  2. What's missing today: protein vs. the protein target; fat and carbs vs.
 *     ranges derived from the day's calorie target (fat 20–35 % of kcal, carbs
 *     = what's left after protein and fat); calories vs. the room left in the
 *     user's deficit band. Nothing missing → no suggestion.
 *  3. Eligibility (hard filter, see foodQuality.ts): only foods positively recognised as
 *     nutritious — never sweets, snacks, sugary drinks, alcohol, fast food, deep-fried or
 *     refined bakery, condiments, or anything unrecognised.
 *  4. Ranking: time closeness (gate + weight) → macro fit → calorie fit → nutritional
 *     quality → familiarity (how often, how recently) → data reliability.
 *  5. The serving is the user's own usual amount (median of the matching
 *     occurrences); nutrients are the recorded per-100 g values — never invented.
 */
import type { FoodEntry, FoodItem, Meal } from '../data/types'
import { classifyFood, type FoodClass } from './foodQuality'

/** ±minutes around "now" that count as the same time of day */
export const WINDOW_MIN = 90
/** only the recent past describes current habits */
export const HISTORY_DAYS = 90
/** food eaten this recently today is not suggested again */
export const RECENT_EXCLUDE_MIN = 180
/** below this, the time window is "not enough history" */
export const MIN_OCCURRENCES = 3
export const MIN_FOODS = 2

/** representative time for a meal label, used only for entries logged on another day than eaten */
const MEAL_MINUTES: Record<Meal, number> = { breakfast: 8 * 60, lunch: 13 * 60, snack: 16 * 60 + 30, dinner: 20 * 60 }

export interface Intake {
  calories: number
  protein_g: number
  fat_g: number
  carbs_g: number
}

export interface DayTargets {
  /** calories burned today (full-day estimate) */
  burned: number
  /** deficit band, kcal */
  deficitMin: number
  deficitMax: number
  proteinTarget: number
}

export type Level = 'low' | 'ok' | 'high'

export interface Needs {
  protein: Level
  carbs: Level
  fat: Level
  /** grams still missing to the protein target */
  proteinGap: number
  /** kcal still available before leaving the deficit band (≥ 0) */
  roomKcal: number
  /** nothing worth suggesting */
  balanced: boolean
}

export interface Suggestion {
  key: string
  name: string
  emoji?: string
  /** the recorded item (latest occurrence) and the user's usual grams */
  item: FoodItem
  grams: number
  calories: number
  protein_g: number
  fat_g: number
  carbs_g: number
  /** how many times it was logged around this time of day */
  timesAtThisHour: number
  /** nutritional class and quality (0–1) from the eligibility filter */
  cls: FoodClass
  quality: number
  score: number
}

export type SuggestResult =
  | { kind: 'suggestions'; needs: Needs; items: Suggestion[] }
  | { kind: 'balanced'; needs: Needs }
  | { kind: 'not_enough_history'; needs: Needs }
  /** foods were eaten around this time, but none is both nutritious and a fit for what's missing */
  | { kind: 'nothing_fits'; needs: Needs; excluded: number }

// ── what's missing today ────────────────────────────────────────────────────

export function dailyNeeds(intake: Intake, t: DayTargets): Needs {
  const targetKcal = Math.max(1200, t.burned - (t.deficitMin + t.deficitMax) / 2)
  const proteinGap = Math.max(0, t.proteinTarget - intake.protein_g)
  const fatLo = (0.2 * targetKcal) / 9
  const fatHi = (0.35 * targetKcal) / 9
  const fatMid = (fatLo + fatHi) / 2
  const carbTarget = Math.max(0, (targetKcal - t.proteinTarget * 4 - fatMid * 9) / 4)
  const roomKcal = Math.max(0, Math.round(t.burned - t.deficitMin - intake.calories))

  const protein: Level = proteinGap > 10 ? 'low' : 'ok'
  // "low" here = clearly below the day's range; mid-day everything is still below, so only flag
  // carbs/fat as low when protein is already handled (otherwise protein leads)
  const fat: Level = intake.fat_g > fatHi ? 'high' : intake.fat_g < fatLo && protein === 'ok' ? 'low' : 'ok'
  const carbs: Level = intake.carbs_g > carbTarget * 1.1 ? 'high' : intake.carbs_g < carbTarget * 0.6 && protein === 'ok' ? 'low' : 'ok'
  const balanced = (protein === 'ok' && fat !== 'low' && carbs !== 'low') || roomKcal < 60
  return { protein, carbs, fat, proteinGap: Math.round(proteinGap), roomKcal, balanced }
}

// ── history ────────────────────────────────────────────────────────────────

interface Occurrence {
  item: FoodItem
  minutes: number
  /** ms timestamp, for recency */
  at: number
  date: string
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
export const foodKey = (i: FoodItem) => (i.ref ? `ref:${i.ref}` : i.db_key ? `db:${i.db_key}` : `n:${norm(i.name)}`)

function localMinutes(d: Date) {
  return d.getHours() * 60 + d.getMinutes()
}
function localDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** circular distance between two times of day, minutes */
export function minuteDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440
  return Math.min(d, 1440 - d)
}

/** When was this entry eaten (time of day)? The log time, or the meal's usual time if it was logged on another day. */
export function entryMinutes(e: FoodEntry): number {
  const created = new Date(e.created_at)
  if (!Number.isNaN(created.getTime()) && localDateKey(created) === e.date) return localMinutes(created)
  return MEAL_MINUTES[e.meal]
}

function occurrences(entries: FoodEntry[], now: Date): Occurrence[] {
  const since = now.getTime() - HISTORY_DAYS * 86_400_000
  const out: Occurrence[] = []
  for (const e of entries) {
    if (e.deleted || e.status !== 'ok' || !e.items?.length) continue
    const at = Date.parse(e.created_at)
    if (Number.isNaN(at) || at < since || at > now.getTime() + 60_000) continue
    const minutes = entryMinutes(e)
    for (const item of e.items) {
      if (!(item.grams > 0) || !item.per100 || !(item.per100.kcal >= 0)) continue
      out.push({ item, minutes, at, date: e.date })
    }
  }
  return out
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function reliability(i: FoodItem): number {
  const src = i.source === 'db' || i.source === 'usda' || i.source === 'manual' ? 1 : 0.6
  return Math.max(0, Math.min(1, (i.confidence ?? 0.6) * 0.5 + src * 0.5))
}

// ── ranking ────────────────────────────────────────────────────────────────

/** typical "one meal" amounts: a gap bigger than this isn't expected from one food */
const CHUNK = { protein: 35, carbs: 60, fat: 20 }

/** −1 … +1: how well a serving addresses what's missing */
export function macroFit(m: { protein_g: number; carbs_g: number; fat_g: number }, needs: Needs): number {
  const part = (level: Level, grams: number, chunk: number, gap?: number) => {
    const x = grams / chunk
    if (level === 'low') return Math.min(1, grams / Math.max(5, Math.min(chunk, gap ?? chunk)))
    if (level === 'high') return -Math.min(1, x)
    return -0.3 * Math.max(0, x - 1) // fine already: only a big amount hurts
  }
  const p = part(needs.protein, m.protein_g, CHUNK.protein, needs.proteinGap)
  const c = part(needs.carbs, m.carbs_g, CHUNK.carbs)
  const f = part(needs.fat, m.fat_g, CHUNK.fat)
  const wP = needs.protein === 'low' ? 1 : 0.4
  return (wP * p + 0.6 * c + 0.6 * f) / (wP + 1.2)
}

/** 0 … 1: fits the calories still available */
export function calorieFit(kcal: number, roomKcal: number): number {
  if (kcal <= roomKcal) return 1
  if (roomKcal <= 0) return 0
  return Math.max(0, 1 - (kcal - roomKcal) / Math.max(kcal, 1))
}

export function suggest(opts: {
  history: FoodEntry[]
  /** today's intake so far */
  intake: Intake
  targets: DayTargets
  now?: Date
  limit?: number
}): SuggestResult {
  const now = opts.now ?? new Date()
  const needs = dailyNeeds(opts.intake, opts.targets)
  const nowMin = localMinutes(now)
  const today = localDateKey(now)

  const all = occurrences(opts.history, now)
  // time-of-day gate (strict): only occurrences around this time of day count
  const near = all.filter((o) => minuteDistance(o.minutes, nowMin) <= WINDOW_MIN)
  const byKey = new Map<string, Occurrence[]>()
  for (const o of near) {
    const k = foodKey(o.item)
    const list = byKey.get(k)
    if (list) list.push(o)
    else byKey.set(k, [o])
  }
  if (near.length < MIN_OCCURRENCES || byKey.size < MIN_FOODS) return { kind: 'not_enough_history', needs }
  if (needs.balanced) return { kind: 'balanced', needs }

  // eaten in the last few hours today → not again right now
  const recentlyEaten = new Set(
    all.filter((o) => o.date === today && now.getTime() - o.at < RECENT_EXCLUDE_MIN * 60_000).map((o) => foodKey(o.item)),
  )

  const scored: Suggestion[] = []
  let excluded = 0
  for (const [key, list] of byKey) {
    const latest = list.reduce((a, b) => (b.at > a.at ? b : a))
    const item = latest.item
    // hard filter first: nothing ranks a food in that isn't nutritious
    const q = classifyFood(item)
    if (!q.eligible) {
      excluded++
      continue
    }
    if (recentlyEaten.has(key)) continue
    const grams = Math.round(median(list.map((o) => o.item.grams)))
    const k = grams / 100
    const m = {
      calories: Math.round(item.per100.kcal * k),
      protein_g: Math.round(item.per100.protein_g * k * 10) / 10,
      fat_g: Math.round(item.per100.fat_g * k * 10) / 10,
      carbs_g: Math.round(item.per100.carbs_g * k * 10) / 10,
    }
    const fit = macroFit(m, needs)
    if (fit <= 0.05) continue // doesn't address what's missing
    const kcalFit = calorieFit(m.calories, needs.roomKcal)
    if (kcalFit === 0) continue
    const closest = Math.min(...list.map((o) => minuteDistance(o.minutes, nowMin)))
    const timeScore = 1 - 0.4 * (closest / WINDOW_MIN) // 1 at the same minute, 0.6 at the window edge
    const days = new Set(list.map((o) => o.date)).size
    const ageDays = (now.getTime() - latest.at) / 86_400_000
    const familiarity = Math.min(1, days / 4) * 0.7 + Math.max(0, 1 - ageDays / HISTORY_DAYS) * 0.3
    const score = timeScore * (0.45 * fit + 0.2 * kcalFit + 0.15 * q.quality + 0.12 * familiarity + 0.08 * reliability(item))
    scored.push({ key, name: item.name, emoji: item.emoji, item, grams, ...m, timesAtThisHour: days, cls: q.cls, quality: q.quality, score: Math.round(score * 1000) / 1000 })
  }
  scored.sort((a, b) => b.score - a.score || b.timesAtThisHour - a.timesAtThisHour || a.name.localeCompare(b.name))
  const items = scored.slice(0, opts.limit ?? 3)
  return items.length ? { kind: 'suggestions', needs, items } : { kind: 'nothing_fits', needs, excluded }
}
