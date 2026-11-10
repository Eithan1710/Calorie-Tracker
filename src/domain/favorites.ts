/**
 * Favourite meals: drinks and snacks logged again and again (a coffee with a teaspoon of sugar).
 * A favourite is a frozen copy of a logged meal; one tap logs a fresh copy of it.
 * Kept on the profile (mz_profiles.favorites) so every device shows the same list.
 */
import type { FoodEntry, FoodItem, Meal, Totals } from '../data/types'

export interface Favorite {
  id: string
  title: string
  emoji: string
  /** the meal's items, without per-entry ids */
  items: Omit<FoodItem, 'id'>[]
  totals: Totals
  confidence: number
  provider: string
}

export const MAX_FAVORITES = 12

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export const isValidFavorite = (f: unknown): f is Favorite =>
  isObj(f) &&
  typeof f.id === 'string' &&
  typeof f.title === 'string' &&
  f.title.trim().length > 0 &&
  typeof f.emoji === 'string' &&
  Array.isArray(f.items) &&
  f.items.length > 0 &&
  isObj(f.totals) &&
  Number.isFinite(Number((f.totals as Record<string, unknown>).calories))

/** The valid favourites of a stored list (anything else → empty). */
export const favoritesOf = (v: unknown): Favorite[] => (Array.isArray(v) ? v.filter(isValidFavorite).slice(0, MAX_FAVORITES) : [])

const key = (title: string) => title.trim()

/** Is this logged meal one of the favourites (same title)? */
export const findFavorite = (list: Favorite[] | undefined, title: string) => (list ?? []).find((f) => key(f.title) === key(title))

export function favoriteFromEntry(e: Pick<FoodEntry, 'title' | 'emoji' | 'items' | 'totals' | 'confidence' | 'provider'>, id: string): Favorite {
  return {
    id,
    title: e.title.trim(),
    emoji: e.emoji,
    // without the per-entry ids: every logged copy gets its own
    items: e.items.map(({ id: _id, ...rest }) => rest),
    totals: e.totals,
    confidence: e.confidence,
    provider: e.provider,
  }
}

/** Add (newest first, replacing one with the same title) or remove. */
export function toggleFavorite(list: Favorite[] | undefined, fav: Favorite): Favorite[] {
  const cur = list ?? []
  if (findFavorite(cur, fav.title)) return cur.filter((f) => key(f.title) !== key(fav.title))
  return [fav, ...cur].slice(0, MAX_FAVORITES)
}

/** A new log entry from a favourite. */
export function entryFromFavorite(f: Favorite, o: { id: string; itemId: () => string; date: string; meal: Meal; now: string }): FoodEntry {
  return {
    id: o.id,
    date: o.date,
    meal: o.meal,
    title: f.title,
    emoji: f.emoji,
    items: f.items.map((i) => ({ ...i, id: o.itemId() })),
    totals: f.totals,
    confidence: f.confidence,
    provider: f.provider,
    status: 'ok',
    created_at: o.now,
    updated_at: o.now,
    dirty: true,
    deleted: false,
  }
}
