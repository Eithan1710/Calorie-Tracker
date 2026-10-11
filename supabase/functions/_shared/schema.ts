import { z } from 'zod'

/**
 * Two schemas:
 *  1. AiParseSchema   — what the model is allowed to return (untrusted).
 *  2. AnalysisSchema  — what the pipeline returns to the app after the
 *                       numbers have been computed deterministically.
 *
 * Everything coming from a model passes AiParseSchema.safeParse() before use.
 */

const num = (min: number, max: number) => z.coerce.number().finite().min(min).max(max)

export const Per100Schema = z.object({
  kcal: num(0, 950),
  protein_g: num(0, 100),
  fat_g: num(0, 100),
  /** available carbohydrate (without fibre), as on Israeli labels */
  carbs_g: num(0, 100),
  /** optional — absent/null means "not reported by the source", never zero */
  fiber_g: num(0, 100).nullable().optional(),
  sugar_g: num(0, 100).nullable().optional(),
  sat_fat_g: num(0, 100).nullable().optional(),
  sodium_mg: num(0, 40000).nullable().optional(),
})
export type Per100 = z.infer<typeof Per100Schema>

export const AiItemSchema = z.object({
  name_he: z.string().trim().min(1).max(80),
  name_en: z.string().trim().max(120).default(''),
  /** key from our nutrition table, or null if none fits */
  db_key: z.string().max(60).nullable().default(null),
  /** edible grams in the state that matches db_key (or est_per100) */
  grams: num(0, 3000),
  grams_low: num(0, 3000).nullable().optional(),
  grams_high: num(0, 3000).nullable().optional(),
  state: z.enum(['raw', 'cooked', 'as_sold', 'unknown']).default('unknown'),
  /** brand / product line when the user named one ("דנונה PRO", "תנובה") */
  brand: z.string().trim().max(60).nullable().optional(),
  /** where the amount came from: user wrote grams/ml, counted units, or the model estimated it */
  quantity_basis: z.enum(['stated', 'counted', 'estimated']).default('estimated'),
  /** model's own per-100 g estimate — required when db_key is null */
  est_per100: Per100Schema.nullable().optional(),
  confidence: num(0, 1).default(0.6),
  assumptions: z.array(z.string().max(200)).max(6).default([]),
})
export type AiItem = z.infer<typeof AiItemSchema>

export const AiParseSchema = z.object({
  status: z.enum(['ok', 'unclear', 'not_food']).default('ok'),
  meal_title_he: z.string().trim().max(80).default(''),
  emoji: z.string().max(8).default('🍽️'),
  items: z.array(AiItemSchema).max(25).default([]),
  clarification_he: z.string().max(200).nullable().optional(),
  overall_confidence: num(0, 1).default(0.6),
})
export type AiParse = z.infer<typeof AiParseSchema>

export const ItemSourceSchema = z.enum(['db', 'usda', 'ai', 'manual'])
export type ItemSource = z.infer<typeof ItemSourceSchema>

/** which dataset the numbers came from (finer than `source`, kept optional for old entries) */
export const ItemOriginSchema = z.enum(['curated', 'moh', 'usda', 'off', 'recipe', 'estimate', 'ai', 'manual'])
export const VerificationSchema = z.enum(['official', 'label', 'recipe', 'community', 'estimate'])
export type Verification = z.infer<typeof VerificationSchema>

export const FoodItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  grams: z.number().nonnegative(),
  grams_low: z.number().nonnegative().optional(),
  grams_high: z.number().nonnegative().optional(),
  per100: Per100Schema,
  calories: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()),
  source: ItemSourceSchema,
  db_key: z.string().nullable().optional(),
  state: z.string().optional(),
  emoji: z.string().optional(),
  // ── provenance (all optional: entries saved before the food database stay valid) ──
  /** dataset record the numbers came from: 'moh:1561', 'fdc:171077', 'off:7290…', 'cur:egg' */
  ref: z.string().max(400).optional(),
  ref_name: z.string().max(200).optional(),
  brand: z.string().max(80).optional(),
  origin: ItemOriginSchema.optional(),
  verification: VerificationSchema.optional(),
  /** stated = the user gave the amount, counted = units × standard weight, estimated = guessed */
  basis: z.enum(['stated', 'counted', 'estimated']).optional(),
  /** known variance of this food, shown to the user */
  note: z.string().max(200).optional(),
})
export type FoodItem = z.infer<typeof FoodItemSchema>

export const TotalsSchema = z.object({
  calories: z.number(),
  protein_g: z.number(),
  fat_g: z.number(),
  carbs_g: z.number(),
  calories_low: z.number().optional(),
  calories_high: z.number().optional(),
})
export type Totals = z.infer<typeof TotalsSchema>

export const AnalysisSchema = z.object({
  title: z.string(),
  emoji: z.string(),
  items: z.array(FoodItemSchema),
  totals: TotalsSchema,
  overall_confidence: z.number().min(0).max(1),
  clarification: z.string().nullable(),
  provider: z.string(),
  model: z.string().optional(),
})
export type Analysis = z.infer<typeof AnalysisSchema>

/** Request body accepted by the analyze endpoint. */
export const AnalyzeRequestSchema = z.object({
  mode: z.enum(['analyze', 'correct']).default('analyze'),
  text: z.string().max(1000).optional().default(''),
  /** base64 JPEG/PNG/WebP without data: prefix */
  image: z
    .object({ data: z.string().max(4_000_000), mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']) })
    .optional(),
  /** for mode=correct: the current items the user wants to fix */
  previous: z
    .array(z.object({ name: z.string(), grams: z.number(), db_key: z.string().nullable().optional() }))
    .max(25)
    .optional(),
  correction: z.string().max(500).optional(),
})
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>

export type AnalyzeErrorCode = 'unclear_text' | 'unclear_image' | 'not_food' | 'unavailable' | 'bad_request' | 'unauthorized'

export interface AnalyzeError {
  error: AnalyzeErrorCode
  message: string
}
