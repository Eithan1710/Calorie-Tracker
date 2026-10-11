import type { FoodItem, Per100 } from './schema.ts'
import { FOOD_BY_KEY, FOODS, type FoodRef, type Verification } from './foodDb.ts'
import { newId, per100FromRef, provenanceFromRef, scale } from './nutrition.ts'

/**
 * Matching a described food to a database record — shared by the edge function
 * (AI items → mz_foods) and the app (search box). Pure functions, no I/O.
 */

/** A row of public.mz_search_foods (numbers may arrive as strings from PostgREST). */
export interface DbFood {
  id: string
  source: 'curated' | 'moh' | 'usda' | 'off'
  verification: Verification
  name_he: string | null
  name_en: string | null
  brand: string | null
  barcode?: string | null
  category?: string | null
  state: 'raw' | 'cooked' | 'as_sold'
  fat_added: boolean
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
  fiber_g?: number | null
  sugar_g?: number | null
  sat_fat_g?: number | null
  sodium_mg?: number | null
  servings: [string, number][]
  source_ref?: string | null
  source_url?: string | null
  source_updated?: string | null
  curated_key?: string | null
  quality_flags?: string[] | null
  score: number
}

export type SearchFoods = (q: string, opts?: { state?: 'raw' | 'cooked' | null; limit?: number }) => Promise<DbFood[]>

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** Normalise an RPC row (PostgREST may send numerics as strings). */
export function toDbFood(r: Record<string, unknown>): DbFood {
  return {
    ...(r as unknown as DbFood),
    kcal: n(r.kcal) ?? 0,
    protein_g: n(r.protein_g) ?? 0,
    fat_g: n(r.fat_g) ?? 0,
    carbs_g: n(r.carbs_g) ?? 0,
    fiber_g: n(r.fiber_g),
    sugar_g: n(r.sugar_g),
    sat_fat_g: n(r.sat_fat_g),
    sodium_mg: n(r.sodium_mg),
    score: n(r.score) ?? 0,
    servings: Array.isArray(r.servings) ? (r.servings as [string, number][]).map(([l, g]) => [String(l), Number(g)] as [string, number]) : [],
    quality_flags: Array.isArray(r.quality_flags) ? (r.quality_flags as string[]) : [],
  }
}

export function per100FromDb(f: DbFood): Per100 {
  return withExtras({ kcal: f.kcal, protein_g: f.protein_g, fat_g: f.fat_g, carbs_g: f.carbs_g }, f.fiber_g, f.sugar_g, f.sat_fat_g, f.sodium_mg)
}

export function per100FromCurated(ref: FoodRef): Per100 {
  return withExtras({ kcal: ref.kcal, protein_g: ref.p, fat_g: ref.f, carbs_g: ref.c }, ref.fib, ref.sug, ref.sat, ref.na)
}

function withExtras(p: Per100, fib?: number | null, sug?: number | null, sat?: number | null, na?: number | null): Per100 {
  const out: Per100 = { ...p }
  if (fib !== null && fib !== undefined) out.fiber_g = fib
  if (sug !== null && sug !== undefined) out.sugar_g = sug
  if (sat !== null && sat !== undefined) out.sat_fat_g = sat
  if (na !== null && na !== undefined) out.sodium_mg = na
  return out
}

export function displayName(f: DbFood): string {
  const base = f.name_he || f.name_en || f.id
  return f.brand && !base.includes(f.brand) ? `${base} · ${f.brand}` : base
}

// ── text normalisation (mirrors public.mz_norm in SQL) ────────────────────────
export function normFood(s: string | null | undefined): string {
  return (s ?? '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/['"`´‘’׳״]/g, '')
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (c) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[c]!)
    .replace(/[^0-9a-zא-ת%.]+/g, ' ')
    .trim()
}

// ── choosing a record for an AI-described item ───────────────────────────────

export interface MatchTarget {
  name_he: string
  name_en?: string
  brand?: string | null
  state: 'raw' | 'cooked' | 'as_sold' | 'unknown'
  est_per100?: Per100 | null
}

