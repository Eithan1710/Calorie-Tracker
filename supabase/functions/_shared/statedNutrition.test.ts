import { describe, expect, it, vi } from 'vitest'
import { applyStatedNutrition, describesWholeMeal, parseStatedNutrition } from './statedNutrition.ts'
import { analyzeFood } from './pipeline.ts'
import type { NutritionAIProvider } from './providers.ts'

const noEnv = (k: string) => ({ USDA_FDC_DISABLED: 'true' })[k as 'USDA_FDC_DISABLED']
const fake = (reply: string): NutritionAIProvider => ({ id: 'a', supportsVision: true, complete: vi.fn(async () => ({ text: reply, model: 'm' })) })

describe('values the user wrote', () => {
  it('reads calories and macros in the ways people write them', () => {
    expect(parseStatedNutrition('טוקיו נודלס 750 קלוריות 45 חלבון 85 פחמימות 25 שומן')).toEqual({ kcal: 750, protein_g: 45, carbs_g: 85, fat_g: 25, per100: false })
    expect(parseStatedNutrition('טוקיו נודלס \n\t•\tקלוריות: 750\n\t•\tחלבון: 45 גרם\n\t•\tפחמימות: 85 גרם\n\t•\tשומן: 25 גרם')).toEqual({ kcal: 750, protein_g: 45, carbs_g: 85, fat_g: 25, per100: false })
    expect(parseStatedNutrition('משקה חלבון של גו בטעם עוגיות 230 קלוריות 25 גרם חלבון')).toEqual({ kcal: 230, protein_g: 25, per100: false })
    expect(parseStatedNutrition('wrap 520 kcal, 30g protein, 18g fat')).toEqual({ kcal: 520, protein_g: 30, fat_g: 18, per100: false })
    expect(parseStatedNutrition('בר 1,200 קק״ל')).toMatchObject({ kcal: 1200 })
    expect(parseStatedNutrition('יוגורט 150 גרם, 60 קלוריות ל-100 גרם')).toMatchObject({ kcal: 60, per100: true })
    // macros only → energy from Atwater
    expect(parseStatedNutrition('סלט 10 חלבון 20 פחמימות 5 שומן')).toMatchObject({ kcal: 165 })
  })

  it('ignores text that only names foods or percentages', () => {
    expect(parseStatedNutrition('משקה חלבון של גו בטעם עוגיות')).toBeNull()
    expect(parseStatedNutrition('200 גרם חזה עוף ויוגורט 0% שומן')).toBeNull()
    expect(parseStatedNutrition('חלב 3 אחוז שומן')).toBeNull()
    expect(parseStatedNutrition('4 חלבונים של ביצה')).toBeNull()
    expect(parseStatedNutrition('קפה 20 קלוריות ועוגה 300 קלוריות')).toBeNull() // two foods, two values
    expect(parseStatedNutrition('750 קלוריות 450 חלבון')).toBeNull() // a misread: protein can't carry that energy
  })

  it('knows when the values are for one dish', () => {
    expect(describesWholeMeal('טוקיו נודלס עם עוף 750 קלוריות')).toBe(true)
    expect(describesWholeMeal('סלט ושניצל 400 קלוריות')).toBe(false)
    expect(describesWholeMeal('סלט, שניצל 400 קלוריות')).toBe(false)
  })

  it('the meal becomes one item with exactly the stated values; unstated macros close the energy', () => {
    const item = (o: object) => ({ id: 'x', name: 'משקה', grams: 340, per100: { kcal: 60, protein_g: 6, fat_g: 1.5, carbs_g: 6 }, calories: 204, protein_g: 20.4, fat_g: 5.1, carbs_g: 20.4, confidence: 0.6, assumptions: [], source: 'ai' as const, basis: 'counted' as const, ...o })
    const a = { title: 'משקה', emoji: '🥤', items: [item({})], totals: { calories: 204, protein_g: 20.4, fat_g: 5.1, carbs_g: 20.4 }, overall_confidence: 0.6, clarification: null, provider: 'a' }
    const r = applyStatedNutrition(a, { kcal: 230, protein_g: 25, per100: false }, { wholeMeal: true })
    expect(r.items).toHaveLength(1)
    expect(r.totals.calories).toBe(230)
    expect(r.totals.protein_g).toBe(25)
    // the rest of the energy (230 − 100) split over fat and carbs in their analysed proportion
    expect(Math.round(r.totals.fat_g * 9 + r.totals.carbs_g * 4)).toBeGreaterThanOrEqual(128)
    expect(Math.round(r.totals.fat_g * 9 + r.totals.carbs_g * 4)).toBeLessThanOrEqual(132)
    expect(r.items[0]).toMatchObject({ origin: 'manual', verification: 'label', source: 'manual', db_key: null, ref_name: 'לפי הערכים שכתבת' })
    expect(r.items[0].per100.kcal).toBeCloseTo(67.6, 1)
    // per 100 g: scales with the portion
    const p = applyStatedNutrition(a, { kcal: 60, protein_g: 10, per100: true }, { wholeMeal: true })
    expect(p.totals.calories).toBe(204)
    expect(p.totals.protein_g).toBe(34)
  })

  it('11.11: "טוקיו נודלס 750 קלוריות…" is logged with those values, not as plain cooked pasta', async () => {
    const reply = JSON.stringify({
      status: 'ok', meal_title_he: 'טוקיו נודלס', emoji: '🍜', overall_confidence: 0.9, clarification_he: null,
      items: [{ name_he: 'טוקיו נודלס', name_en: 'Tokyo noodles', db_key: 'pasta_cooked', grams: 450, state: 'cooked', quantity_basis: 'estimated', confidence: 0.95, assumptions: ['השתמשתי בערכים התזונתיים שהוזנו'] }],
    })
    for (const text of ['טוקיו נודלס 750 קלוריות 45 חלבון 85 פחמימות 25 שומן', 'טוקיו נודלס \n\t•\tקלוריות: 750\n\t•\tחלבון: 45 גרם\n\t•\tפחמימות: 85 גרם\n\t•\tשומן: 25 גרם']) {
      const r = await analyzeFood({ mode: 'analyze', text }, { env: noEnv, providers: [fake(reply)] })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.analysis.totals).toEqual({ calories: 750, protein_g: 45, fat_g: 25, carbs_g: 85 })
      expect(r.analysis.items[0].name).toBe('טוקיו נודלס')
      expect(r.analysis.items[0].ref).toBeUndefined()
    }
    // a correction of the amount keeps the values the user wrote
    const c = await analyzeFood({ mode: 'correct', text: 'טוקיו נודלס 750 קלוריות 45 חלבון', correction: 'זה היה 400 גרם', previous: [] }, { env: noEnv, providers: [fake(reply)] })
    expect(c.ok && c.analysis.totals.calories).toBe(750)
    // without stated values the table is used as before
    const plain = await analyzeFood({ mode: 'analyze', text: 'טוקיו נודלס' }, { env: noEnv, providers: [fake(reply)] })
    expect(plain.ok && plain.analysis.items[0].ref).toBe('cur:pasta_cooked')
  })
})
