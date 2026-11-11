/**
 * Nutrition values the user wrote themselves ("טוקיו נודלס 750 קלוריות 45 חלבון 85 פחמימות 25 שומן",
 * "משקה GO 230 קלוריות 25 גרם חלבון", "קלוריות: 750 • חלבון: 45 גרם").
 *
 * They come from the menu / label the user is looking at, so they beat any database record or AI
 * estimate. Parsed deterministically (the model is not trusted to carry them through) and applied
 * after the analysis: the meal becomes one item with exactly these values.
 */
import type { Analysis, FoodItem, Per100 } from './schema.ts'
import { newId, overallConfidence, totalsOf } from './nutrition.ts'

export interface StatedNutrition {
  kcal: number
  protein_g?: number
  fat_g?: number
  carbs_g?: number
  /** the values are per 100 g / ml ("60 קלוריות ל-100 גרם"), not for the whole portion */
  per100: boolean
}

const HE = '\\u05D0-\\u05EA'
const NUM = '(\\d+(?:\\.\\d+)?)'
const UNIT = `(?:גרם|גר['׳]?|ג['׳]|g|gr|grams?)?\\.?`
const KEYWORDS = {
  kcal: `(?:קלוריות|קלוריה|קלורי|קק["״']?ל|kcal|calories|cals?)`,
  protein_g: `(?:חלבון|protein)`,
  carbs_g: `(?:פחמימות|פחמימה|פחמ['׳]?|carbs?|carbohydrates?)`,
  fat_g: `(?:שומנים|שומן|fat)`,
} as const
type Key = keyof typeof KEYWORDS

/** "750 קלוריות", "45 גרם חלבון", "25g fat" — and "קלוריות: 750", "חלבון - 45 גרם" (separator required) */
const patterns = (k: Key) => [
  new RegExp(`${NUM}\\s*${UNIT}\\s*(?:של\\s+)?${KEYWORDS[k]}(?![${HE}a-z])`, 'gi'),
  new RegExp(`(?<![${HE}a-z])${KEYWORDS[k]}\\s*[:=\\-–]\\s*${NUM}`, 'gi'),
]

function normalize(text: string): string {
  return text
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2') // 1,200 → 1200
    .replace(/(\d),(\d)/g, '$1.$2') // 4,5 → 4.5
}

function valuesOf(text: string, k: Key): number[] {
  const out: number[] = []
  for (const re of patterns(k)) for (const m of text.matchAll(re)) out.push(Number(m[1]))
  return [...new Set(out)]
}

/** Text with the nutrient phrases removed: what is left describes the food. */
function foodPart(text: string): string {
  let t = text
  for (const k of Object.keys(KEYWORDS) as Key[]) for (const re of patterns(k)) t = t.replace(re, ' ')
  return t
}