export interface MatchContext {
  /** the meal lists oil/butter separately with an amount the user gave */
  statedOil: boolean
}

export interface Match {
  food: DbFood
  /** extra Hebrew notes for the item's assumptions */
  notes: string[]
  /** 0..1 multiplier for the item's confidence */
  confidence: number
}

const kcalTolerance = (a: number, b: number) => Math.max(60, 0.45 * Math.max(a, b))

/**
 * Pick the most plausible record. Rejects records whose energy disagrees badly
 * with the model's own estimate (a wrong-food match is worse than an estimate),
 * prefers the stated brand and state, and avoids "fried in oil" records when the
 * oil is already logged separately.
 */
export function pickCandidate(cands: DbFood[], t: MatchTarget, ctx: MatchContext): Match | null {
  const brand = normFood(t.brand)
  const brandTokens = brand ? brand.split(' ').filter((w) => w.length >= 2) : []
  let best: { c: DbFood; s: number; brandHit: boolean } | null = null
  for (const c of cands) {
    let s = c.score
    if (c.quality_flags?.length) s -= 0.2
    if (t.est_per100) {
      const diff = Math.abs(c.kcal - t.est_per100.kcal)
      const tol = kcalTolerance(c.kcal, t.est_per100.kcal)
      if (diff > tol) continue
      s += 0.12 * (1 - diff / tol)
    }
    if ((t.state === 'raw' || t.state === 'cooked') && c.state !== 'as_sold' && c.state !== t.state) s -= 0.35
    if (ctx.statedOil && c.fat_added) s -= 0.2
    let brandHit = false
    if (brandTokens.length) {
      const hay = normFood(`${c.name_he ?? ''} ${c.name_en ?? ''} ${c.brand ?? ''}`)
      brandHit = brandTokens.every((w) => hay.includes(w))
      s += brandHit ? 0.3 : -0.05
    }
    if (!best || s > best.s) best = { c, s, brandHit }
  }
  if (!best || best.s < 0.8) return null
  const notes: string[] = []
  let confidence = 1
  if (brandTokens.length && !best.brandHit) {
    notes.push(`לא נמצא המוצר המדויק של ${t.brand} — לפי מוצר דומה`)
    confidence = 0.8
  }
  if (best.c.verification === 'community') {
    notes.push('ערכים מ-Open Food Facts (לא מאומתים)')
    confidence = Math.min(confidence, 0.8)
  }
  return { food: best.c, notes, confidence }
}

/** Search phrase for the database: the Hebrew name, with the brand when given. */
export function searchPhrase(t: MatchTarget): string {
  const name = t.name_he.replace(/\s*\(.*?\)\s*/g, ' ').trim()
  return t.brand && !normFood(name).includes(normFood(t.brand)) ? `${name} ${t.brand}` : name
}

// ── local (offline) search over the curated table ────────────────────────────

const PREFIXES = ['וה', 'ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ']
interface Indexed { ref: FoodRef; names: string[]; hay: string }
let INDEX: Indexed[] | null = null
function index(): Indexed[] {
  INDEX ??= FOODS.map((ref) => {
    const names = [ref.he, ...ref.aliases, ref.en].map(normFood)
    return { ref, names, hay: names.join(' | ') }
  })
  return INDEX
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length > b.length) i++
    else if (a.length < b.length) j++
    else { i++; j++ }
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function tokenHit(tok: string, hay: string, words: string[]): number {
  if (hay.includes(tok)) return 1
  for (const p of PREFIXES) if (tok.startsWith(p) && tok.length - p.length >= 2 && hay.includes(tok.slice(p.length))) return 0.9
  if (tok.length >= 4 && words.some((w) => w.length >= 3 && editDistanceAtMost1(tok, w))) return 0.7
  return 0
}

