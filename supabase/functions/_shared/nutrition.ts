import type { FoodItem, Per100, Totals } from './schema.ts'
import type { FoodRef } from './foodDb.ts'

/** All macro math lives here so the client and the server compute identically. */

const r1 = (n: number) => Math.round(n * 10) / 10

export function per100FromRef(ref: FoodRef): Per100 {
  return { kcal: ref.kcal, protein_g: ref.p, fat_g: ref.f, carbs_g: ref.c }
}

export function scale(per100: Per100, grams: number) {
  const k = Math.max(0, grams) / 100
  return {
    calories: Math.round(per100.kcal * k),
    protein_g: r1(per100.protein_g * k),
    fat_g: r1(per100.fat_g * k),
    carbs_g: r1(per100.carbs_g * k),
  }
}

/** Re-derive an item's nutrients after its grams changed (user edit). */
export function withGrams(item: FoodItem, grams: number): FoodItem {
  const g = Math.max(0, Math.round(grams))
  const ratio = item.grams > 0 ? g / item.grams : 1
  return {
    ...item,
    grams: g,
    grams_low: undefined,
    grams_high: undefined,
    ...scale(item.per100, g),
    // an explicit user amount removes the portion uncertainty
    confidence: Math.min(1, Math.max(item.confidence, item.source === 'db' || item.source === 'usda' ? 0.9 : 0.75)),
    assumptions: ratio === 1 ? item.assumptions : item.assumptions.filter((a) => !/גרם|מנה|גודל|כמות|portion/i.test(a)),
  }
}

export function totalsOf(items: FoodItem[]): Totals {
  let calories = 0, protein = 0, fat = 0, carbs = 0, low = 0, high = 0
  let hasRange = false
  for (const it of items) {
    calories += it.calories
    protein += it.protein_g
    fat += it.fat_g
    carbs += it.carbs_g
    const lo = it.grams_low ?? it.grams
    const hi = it.grams_high ?? it.grams
    if (lo !== it.grams || hi !== it.grams) hasRange = true
    low += (it.per100.kcal * lo) / 100
    high += (it.per100.kcal * hi) / 100
  }
  const totals: Totals = {
    calories: Math.round(calories),
    protein_g: r1(protein),
    fat_g: r1(fat),
    carbs_g: r1(carbs),
  }
  if (hasRange) {
    totals.calories_low = Math.round(low / 10) * 10
    totals.calories_high = Math.round(high / 10) * 10
  }
  return totals
}

/** Weighted (by kcal) confidence across items. */
export function overallConfidence(items: FoodItem[]): number {
  const total = items.reduce((s, i) => s + i.calories, 0)
  if (total <= 0) return items.length ? Math.min(...items.map((i) => i.confidence)) : 0
  return Math.round((items.reduce((s, i) => s + i.confidence * i.calories, 0) / total) * 100) / 100
}

/** Atwater check: kcal from macros should be close to stated kcal (alcohol excepted). */
export function atwaterKcal(p: Per100): number {
  return p.protein_g * 4 + p.fat_g * 9 + p.carbs_g * 4
}

export function isPlausiblePer100(p: Per100): boolean {
  const macroGrams = p.protein_g + p.fat_g + p.carbs_g
  if (macroGrams > 101) return false
  const a = atwaterKcal(p)
  if (p.kcal < 5 && a < 5) return true
  // allow ±35% — fibre, rounding and alcohol (which has no macro) make this loose
  return Math.abs(a - p.kcal) <= Math.max(25, p.kcal * 0.35)
}

export function newId(): string {
  return globalThis.crypto.randomUUID()
}

export function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step
}
