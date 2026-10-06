import { describe, expect, it } from 'vitest'
import { parseLocally } from './localParser.ts'
import { FOODS } from './foodDb.ts'
import { atwaterKcal } from './nutrition.ts'

const keys = (text: string) => parseLocally(text).analysis?.items.map((i) => i.db_key) ?? []
const item = (text: string, key: string) => parseLocally(text).analysis!.items.find((i) => i.db_key === key)!

describe('local Hebrew parser', () => {
  it('parses the canonical example', () => {
    const r = parseLocally("אכלתי 3 ביצים, 2 פרוסות לחם, קוטג' וסלט")
    expect(r.unmatched).toEqual([])
    expect(r.analysis!.items.map((i) => i.db_key)).toEqual(['egg', 'bread_white', 'cottage_5', 'salad_veg'])
    expect(item("3 ביצים", 'egg').grams).toBe(150)
    expect(item('2 פרוסות לחם', 'bread_white').grams).toBe(60)
  })

  it('computes totals deterministically from the table', () => {
    const a = parseLocally('3 ביצים').analysis!
    // 150 g × 143 kcal/100 g
    expect(a.totals.calories).toBe(215)
    expect(a.totals.protein_g).toBeCloseTo(18.9, 1)
    expect(a.totals.fat_g).toBeCloseTo(14.3, 1)
    expect(Math.abs(a.totals.carbs_g - 1.05)).toBeLessThanOrEqual(0.06)
  })

  it('handles grams before and after the food', () => {
    expect(item('150 גרם פסטה בולונז', 'pasta_bolognese').grams).toBe(150)
    const burger = parseLocally('אכלתי המבורגר 200 גרם עם לחמנייה ובצל').analysis!
    expect(burger.items.map((i) => i.db_key)).toEqual(['ground_beef_raw', 'roll', 'onion'])
    expect(burger.items[0].grams).toBe(200)
  })

  it('does not double count ingredients inside composite foods', () => {
    const a = parseLocally('2 טוסטים עם גבינה צהובה').analysis!
    expect(a.items.map((i) => i.db_key)).toEqual(['toast_cheese'])
    expect(a.items[0].grams).toBe(200)
  })

  it('prefers the longest alias', () => {
    expect(keys('חזה עוף 200 גרם')).toEqual(['chicken_breast_cooked'])
    expect(keys('גבינה צהובה 9%')).toEqual(['yellow_cheese_light'])
    expect(keys('ביצת עין')).toEqual(['egg_fried'])
    expect(keys('2 פרוסות לחם מלא')).toEqual(['bread_whole'])
    expect(item('2 פרוסות לחם מלא', 'bread_whole').grams).toBe(64)
    expect(item('כוס חלב', 'milk_3').grams).toBe(240)
    expect(item('קופסת טונה', 'tuna_water').grams).toBe(110)
    expect(item('2 כדורי גלידה', 'ice_cream').grams).toBe(140)
    expect(item('משולש פיצה', 'pizza').grams).toBe(120)
    expect(item('4 כדורי פלאפל', 'falafel').grams).toBe(68)
  })

  it('understands Hebrew number words, halves and units', () => {
    expect(item('שתי כפות טחינה', 'tahini').grams).toBe(30)
    expect(item('חצי אבוקדו', 'avocado').grams).toBe(75)
    expect(item('כוס וחצי אורז', 'rice_white_cooked').grams).toBe(240)
    expect(item('כפית שמן זית', 'olive_oil').grams).toBe(5)
    expect(item('1.5 כוסות חלב', 'milk_3').grams).toBe(360)
  })

  it('handles glued numbers and approximate ranges', () => {
    expect(item('200גרם אורז', 'rice_white_cooked').grams).toBe(200)
    expect(item('כ-150 גרם סלמון', 'salmon_cooked').grams).toBe(150)
    expect(item('150-250 גרם אורז', 'rice_white_cooked').grams).toBe(200)
  })

  it('applies size words and records the assumption', () => {
    const big = item('בננה גדולה', 'banana')
    expect(big.grams).toBe(Math.round(118 * 1.3))
    expect(big.assumptions.join(' ')).toContain('גדולה')
  })

  it('falls back to a default serving with low confidence', () => {
    const a = item('פסטה', 'pasta_cooked')
    expect(a.grams).toBe(220)
    expect(a.confidence).toBeLessThanOrEqual(0.5)
  })

  it('reports unknown foods instead of inventing them', () => {
    const r = parseLocally('קינוח מוזר מהשוק')
    expect(r.analysis).toBeNull()
    expect(r.unmatched.length).toBe(1)
    const mixed = parseLocally('2 ביצים ופשטידת ברוקולי מיוחדת של סבתא')
    expect(mixed.analysis!.items.length).toBeGreaterThanOrEqual(1)
  })

  it('handles niqqud / geresh variants', () => {
    expect(keys('קוטג׳')).toEqual(['cottage_5'])
    expect(keys("צ'יפס")).toEqual(['fries'])
  })
})

describe('nutrition table integrity', () => {
  it('has unique keys', () => {
    const set = new Set(FOODS.map((f) => f.key))
    expect(set.size).toBe(FOODS.length)
  })
  it.each(FOODS.filter((f) => !['beer', 'wine'].includes(f.key)).map((f) => [f.key, f] as const))(
    '%s: macros agree with kcal (Atwater ±30%%)',
    (_k, f) => {
      const a = atwaterKcal({ kcal: f.kcal, protein_g: f.p, fat_g: f.f, carbs_g: f.c })
      expect(Math.abs(a - f.kcal)).toBeLessThanOrEqual(Math.max(15, f.kcal * 0.3))
      expect(f.p + f.f + f.c).toBeLessThanOrEqual(101)
      expect(f.units.serving).toBeGreaterThan(0)
    },
  )
})
