/**
 * Food analysis pipeline (runtime-agnostic: Deno edge function and Node dev server).
 *
 *   user text / photo
 *     → AI (with the nutrition-analysis skill) identifies items + edible grams + state,
 *       mapped to our nutrition-table keys
 *     → zod validation of the untrusted JSON (invalid → next provider)
 *     → nutrients looked up: curated table → food database (MoH / USDA / Israeli
 *       products, mz_foods) → USDA FDC live search → AI per-100 g estimate (checked)
 *     → oil is never counted twice (a "fried" record vs. a separately stated oil)
 *     → calories/macros computed deterministically, totals summed here
 *     → result with confidence, assumptions, source per item, kcal range
 *
 * If every provider fails, text input falls back to the offline Hebrew parser.
 */

import { AiParseSchema, type AiItem, type AiParse, type Analysis, type AnalyzeErrorCode, type AnalyzeRequest, type FoodItem, type Per100 } from './schema.ts'
import { FOOD_BY_KEY, foodCatalogForPrompt } from './foodDb.ts'
import { NUTRITION_SKILL } from './skill.generated.ts'
import { extractJson, ProviderError, providersFromEnv, type Env, type NutritionAIProvider } from './providers.ts'
import { atwaterKcal, isPlausiblePer100, newId, overallConfidence, per100FromRef, provenanceFromRef, scale, totalsOf } from './nutrition.ts'
import { lookupUsda } from './usda.ts'
import { parseLocally } from './localParser.ts'
import { curatedFor, displayName, per100FromDb, pickCandidate, searchPhrase, type MatchTarget, type SearchFoods } from './foodMatch.ts'
import type { FoodRef } from './foodDb.ts'

export const ERROR_MESSAGES: Record<AnalyzeErrorCode, string> = {
  unclear_text: 'לא הצלחתי לנתח את האוכל. נסה לתאר קצת יותר את הכמות.',
  unclear_image: 'התמונה קצת לא ברורה לי. אפשר לנסות תמונה נוספת או לכתוב מה אכלת.',
  not_food: 'לא זיהיתי כאן אוכל. אפשר לנסות שוב או לכתוב מה אכלת.',
  unavailable: 'הניתוח לא זמין כרגע. נסה שוב בעוד רגע, או כתוב את הכמויות ונחשב בלי AI.',
  bad_request: 'משהו בבקשה לא תקין. נסה שוב.',
  unauthorized: 'צריך להתחבר כדי להשתמש בניתוח החכם.',
}

/** Hand-written JSON schema (Gemini/OpenAI friendly) mirroring AiParseSchema. */
export const AI_JSON_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'unclear', 'not_food'] },
    meal_title_he: { type: 'string' },
    emoji: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name_he: { type: 'string' },
          name_en: { type: 'string' },
          db_key: { type: ['string', 'null'] },
          grams: { type: 'number' },
          grams_low: { type: ['number', 'null'] },
          grams_high: { type: ['number', 'null'] },
          state: { type: 'string', enum: ['raw', 'cooked', 'as_sold', 'unknown'] },
          brand: { type: ['string', 'null'] },
          quantity_basis: { type: 'string', enum: ['stated', 'counted', 'estimated'] },
          est_per100: {
            type: ['object', 'null'],
            properties: {
              kcal: { type: 'number' },
              protein_g: { type: 'number' },
              fat_g: { type: 'number' },
              carbs_g: { type: 'number' },
            },
            required: ['kcal', 'protein_g', 'fat_g', 'carbs_g'],
          },
          confidence: { type: 'number' },
          assumptions: { type: 'array', items: { type: 'string' } },
        },
        required: ['name_he', 'name_en', 'db_key', 'grams', 'state', 'quantity_basis', 'confidence', 'assumptions'],
      },
    },
    clarification_he: { type: ['string', 'null'] },
    overall_confidence: { type: 'number' },
  },
  required: ['status', 'meal_title_he', 'emoji', 'items', 'overall_confidence'],
}

export function buildSystemPrompt(): string {
  return `${NUTRITION_SKILL}\n\n## Nutrition table (db_key | English | Hebrew | state)\n${foodCatalogForPrompt()}`
}

/**
 * The same instructions without the ~5K-token food table, for providers with a small token budget.
 * Items then come back without db_key and are matched by name in the full food database.
 */
export function buildCompactSystemPrompt(): string {
  return `${NUTRITION_SKILL}\n\n## Nutrition table\nNot included in this request: set db_key to null for every item and give a precise English name (name_en) and state; the server looks the food up by name.`
}

