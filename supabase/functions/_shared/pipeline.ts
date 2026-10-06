/**
 * Food analysis pipeline (runtime-agnostic: Deno edge function and Node dev server).
 *
 *   user text / photo
 *     → AI (with the nutrition-analysis skill) identifies items + edible grams + state,
 *       mapped to our nutrition-table keys
 *     → zod validation of the untrusted JSON (invalid → next provider)
 *     → nutrients looked up: curated table → USDA FDC → AI per-100 g estimate (checked)
 *     → calories/macros computed deterministically, totals summed here
 *     → result with confidence, assumptions, source per item, kcal range
 *
 * If every provider fails, text input falls back to the offline Hebrew parser.
 */

import { AiParseSchema, type AiItem, type AiParse, type Analysis, type AnalyzeErrorCode, type AnalyzeRequest, type FoodItem, type Per100 } from './schema.ts'
import { FOOD_BY_KEY, foodCatalogForPrompt } from './foodDb.ts'
import { NUTRITION_SKILL } from './skill.generated.ts'
import { extractJson, ProviderError, providersFromEnv, type Env, type NutritionAIProvider } from './providers.ts'
import { atwaterKcal, isPlausiblePer100, newId, overallConfidence, per100FromRef, scale, totalsOf } from './nutrition.ts'
import { lookupUsda } from './usda.ts'
import { parseLocally } from './localParser.ts'

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
        required: ['name_he', 'name_en', 'db_key', 'grams', 'state', 'confidence', 'assumptions'],
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

async function resolveItem(ai: AiItem, env: Env, fetchFn: typeof fetch): Promise<FoodItem | null> {
  const grams = Math.round(ai.grams)
  const assumptions = [...ai.assumptions]
  let per100: Per100 | null = null
  let source: FoodItem['source'] = 'ai'
  let confidence = ai.confidence
  let dbKey: string | null = null
  let emoji: string | undefined

  // 1) curated table
  const ref = ai.db_key ? FOOD_BY_KEY[ai.db_key] : undefined
  if (ref) {
    per100 = per100FromRef(ref)
    source = 'db'
    dbKey = ref.key
    emoji = ref.emoji
  }

  // 2) USDA FoodData Central
  if (!per100 && ai.name_en) {
    const key = env('USDA_FDC_API_KEY') ?? 'DEMO_KEY'
    const stateHint = ai.state === 'cooked' ? ' cooked' : ai.state === 'raw' ? ' raw' : ''
    const hit = env('USDA_FDC_DISABLED') === 'true' ? null : await lookupUsda(`${ai.name_en}${stateHint}`, key, fetchFn)
    if (hit) {
      const est = ai.est_per100
      // guard against a mismatched search hit: must agree roughly with the model's own estimate
      const agrees = !est || Math.abs(hit.per100.kcal - est.kcal) <= Math.max(60, 0.45 * Math.max(hit.per100.kcal, est.kcal))
      if (agrees) {
        per100 = hit.per100
        source = 'usda'
      }
    }
  }

  // 3) the model's own estimate, sanity-checked
  if (!per100 && ai.est_per100) {
    const est = { ...ai.est_per100 }
    if (!isPlausiblePer100(est)) {
      // macros are the more reliable signal — rebuild kcal from Atwater factors
      est.kcal = Math.round(atwaterKcal(est))
      if (est.protein_g + est.fat_g + est.carbs_g > 100) return null
    }
    per100 = est
    source = 'ai'
    confidence = Math.min(confidence, 0.7)
    assumptions.push('ערכים תזונתיים משוערים')
  }

  if (!per100) return null

  const item: FoodItem = {
    id: newId(),
    name: ai.name_he,
    grams,
    per100,
    ...scale(per100, grams),
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
    assumptions: assumptions.slice(0, 6),
    source,
    db_key: dbKey,
    state: ai.state,
    emoji,
  }
  const lo = ai.grams_low ?? undefined
  const hi = ai.grams_high ?? undefined
  if (lo !== undefined && hi !== undefined && lo > 0 && lo <= grams && hi >= grams && (lo !== grams || hi !== grams)) {
    item.grams_low = Math.round(lo)
    item.grams_high = Math.round(hi)
  }
  return item
}

async function toAnalysis(parsed: AiParse, provider: string, model: string | undefined, env: Env, fetchFn: typeof fetch): Promise<Analysis | null> {
  const resolved = await Promise.all(parsed.items.filter((i) => i.grams > 0).map((i) => resolveItem(i, env, fetchFn)))
  const items = resolved.filter((i): i is FoodItem => i !== null)
  if (!items.length) return null
  const dropped = resolved.length - items.length
  return {
    title: parsed.meal_title_he || items.map((i) => i.name).slice(0, 3).join(', '),
    emoji: parsed.emoji || items[0].emoji || '🍽️',
    items,
    totals: totalsOf(items),
    overall_confidence: Math.min(overallConfidence(items), parsed.overall_confidence + 0.15),
    clarification: parsed.clarification_he ?? (dropped ? 'לא הצלחתי לחשב חלק מהפריטים — אפשר לתאר אותם שוב.' : null),
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
  const user = buildUserPrompt(req)
  let sawUnclear: string | null = null
  let sawNotFood = false

  for (const provider of providers) {
    try {
      const res = await provider.complete({ system, user, image: req.image, jsonSchema: AI_JSON_SCHEMA }, AbortSignal.timeout(timeoutMs))
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
      const analysis = await toAnalysis(parsed.data, provider.id, res.model, deps.env, fetchFn)
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
