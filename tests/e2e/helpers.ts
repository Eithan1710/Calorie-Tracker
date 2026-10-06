import type { Page } from '@playwright/test'

export const PROFILE = { sex: 'male', age: 32, heightCm: 178, weightKg: 82 }
/** BMR 1,777.5 → with 0 steps the model gives 2,053 kcal/day for this profile */
export const BURN_NO_STEPS = 2053

export async function seedProfile(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript(
    ([profile, extra]) => {
      if (!localStorage.getItem('maazan:settings')) {
        localStorage.setItem('maazan:settings', JSON.stringify({ profile, proteinTarget: 120, remindersEnabled: false, reminderTime: '21:30', ...extra }))
      }
    },
    [PROFILE, extra] as const,
  )
}

/** Freeze the clock (Israel time) so goal status / reminder logic is deterministic. */
export async function at(page: Page, isoLocal: string) {
  await page.clock.install({ time: new Date(`${isoLocal}+03:00`) })
}

type Per100 = { kcal: number; protein_g: number; fat_g: number; carbs_g: number }
export interface TestItem {
  id: string
  name: string
  grams: number
  grams_low?: number
  grams_high?: number
  per100: Per100
  calories: number
  protein_g: number
  fat_g: number
  carbs_g: number
  [k: string]: unknown
}

export function item(id: string, name: string, grams: number, per100: Per100, extra: Record<string, unknown> = {}): TestItem {
  const k = grams / 100
  return {
    id,
    name,
    grams,
    per100,
    calories: Math.round(per100.kcal * k),
    protein_g: Math.round(per100.protein_g * k * 10) / 10,
    fat_g: Math.round(per100.fat_g * k * 10) / 10,
    carbs_g: Math.round(per100.carbs_g * k * 10) / 10,
    confidence: 0.8,
    assumptions: [],
    source: 'db',
    db_key: null,
    ...extra,
  }
}

export function analysis(items: TestItem[], extra: Record<string, unknown> = {}) {
  const sum = (key: 'calories' | 'protein_g' | 'fat_g' | 'carbs_g') => Math.round(items.reduce((s, i) => s + i[key], 0) * 10) / 10
  return {
    title: 'ארוחה',
    emoji: '🍽️',
    items,
    totals: {
      calories: sum('calories'),
      protein_g: sum('protein_g'),
      fat_g: sum('fat_g'),
      carbs_g: sum('carbs_g'),
      ...(items.some((i) => 'grams_low' in i)
        ? {
            calories_low: Math.round(items.reduce((s, i) => s + (i.per100.kcal * (i.grams_low ?? i.grams)) / 100, 0)),
            calories_high: Math.round(items.reduce((s, i) => s + (i.per100.kcal * (i.grams_high ?? i.grams)) / 100, 0)),
          }
        : {}),
    },
    overall_confidence: 0.8,
    clarification: null,
    provider: 'gemini',
    model: 'test',
    ...extra,
  }
}

export async function mockAnalyze(page: Page, body: unknown, status = 200) {
  await page.route('**/api/analyze-food', (route) => route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) }))
}

export async function addText(page: Page, text: string) {
  await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
  await page.getByLabel('תיאור האוכל').fill(text)
  await page.getByRole('button', { name: 'חשב' }).click()
}
