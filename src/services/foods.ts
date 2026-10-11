import { getSupabase } from './supabase'
import { curatedAsDbFood, displayName, normFood, searchCurated, toDbFood, type DbFood } from '../../supabase/functions/_shared/foodMatch.ts'
import type { FoodItem } from '../../supabase/functions/_shared/schema.ts'
import type { FoodEntry } from '../data/types'

/**
 * Food search for the app: the bundled curated table answers instantly (also
 * offline); the full database (public.mz_search_foods — MoH, USDA, Israeli
 * products) is merged in when online. Duplicates are collapsed, and a
 * community entry never outranks an official record of the same relevance
 * (the ranking itself happens in SQL).
 */

export type FoodCategory =
  | 'dairy' | 'meat_fish' | 'eggs' | 'legumes_nuts' | 'grains' | 'fruit' | 'vegetables' | 'fats_sauces' | 'sweets_snacks' | 'drinks' | 'meals'

export const CATEGORIES: { id: FoodCategory; label: string }[] = [
  { id: 'dairy', label: 'חלב וגבינות' },
  { id: 'meat_fish', label: 'בשר, עוף ודגים' },
  { id: 'eggs', label: 'ביצים' },
  { id: 'grains', label: 'לחם ודגנים' },
  { id: 'legumes_nuts', label: 'קטניות ואגוזים' },
  { id: 'vegetables', label: 'ירקות' },
  { id: 'fruit', label: 'פירות' },
  { id: 'fats_sauces', label: 'שמנים ורטבים' },
  { id: 'sweets_snacks', label: 'מתוקים וחטיפים' },
  { id: 'drinks', label: 'משקאות' },
  { id: 'meals', label: 'מנות מוכנות' },
]

export interface SearchOptions {
  state?: 'raw' | 'cooked' | null
  category?: FoodCategory | null
  signal?: AbortSignal
}

export function searchLocal(q: string, opts: SearchOptions = {}): DbFood[] {
  return searchCurated(q, 15)
    .map(({ ref, score }) => curatedAsDbFood(ref, 1.5 + score))
    .filter((f) => !opts.state || f.state === 'as_sold' || f.state === opts.state)
}

export async function searchRemote(q: string, opts: SearchOptions = {}): Promise<DbFood[] | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null
  const client = await getSupabase()
  if (!client) return null
  try {
    let req = client.rpc('mz_search_foods', { q, lim: 30, want_state: opts.state ?? null, want_category: opts.category ?? null })
    req = req.abortSignal(opts.signal ? anySignal(opts.signal, AbortSignal.timeout(6000)) : AbortSignal.timeout(6000))
    const { data, error } = await req
    if (error || !Array.isArray(data)) return null
    return data.map((r: Record<string, unknown>) => toDbFood(r))
  } catch {
    return null
  }
}

function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  const c = new AbortController()
  const abort = () => c.abort()
  if (a.aborted || b.aborted) c.abort()
  a.addEventListener('abort', abort, { once: true })
  b.addEventListener('abort', abort, { once: true })
  return c.signal
}

/** Merge instant local hits with database rows; one row per food. */
export function mergeResults(local: DbFood[], remote: DbFood[] | null, opts: SearchOptions = {}): DbFood[] {
  const out: DbFood[] = []
  const ids = new Set<string>()
  const sig = new Set<string>()
  const push = (f: DbFood) => {
    const key = f.curated_key ? `cur:${f.curated_key}` : f.id
    const s = `${normFood(displayName(f))}|${Math.round(f.kcal)}`
    if (ids.has(key) || sig.has(s)) return
    ids.add(key)
    sig.add(s)
    out.push(f)
  }
  const localFiltered = opts.category ? [] : local
  if (remote) {
    // database order already blends relevance and reliability; local curated hits the server missed go first
    for (const f of localFiltered) if (!remote.some((r) => r.curated_key === f.curated_key)) push(f)
    for (const f of remote) push(f)
  } else {
    for (const f of localFiltered) push(f)
  }
  return out.slice(0, 40)
}

/** Foods the user logged before, most recent first, with how often (for the empty search screen). */
export function recentFoods(entries: FoodEntry[], limit = 12): { item: FoodItem; count: number }[] {
  const map = new Map<string, { item: FoodItem; count: number; at: string }>()
  for (const e of entries) {
    if (e.deleted || e.status !== 'ok') continue
    for (const it of e.items) {
      const key = it.ref ?? (it.db_key ? `cur:${it.db_key}` : `name:${it.name}`)
      const cur = map.get(key)
      if (cur) {
        cur.count++
        if (e.created_at > cur.at) Object.assign(cur, { item: it, at: e.created_at })
      } else map.set(key, { item: it, count: 1, at: e.created_at })
    }
  }
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit).map(({ item, count }) => ({ item, count }))
}