export function parseStatedNutrition(raw: string | undefined | null): StatedNutrition | null {
  if (!raw || !/\d/.test(raw)) return null
  const text = normalize(raw)
  const got: Partial<Record<Key, number>> = {}
  for (const k of Object.keys(KEYWORDS) as Key[]) {
    const v = valuesOf(text, k)
    if (v.length > 1) return null // two different calorie numbers: several foods, not one stated value
    if (v.length === 1) got[k] = v[0]
  }
  let kcal = got.kcal
  if (kcal === undefined && got.protein_g !== undefined && got.fat_g !== undefined && got.carbs_g !== undefined) {
    kcal = Math.round(got.protein_g * 4 + got.carbs_g * 4 + got.fat_g * 9)
  }
  if (kcal === undefined || !(kcal > 0) || kcal > 6000) return null
  const per100 = /(?<![א-ת])(?:ל|ב|per\s)\s*-?\s*100\s*(?:גרם|גר|ג['׳]?|g|gr|מ["״]?ל|ml)?(?![\d])/i.test(text)
  const s: StatedNutrition = { kcal, per100 }
  for (const k of ['protein_g', 'fat_g', 'carbs_g'] as const) {
    const v = got[k]
    if (v !== undefined) {
      if (!(v >= 0) || v * (k === 'fat_g' ? 9 : 4) > kcal * 1.5 + 20) return null // a misread number
      s[k] = v
    }
  }
  return s
}

/** Do the stated values describe the whole meal (one food), not just one of several foods? */
export function describesWholeMeal(raw: string): boolean {
  const rest = foodPart(normalize(raw)).replace(/[•\t\n\r*·]+/g, ' ')
  // separators left between the removed nutrient phrases ("520 kcal, 30g protein") don't count
  const foods = rest.split(/[,+،;]/).filter((x) => /[א-תa-z]/i.test(x))
  return foods.length <= 1 && !/\sוגם\s|\sו[א-ת]{2,}/.test(rest)
}

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * The analysis with the user's own values: one item whose calories and macros are exactly the
 * stated ones. A macro that wasn't stated keeps the analysed value, scaled so the energy adds up.
 */
export function applyStatedNutrition(a: Analysis, s: StatedNutrition, opts: { wholeMeal: boolean }): Analysis {
  if (a.items.length !== 1 && (!opts.wholeMeal || s.per100)) return a
  const base = a.items
  const grams = Math.max(1, Math.round(base.reduce((g, i) => g + i.grams, 0))) || 100
  const k = s.per100 ? grams / 100 : 1
  const kcal = s.kcal * k
  const was = { protein_g: 0, fat_g: 0, carbs_g: 0 }
  for (const i of base) {
    was.protein_g += i.protein_g
    was.fat_g += i.fat_g
    was.carbs_g += i.carbs_g
  }
  const energy = { protein_g: 4, fat_g: 9, carbs_g: 4 } as const
  const macros = (['protein_g', 'fat_g', 'carbs_g'] as const)
  let statedEnergy = 0
  let restEnergy = 0
  for (const m of macros) {
    if (s[m] !== undefined) statedEnergy += (s[m] ?? 0) * k * energy[m]
    else restEnergy += was[m] * energy[m]
  }
  const f = restEnergy > 0 ? Math.max(0, kcal - statedEnergy) / restEnergy : 0
  const value = (m: (typeof macros)[number]) => (s[m] !== undefined ? (s[m] ?? 0) * k : was[m] * f)

  const first = base[0]
  const name = a.items.length === 1 ? first.name : a.title
  const totals = { calories: Math.round(kcal), protein_g: r1(value('protein_g')), fat_g: r1(value('fat_g')), carbs_g: r1(value('carbs_g')) }
  const per100: Per100 = {
    kcal: r1((totals.calories * 100) / grams),
    protein_g: r1((totals.protein_g * 100) / grams),
    fat_g: r1((totals.fat_g * 100) / grams),
    carbs_g: r1((totals.carbs_g * 100) / grams),
  }
  const item: FoodItem = {
    id: newId(),
    name,
    grams,
    per100,
    ...totals,
    confidence: 0.95,
    assumptions: ['לפי הערכים שכתבת', ...(first.basis === 'estimated' && !s.per100 ? ['המשקל משוער — לא משנה את הקלוריות'] : [])],
    source: 'manual',
    db_key: null,
    state: first.state,
    emoji: first.emoji,
    basis: 'stated',
    origin: 'manual',
    verification: 'label',
    ref_name: 'לפי הערכים שכתבת',
    ...(first.brand ? { brand: first.brand } : {}),
  }
  const items = [item]
  return { ...a, items, totals: totalsOf(items), overall_confidence: overallConfidence(items), clarification: null }
}

/**
 * Parse the request's text and apply when it states values. In a correction, values in the correction
 * win (for a single food); otherwise the original description's values are kept through the re-analysis.
 */
export function withStatedNutrition(a: Analysis, req: { mode?: string; text?: string | null; correction?: string | null }): Analysis {
  if (req.mode === 'correct') {
    const c = parseStatedNutrition(req.correction)
    if (c) return applyStatedNutrition(a, c, { wholeMeal: false })
  }
  const s = parseStatedNutrition(req.text)
  if (!s || !req.text) return a
  return applyStatedNutrition(a, s, { wholeMeal: describesWholeMeal(req.text) })
}
