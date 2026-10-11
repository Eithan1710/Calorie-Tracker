/**
 * Curated core nutrition table — per 100 g of the food *in the stated state*
 * (raw / cooked / as sold).
 *
 * The numbers live in foodDb.generated.ts, which scripts/foods/build_curated.py
 * copies from the referenced source record of every food (it never types a
 * nutrient by hand):
 *  - 'moh'      Israeli Ministry of Health national nutrition DB (Tzameret, data.gov.il)
 *  - 'usda'     USDA FoodData Central (Foundation / SR Legacy)
 *  - 'off'      a specific Israeli branded product's label (Open Food Facts)
 *  - 'recipe'   standard recipe computed from referenced ingredients
 *  - 'estimate' no reliable source — flagged as an estimate everywhere
 * docs/food-data/curated-report.md lists every source and discrepancy.
 *
 * This table is the first "structured data" step of the pipeline: the AI maps
 * each food it recognises to a `key` here and supplies only the gram amount.
 * Foods not in the table go to the full food database (mz_foods: ~13k MoH,
 * USDA and Israeli packaged products), then USDA FDC live search, and only
 * then to the AI's own per-100 g estimate (flagged as such).
 *
 * Carbohydrates are *available* carbs (without fibre), as on Israeli labels.
 */
import { CURATED } from './foodDb.generated.ts'

export type FoodState = 'raw' | 'cooked' | 'as_sold'
export type UnitKey =
  | 'unit' | 'slice' | 'tbsp' | 'tsp' | 'cup' | 'handful' | 'serving'
  | 'can' | 'container' | 'scoop' | 'bag' | 'piece'

export type FoodSource = 'moh' | 'usda' | 'off' | 'recipe' | 'estimate'
/** official = government lab/compiled data; label = manufacturer label; recipe = computed; estimate = unverified */
export type Verification = 'official' | 'label' | 'recipe' | 'community' | 'estimate'

export interface CuratedFood {
  key: string
  he: string
  en: string
  emoji: string
  /** Hebrew aliases for the offline parser and search (without prefixes ה/ו/ב). */
  aliases: string[]
  state: FoodState
  kcal: number
  p: number
  f: number
  c: number
  /** optional nutrients — absent means "not reported by the source", never zero */
  fib?: number
  sug?: number
  sat?: number
  na?: number
  source: FoodSource
  /** source record id ('moh:1561', 'fdc:171077', 'off:7290…') or recipe composition */
  ref?: string
  ref_name?: string
  verification: Verification
  /** last update of the source record (ISO date) */
  updated?: string
  /** grams per unit word; `serving` is the default portion when no amount is given */
  units: Partial<Record<UnitKey, number>> & { serving: number }
  /** composite dishes: ingredient keys already inside (prevents double counting "טוסט עם גבינה") */
  includes?: string[]
  /** the same food in the other state (raw ↔ cooked) */
  pair?: string
  /** the same dish prepared without added oil — used when the user lists the oil separately */
  no_oil?: string
  /** the record already includes cooking oil / frying fat */
  fat_added?: boolean
  /** shown to the user: known variance / discrepancy between sources */
  note?: string
  /** data-quality flags from the build (e.g. atwater_mismatch) */
  flags?: string[]
}

/** Back-compat name used across the app. */
export type FoodRef = CuratedFood

export const FOODS: FoodRef[] = CURATED

export const FOOD_BY_KEY: Record<string, FoodRef> = Object.fromEntries(FOODS.map((f) => [f.key, f]))

/** Compact catalogue passed to the AI so it can map items to our keys. */
export function foodCatalogForPrompt(): string {
  return FOODS.map((f) => `${f.key} | ${f.en} | ${f.he} | ${f.state}${f.fat_added ? ' | includes oil' : ''}`).join('\n')
}

export const SOURCE_LABEL_HE: Record<string, string> = {
  moh: 'משרד הבריאות',
  usda: 'USDA',
  off: 'תווית מוצר',
  recipe: 'מתכון מחושב',
  estimate: 'הערכה',
  curated: 'מאגר מאזן',
}

export const VERIFICATION_LABEL_HE: Record<Verification, string> = {
  official: 'מאומת',
  label: 'תווית יצרן',
  recipe: 'מתכון מחושב',
  community: 'קהילתי — לא מאומת',
  estimate: 'הערכה',
}