export function buildUserPrompt(req: AnalyzeRequest): string {
  if (req.mode === 'correct') {
    return [
      'CORRECTION MODE.',
      'Previous items (JSON):',
      JSON.stringify(req.previous ?? []),
      req.text ? `Original description: ${req.text}` : '',
      `User correction (Hebrew): ${req.correction ?? ''}`,
      'Return the full corrected item list as JSON.',
    ].filter(Boolean).join('\n')
  }
  if (req.image) {
    return req.text
      ? `Analyse the food in this photo. The user added this note (it overrides what you see for amounts): ${req.text}`
      : 'Analyse the food in this photo.'
  }
  return `What the user ate (Hebrew free text): ${req.text}`
}

export interface PipelineDeps {
  env: Env
  fetchFn?: typeof fetch
  providers?: NutritionAIProvider[]
  log?: (entry: AnalysisLog) => void
  /** full food database search (public.mz_search_foods); absent → curated + USDA only */
  searchFoods?: SearchFoods
  /** filled with stage durations (ms): ai = model calls, resolve = nutrient lookup */
  timing?: Record<string, number>
}

export interface AnalysisLog {
  provider: string
  model?: string
  ok: boolean
  error?: string
  latency_ms: number
  attempts: { provider: string; error: string }[]
}

export type PipelineResult = { ok: true; analysis: Analysis } | { ok: false; error: AnalyzeErrorCode; message: string; clarification?: string }

/** oil / butter keys: an item of these with a stated amount means the cooking fat is logged separately */
export const OIL_KEYS = new Set(['olive_oil', 'oil', 'butter'])

interface ResolveCtx {
  env: Env
  fetchFn: typeof fetch
  searchFoods?: SearchFoods
  statedOil: boolean
}

interface Resolved {
  item: FoodItem
  /** the record already includes cooking oil (fried / cooked with oil) */
  fatAdded: boolean
  /** curated record used, if any (raw/cooked pairing) */
  ref?: FoodRef
}

function fromCurated(ref: FoodRef, statedOil: boolean, assumptions: string[]): { ref: FoodRef; per100: Per100 } {
  let r = ref
  if (statedOil && r.fat_added && r.no_oil && FOOD_BY_KEY[r.no_oil]) {
    r = FOOD_BY_KEY[r.no_oil]
    assumptions.push('השמן נספר בנפרד — חישבתי את המנה בלי שמן')
  }
  return { ref: r, per100: per100FromRef(r) }
}