/** Instant search over the bundled curated foods (works offline). */
export function searchCurated(q: string, limit = 12): { ref: FoodRef; score: number }[] {
  const nq = normFood(q)
  if (nq.length < 2) return []
  const toks = nq.split(' ').filter((w) => w.length >= 2 && !/^\d+(\.\d+)?$/.test(w))
  if (!toks.length) return []
  const out: { ref: FoodRef; score: number }[] = []
  for (const it of index()) {
    const words = it.hay.split(/[ |]+/)
    let cov = 0
    for (const t of toks) cov += tokenHit(t, it.hay, words)
    cov /= toks.length
    if (cov < 0.6) continue
    let s = cov
    if (it.names.some((nm) => nm === nq)) s += 0.5
    else if (it.names.some((nm) => nm.startsWith(nq))) s += 0.25
    s -= 0.004 * it.ref.he.length
    out.push({ ref: it.ref, score: s })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Present a curated food in the same shape as a database row. */
export function curatedAsDbFood(ref: FoodRef, score = 2): DbFood {
  return {
    id: `cur:${ref.key}`,
    source: 'curated',
    verification: ref.verification,
    name_he: ref.he,
    name_en: ref.en,
    brand: null,
    state: ref.state,
    fat_added: Boolean(ref.fat_added),
    kcal: ref.kcal,
    protein_g: ref.p,
    fat_g: ref.f,
    carbs_g: ref.c,
    fiber_g: ref.fib ?? null,
    sugar_g: ref.sug ?? null,
    sat_fat_g: ref.sat ?? null,
    sodium_mg: ref.na ?? null,
    servings: Object.entries(ref.units).filter(([k]) => k !== 'serving').map(([k, g]) => [k, g as number]),
    source_ref: ref.ref ?? null,
    curated_key: ref.key,
    quality_flags: ref.flags ?? [],
    score,
  }
}

export const curatedFor = (f: DbFood): FoodRef | undefined => (f.curated_key ? FOOD_BY_KEY[f.curated_key] : undefined)

/** A log item from a chosen database record and an amount (search box / swap). */
export function itemFromDb(f: DbFood, grams: number, basis: 'stated' | 'counted' | 'estimated' = 'stated'): FoodItem {
  const cur = curatedFor(f)
  const per100 = cur ? per100FromRef(cur) : per100FromDb(f)
  const g = Math.max(0, Math.round(grams))
  const v = cur?.verification ?? f.verification
  const base = v === 'community' ? 0.75 : v === 'estimate' ? 0.6 : 0.95
  return {
    id: newId(),
    name: cur ? cur.he : displayName(f),
    grams: g,
    per100,
    ...scale(per100, g),
    confidence: basis === 'stated' ? base : Math.min(base, 0.85),
    assumptions: [],
    source: f.source === 'usda' ? 'usda' : 'db',
    db_key: cur?.key ?? null,
    state: cur?.state ?? f.state,
    emoji: cur?.emoji,
    basis,
    ...(cur
      ? provenanceFromRef(cur)
      : { ref: f.id, ref_name: displayName(f), origin: f.source === 'curated' ? 'curated' : f.source, verification: f.verification }),
    ...(f.brand ? { brand: f.brand } : {}),
  }
}

export const STATE_LABEL_HE: Record<string, string> = { raw: 'לא מבושל', cooked: 'מבושל / מוכן', as_sold: '' }

/** Label + tone for the trust badge shown next to a food (short = for item rows). */
export function trustBadge(v: Verification | undefined, origin?: string, short = false): { text: string; tone: 'good' | 'info' | 'warn' } {
  if (v === 'official') return { text: short ? 'מאומת' : origin === 'usda' ? 'מאומת · USDA' : 'מאומת · משרד הבריאות', tone: 'good' }
  if (v === 'label') return { text: 'תווית יצרן', tone: 'good' }
  if (v === 'recipe') return { text: short ? 'מתכון' : 'מתכון מחושב', tone: 'info' }
  if (v === 'community') return { text: 'לא מאומת', tone: 'warn' }
  return { text: 'הערכה', tone: 'warn' }
}