async function resolveItem(ai: AiItem, ctx: ResolveCtx): Promise<Resolved | null> {
  const grams = Math.round(ai.grams)
  const assumptions = [...ai.assumptions]
  let per100: Per100 | null = null
  let source: FoodItem['source'] = 'ai'
  let confidence = ai.confidence
  let dbKey: string | null = null
  let emoji: string | undefined
  let fatAdded = false
  let usedRef: FoodRef | undefined
  let prov: Partial<FoodItem> = {}

  const useCurated = (ref: FoodRef) => {
    const c = fromCurated(ref, ctx.statedOil, assumptions)
    per100 = c.per100
    source = 'db'
    dbKey = c.ref.key
    emoji = c.ref.emoji
    fatAdded = Boolean(c.ref.fat_added)
    usedRef = c.ref
    prov = provenanceFromRef(c.ref)
    if (c.ref.verification === 'estimate') confidence = Math.min(confidence, 0.65)
  }

  // 1) curated core table (the model picked a key)
  const ref = ai.db_key ? FOOD_BY_KEY[ai.db_key] : undefined
  if (ref) useCurated(ref)

  // 2) full food database: Israeli MoH, USDA, Israeli packaged products
  if (!per100 && ctx.searchFoods) {
    const target: MatchTarget = { name_he: ai.name_he, name_en: ai.name_en, brand: ai.brand ?? null, state: ai.state, est_per100: ai.est_per100 ?? null }
    const state = ai.state === 'raw' || ai.state === 'cooked' ? ai.state : null
    const safe = (q: string) => ctx.searchFoods!(q, { state, limit: 8 }).catch(() => [])
    let match = pickCandidate(await safe(searchPhrase(target)), target, ctx)
    if (!match && ai.name_en) match = pickCandidate(await safe(ai.name_en), target, ctx)
    if (match) {
      const cur = curatedFor(match.food)
      if (cur) useCurated(cur)
      else {
        const f = match.food
        per100 = per100FromDb(f)
        source = f.source === 'usda' ? 'usda' : 'db'
        fatAdded = f.fat_added
        confidence = Math.min(1, confidence * match.confidence)
        assumptions.push(...match.notes)
        prov = {
          ref: f.id,
          ref_name: displayName(f),
          origin: f.source === 'curated' ? 'curated' : f.source,
          verification: f.verification,
          ...(f.brand ? { brand: f.brand } : {}),
        }
      }
    }
  }

  // 3) USDA FoodData Central live search (when the database isn't installed / had nothing)
  if (!per100 && ai.name_en) {
    const key = ctx.env('USDA_FDC_API_KEY') ?? 'DEMO_KEY'
    const stateHint = ai.state === 'cooked' ? ' cooked' : ai.state === 'raw' ? ' raw' : ''
    const hit = ctx.env('USDA_FDC_DISABLED') === 'true' ? null : await lookupUsda(`${ai.name_en}${stateHint}`, key, ctx.fetchFn)
    if (hit) {
      const est = ai.est_per100
      // guard against a mismatched search hit: must agree roughly with the model's own estimate
      const agrees = !est || Math.abs(hit.per100.kcal - est.kcal) <= Math.max(60, 0.45 * Math.max(hit.per100.kcal, est.kcal))
      if (agrees) {
        per100 = hit.per100
        source = 'usda'
        prov = { ref_name: hit.description, origin: 'usda', verification: 'official' }
      }
    }
  }

  // 4) the model's own estimate, sanity-checked and flagged
  if (!per100 && ai.est_per100) {
    const est: Per100 = { kcal: ai.est_per100.kcal, protein_g: ai.est_per100.protein_g, fat_g: ai.est_per100.fat_g, carbs_g: ai.est_per100.carbs_g }
    if (!isPlausiblePer100(est)) {
      // macros are the more reliable signal — rebuild kcal from Atwater factors
      est.kcal = Math.round(atwaterKcal(est))
      if (est.protein_g + est.fat_g + est.carbs_g > 100) return null
    }
    per100 = est
    source = 'ai'
    confidence = Math.min(confidence, 0.7)
    assumptions.push('ערכים תזונתיים משוערים')
    prov = { origin: 'ai', verification: 'estimate' }
  }

  if (!per100) return null
  const p100: Per100 = per100

  const item: FoodItem = {
    id: newId(),
    name: ai.name_he,
    grams,
    per100: p100,
    ...scale(p100, grams),
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    assumptions: [...new Set(assumptions)].slice(0, 6),
    source,
    db_key: dbKey,
    state: ai.state,
    emoji,
    basis: ai.quantity_basis,
    ...prov,
  }
  if (!item.brand && ai.brand) item.brand = ai.brand
  const lo = ai.grams_low ?? undefined
  const hi = ai.grams_high ?? undefined
  if (lo !== undefined && hi !== undefined && lo > 0 && lo <= grams && hi >= grams && (lo !== grams || hi !== grams)) {
    item.grams_low = Math.round(lo)
    item.grams_high = Math.round(hi)
  }
  return { item, fatAdded, ref: usedRef }
}

/** "200 גרם אורז" with no state: ask when raw vs cooked changes the result a lot. */
function rawCookedQuestion(ai: AiItem, ref?: FoodRef): string | null {
  if (!ref?.pair || ai.state !== 'unknown' || ai.quantity_basis !== 'stated' || ai.grams < 60) return null
  const other = FOOD_BY_KEY[ref.pair]
  if (!other || Math.abs(other.kcal - ref.kcal) / Math.max(other.kcal, ref.kcal) < 0.25) return null
  const assumed = ref.state === 'raw' ? 'לפני בישול' : 'אחרי בישול'
  return `${ai.name_he}: המשקל לפני או אחרי בישול? חישבתי לפי משקל ${assumed}.`
}

async function toAnalysis(parsed: AiParse, provider: string, model: string | undefined, deps: { env: Env; fetchFn: typeof fetch; searchFoods?: SearchFoods }): Promise<Analysis | null> {
  const aiItems = parsed.items.filter((i) => i.grams > 0)
  const statedOil = aiItems.some((i) => i.db_key && OIL_KEYS.has(i.db_key) && i.quantity_basis === 'stated')
  const ctx: ResolveCtx = { ...deps, statedOil }
  const resolved = await Promise.all(aiItems.map((i) => resolveItem(i, ctx)))

  // never count cooking oil twice: an oil the model only *assumed* is dropped
  // when another item's record already includes frying / cooking oil
  const kept: Resolved[] = []
  const fried = resolved.filter((r): r is Resolved => r !== null && r.fatAdded)
  resolved.forEach((r, i) => {
    if (!r) return
    const ai = aiItems[i]
    if (fried.length && ai.db_key && OIL_KEYS.has(ai.db_key) && ai.quantity_basis !== 'stated') {
      const host = fried[0].item
      host.assumptions = [...host.assumptions, 'השמן כבר כלול בערכים — לא נוסף בנפרד'].slice(0, 6)
      return
    }
    kept.push(r)
  })
  const items = kept.map((r) => r.item)
  if (!items.length) return null
  const dropped = resolved.filter((r) => r === null).length
  const question = parsed.clarification_he ?? aiItems.map((ai, i) => rawCookedQuestion(ai, resolved[i]?.ref)).find(Boolean) ?? null
  return {
    title: parsed.meal_title_he || items.map((i) => i.name).slice(0, 3).join(', '),
    emoji: parsed.emoji || items[0].emoji || '🍽️',
    items,
    totals: totalsOf(items),
    overall_confidence: Math.min(overallConfidence(items), parsed.overall_confidence + 0.15),
    clarification: question ?? (dropped ? 'לא הצלחתי לחשב חלק מהפריטים — אפשר לתאר אותם שוב.' : null),
    provider,
    model,
  }
}

export async function analyzeFood(req: AnalyzeRequest, deps: PipelineDeps): Promise<PipelineResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const providers = (deps.providers ?? providersFromEnv(deps.env, fetchFn)).filter((p) => !req.image || p.supportsVision)
  const started = Date.now()
  const attempts: { provider: string; error: string }[] = []
  const timeoutMs = Number(deps.env('AI_TIMEOUT_MS') ?? 25000)

  if (!req.text?.trim() && !req.image && req.mode !== 'correct') {
    return { ok: false, error: 'bad_request', message: ERROR_MESSAGES.bad_request }
  }

  const system = buildSystemPrompt()
  const systemCompact = buildCompactSystemPrompt()
  const user = buildUserPrompt(req)
  let sawUnclear: string | null = null
  let sawNotFood = false

  const budget = AbortSignal.timeout(timeoutMs)
  const timing = deps.timing ?? {}
  timing.ai = 0
  for (const provider of providers) {
    try {
      const t0 = Date.now()
      let res
      try {
        res = await provider.complete({ system, systemCompact, user, image: req.image, jsonSchema: AI_JSON_SCHEMA }, budget)
      } finally {
        timing.ai += Date.now() - t0
      }
      const raw = extractJson(res.text)
      const parsed = AiParseSchema.safeParse(raw)
      if (!parsed.success) {
        attempts.push({ provider: provider.id, error: 'invalid_json' })
        continue
      }
      if (parsed.data.status === 'not_food') {
        sawNotFood = true
        break
      }
      if (parsed.data.status === 'unclear' && parsed.data.items.length === 0) {
        sawUnclear = parsed.data.clarification_he ?? ''
        break
      }
      const t1 = Date.now()
      const analysis = await toAnalysis(parsed.data, provider.id, res.model, { env: deps.env, fetchFn, searchFoods: deps.searchFoods })
      timing.resolve = Date.now() - t1
      if (!analysis) {
        attempts.push({ provider: provider.id, error: 'no_resolvable_items' })
        continue
      }
      deps.log?.({ provider: provider.id, model: res.model, ok: true, latency_ms: Date.now() - started, attempts })
      return { ok: true, analysis }
    } catch (e) {
      attempts.push({ provider: provider.id, error: e instanceof ProviderError ? `${e.kind}:${e.status ?? ''}` : String(e) })
    }
  }

  const fail = (error: AnalyzeErrorCode, clarification?: string): PipelineResult => {
    deps.log?.({ provider: 'none', ok: false, error, latency_ms: Date.now() - started, attempts })
    return { ok: false, error, message: ERROR_MESSAGES[error], ...(clarification ? { clarification } : {}) }
  }

  if (sawNotFood) return fail('not_food')
  if (sawUnclear !== null) return fail(req.image ? 'unclear_image' : 'unclear_text', sawUnclear || undefined)

  // last resort for text: the deterministic offline parser
  if (req.mode === 'analyze' && req.text && !req.image) {
    const local = parseLocally(req.text)
    if (local.analysis) {
      if (local.unmatched.length) {
        local.analysis.clarification = `לא זיהיתי: ${local.unmatched.join(', ')} — אפשר להוסיף בנפרד.`
      }
      deps.log?.({ provider: 'local', ok: true, latency_ms: Date.now() - started, attempts })
      return { ok: true, analysis: local.analysis }
    }
    return fail(providers.length ? 'unavailable' : 'unclear_text')
  }
  return fail('unavailable')
}
