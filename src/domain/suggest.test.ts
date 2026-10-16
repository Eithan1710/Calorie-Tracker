import { describe, expect, it } from 'vitest'
import { calorieFit, dailyNeeds, entryMinutes, macroFit, minuteDistance, suggest, type DayTargets, type Intake } from './suggest'
import type { FoodEntry, FoodItem, Meal } from '../data/types'

const P = (kcal: number, protein_g: number, fat_g: number, carbs_g: number) => ({ kcal, protein_g, fat_g, carbs_g })
const FOODS = {
  tuna: { name: 'טונה במים', per100: P(116, 26, 1, 0), grams: 120 },
  chicken: { name: 'חזה עוף', per100: P(165, 31, 3.6, 0), grams: 150 },
  pasta: { name: 'פסטה', per100: P(158, 5.8, 0.9, 31), grams: 200 },
  yogurt: { name: 'יוגורט חלבון', per100: P(58, 10, 0.2, 4), grams: 200 },
  oats: { name: 'שיבולת שועל', per100: P(379, 13, 6.5, 68), grams: 50 },
  cottage: { name: 'קוטג׳ 5%', per100: P(93, 11, 5, 1.5), grams: 125 },
  schnitzel: { name: 'שניצל', per100: P(260, 18, 14, 15), grams: 200 },
  chips: { name: 'תפוצ׳יפס', per100: P(542, 5.9, 34, 53), grams: 50 },
  cookies: { name: 'עוגיות שוקולד צ׳יפס', per100: P(457, 5.5, 22.1, 61.4), grams: 60 },
  candy: { name: 'סוכריות גומי', per100: P(330, 1, 0, 80), grams: 40 },
  cola: { name: 'קולה', per100: P(37, 0.1, 0, 9.6), grams: 330 },
  proteinBar: { name: 'חטיף חלבון', per100: P(339, 35.7, 7.6, 34.4), grams: 60 },
  mystery: { name: 'מנה מיוחדת', per100: P(160, 20, 4, 10), grams: 250 },
  eggs: { name: 'ביצה קשה', per100: P(143, 12.6, 9.5, 0.7), grams: 100 },
}
type FoodName = keyof typeof FOODS

let n = 0
function item(f: FoodName, grams = FOODS[f].grams, extra: Partial<FoodItem> = {}): FoodItem {
  const { name, per100 } = FOODS[f]
  const k = grams / 100
  return {
    id: `i${n++}`, name, grams, per100,
    calories: Math.round(per100.kcal * k), protein_g: per100.protein_g * k, fat_g: per100.fat_g * k, carbs_g: per100.carbs_g * k,
    confidence: 0.85, assumptions: [], source: 'db', db_key: null, ...extra,
  }
}
/** an entry eaten on `day` (YYYY-MM-DD) at hh:mm local time */
function entry(day: string, hm: string, foods: (FoodName | FoodItem)[], meal: Meal = 'dinner', loggedAt?: Date): FoodEntry {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  const at = loggedAt ?? new Date(y, m - 1, d, h, mi)
  const items = foods.map((f) => (typeof f === 'string' ? item(f) : f))
  return {
    id: `e${n++}`, date: day, meal, title: items.map((i) => i.name).join(', '), emoji: '🍽️', items,
    totals: { calories: 0, protein_g: 0, fat_g: 0, carbs_g: 0 }, confidence: 0.8, provider: 'test', status: 'ok',
    created_at: at.toISOString(), updated_at: at.toISOString(),
  }
}
const at = (day: string, hm: string) => {
  const [y, m, d] = day.split('-').map(Number)
  const [h, mi] = hm.split(':').map(Number)
  return new Date(y, m - 1, d, h, mi)
}

const T: DayTargets = { burned: 2000, deficitMin: 100, deficitMax: 300, proteinTarget: 120 }
// evening, protein short (70/120), carbs already high, fat fine, 600 kcal of room
const EVENING_INTAKE: Intake = { calories: 1300, protein_g: 70, carbs_g: 240, fat_g: 45 }

// two weeks of real-looking habits
const HISTORY: FoodEntry[] = [
  entry('2026-10-01', '08:05', ['yogurt', 'oats'], 'breakfast'),
  entry('2026-10-02', '07:50', ['yogurt'], 'breakfast'),
  entry('2026-10-03', '08:20', ['yogurt', 'oats'], 'breakfast'),
  entry('2026-10-01', '20:10', ['chicken', 'pasta']),
  entry('2026-10-02', '19:40', ['tuna']),
  entry('2026-10-03', '20:30', ['pasta']),
  entry('2026-10-05', '20:05', ['tuna', 'cottage']),
  entry('2026-10-06', '19:55', ['chicken']),
  entry('2026-10-07', '20:15', ['schnitzel']),
  entry('2026-10-08', '20:00', ['tuna']),
]

describe('time of day is a hard filter', () => {
  it('at 20:00 only foods eaten in the evening are candidates — never the breakfast yogurt', () => {
    const r = suggest({ history: HISTORY, intake: EVENING_INTAKE, targets: T, now: at('2026-10-10', '20:00') })
    expect(r.kind).toBe('suggestions')
    const names = r.kind === 'suggestions' ? r.items.map((s) => s.name) : []
    expect(names).not.toContain('יוגורט חלבון')
    expect(names).not.toContain('שיבולת שועל')
    expect(names.length).toBeGreaterThan(0)
    expect(names.length).toBeLessThan(4)
  })

  it('at 13:00 with only breakfast/dinner history: "not enough history", no fallback to other meal times', () => {
    const r = suggest({ history: HISTORY, intake: { calories: 600, protein_g: 30, carbs_g: 90, fat_g: 20 }, targets: T, now: at('2026-10-10', '13:00') })
    expect(r.kind).toBe('not_enough_history')
  })

  it('in the morning the morning foods come back', () => {
    const r = suggest({ history: HISTORY, intake: { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }, targets: T, now: at('2026-10-10', '08:00') })
    expect(r.kind === 'suggestions' && r.items.map((s) => s.name)).toContain('יוגורט חלבון')
    expect(r.kind === 'suggestions' && r.items.some((s) => s.name === 'טונה במים')).toBe(false)
  })

  it('window wraps around midnight; distance is circular', () => {
    expect(minuteDistance(23 * 60 + 30, 30)).toBe(60)
    const night = [entry('2026-10-01', '00:20', ['cottage'], 'snack'), entry('2026-10-02', '23:50', ['cottage'], 'snack'), entry('2026-10-03', '00:10', ['tuna'], 'snack')]
    const r = suggest({ history: night, intake: { calories: 1200, protein_g: 60, carbs_g: 150, fat_g: 40 }, targets: T, now: at('2026-10-10', '23:40') })
    expect(r.kind).toBe('suggestions')
  })

  it('an entry logged on a later day counts at its meal time, not at the moment it was typed in', () => {
    const late = entry('2026-10-04', '08:00', ['tuna'], 'dinner', at('2026-10-05', '09:15'))
    expect(entryMinutes(late)).toBe(20 * 60)
    expect(entryMinutes(entry('2026-10-04', '19:42', ['tuna']))).toBe(19 * 60 + 42)
  })
})

describe('macros decide among the foods of this hour', () => {
  it('protein short + carbs high → lean protein first, carb-heavy pasta not suggested', () => {
    const r = suggest({ history: HISTORY, intake: EVENING_INTAKE, targets: T, now: at('2026-10-10', '20:00') })
    expect(r.kind).toBe('suggestions')
    if (r.kind !== 'suggestions') return
    expect(['טונה במים', 'חזה עוף']).toContain(r.items[0].name)
    expect(r.items.map((s) => s.name)).not.toContain('פסטה')
    // ordered by score
    for (let i = 1; i < r.items.length; i++) expect(r.items[i - 1].score).toBeGreaterThan(r.items[i].score - 1e-9)
  })

  it('macro fit: protein-dense scores high when protein is low and carbs high; carb-heavy scores negative', () => {
    const needs = dailyNeeds(EVENING_INTAKE, T)
    expect(needs).toMatchObject({ protein: 'low', carbs: 'high', fat: 'ok', proteinGap: 50 })
    expect(macroFit({ protein_g: 31, carbs_g: 0, fat_g: 1 }, needs)).toBeGreaterThan(0.3)
    expect(macroFit({ protein_g: 11, carbs_g: 62, fat_g: 2 }, needs)).toBeLessThan(0)
  })

  it('balanced day → no suggestion just for the sake of it', () => {
    const r = suggest({ history: HISTORY, intake: { calories: 1650, protein_g: 125, carbs_g: 180, fat_g: 55 }, targets: T, now: at('2026-10-10', '20:00') })
    expect(r.kind).toBe('balanced')
  })

  it('calorie budget used up → balanced (nothing to add)', () => {
    const r = suggest({ history: HISTORY, intake: { calories: 1880, protein_g: 80, carbs_g: 200, fat_g: 60 }, targets: T, now: at('2026-10-10', '20:00') })
    expect(r.kind).toBe('balanced')
  })

  it('little calorie room → a big portion ranks below a small one', () => {
    expect(calorieFit(140, 600)).toBe(1)
    expect(calorieFit(520, 150)).toBeLessThan(calorieFit(139, 150))
  })
})

describe('reacts to what was logged today', () => {
  it('after logging tuna now, tuna is not suggested again; protein met → no suggestion', () => {
    const now = at('2026-10-10', '20:00')
    const before = suggest({ history: HISTORY, intake: EVENING_INTAKE, targets: T, now })
    expect(before.kind === 'suggestions' && before.items.some((s) => s.name === 'טונה במים')).toBe(true)
    const tunaNow = entry('2026-10-10', '19:55', ['tuna'])
    const after = suggest({ history: [...HISTORY, tunaNow], intake: { ...EVENING_INTAKE, protein_g: 101 }, targets: T, now })
    expect(after.kind === 'suggestions' && after.items.some((s) => s.name === 'טונה במים')).toBe(false)
    const done = suggest({ history: [...HISTORY, tunaNow], intake: { ...EVENING_INTAKE, protein_g: 118 }, targets: T, now })
    expect(done.kind).not.toBe('suggestions')
  })
})

describe('grounded in the log', () => {
  it('empty history → not enough history (nothing invented)', () => {
    expect(suggest({ history: [], intake: EVENING_INTAKE, targets: T, now: at('2026-10-10', '20:00') }).kind).toBe('not_enough_history')
  })

  it('serving = the usual amount (median), nutrients from the recorded per-100 g values', () => {
    const h = [
      entry('2026-10-01', '20:00', [item('chicken', 120)]),
      entry('2026-10-02', '20:00', [item('chicken', 200)]),
      entry('2026-10-03', '20:00', [item('chicken', 150)]),
      entry('2026-10-04', '20:00', ['tuna']),
    ]
    const r = suggest({ history: h, intake: EVENING_INTAKE, targets: T, now: at('2026-10-10', '20:10') })
    const c = r.kind === 'suggestions' ? r.items.find((s) => s.name === 'חזה עוף') : undefined
    expect(c).toMatchObject({ grams: 150, calories: 248, protein_g: 46.5, timesAtThisHour: 3 })
  })

  it('deleted, pending and older-than-90-days entries are ignored', () => {
    const h = [
      { ...entry('2026-10-01', '20:00', ['chicken']), deleted: true },
      { ...entry('2026-10-02', '20:00', ['chicken']), status: 'pending' as const },
      entry('2026-05-01', '20:00', ['chicken']),
      entry('2026-05-02', '20:00', ['tuna']),
      entry('2026-05-03', '20:00', ['tuna']),
    ]
    expect(suggest({ history: h, intake: EVENING_INTAKE, targets: T, now: at('2026-10-10', '20:00') }).kind).toBe('not_enough_history')
  })

  it('at most three suggestions, each a different food', () => {
    const many = Array.from({ length: 6 }, (_, i) => entry(`2026-10-0${i + 1}`, '20:00', ['tuna', 'chicken', 'cottage']))
    const r = suggest({ history: many, intake: EVENING_INTAKE, targets: T, now: at('2026-10-10', '20:00') })
    expect(r.kind === 'suggestions' && r.items.length).toBeLessThan(4)
    const names = r.kind === 'suggestions' ? r.items.map((s) => s.name) : []
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('only nutritious foods are ever suggested', () => {
  // evenings full of junk, eaten MORE often than the healthy dinners
  const JUNKY_EVENINGS: FoodEntry[] = [
    ...['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'].flatMap((d) => [
      entry(d, '20:05', ['chips', 'cookies', 'cola']),
      entry(d, '20:30', ['candy', 'proteinBar', 'mystery']),
    ]),
    entry('2026-10-03', '19:50', ['eggs']),
    entry('2026-10-06', '20:10', ['tuna']),
  ]
  const now = at('2026-10-10', '20:00')

  it('chips, cookies, candy, cola, protein bars and unknown dishes never appear — even when eaten most often and macros fit', () => {
    // protein low AND carbs low: candy/cookies would "fit" carbs, protein bar fits protein, the mystery dish both
    const r = suggest({ history: JUNKY_EVENINGS, intake: { calories: 900, protein_g: 50, carbs_g: 60, fat_g: 30 }, targets: T, now })
    expect(r.kind).toBe('suggestions')
    const names = r.kind === 'suggestions' ? r.items.map((s) => s.name) : []
    for (const junk of ['תפוצ׳יפס', 'עוגיות שוקולד צ׳יפס', 'סוכריות גומי', 'קולה', 'חטיף חלבון', 'מנה מיוחדת']) expect(names).not.toContain(junk)
    expect(names.sort()).toEqual(['ביצה קשה', 'טונה במים'].sort())
    expect(r.kind === 'suggestions' && r.items.every((s) => s.quality > 0)).toBe(true)
  })

  it('only junk around this hour → "nothing suitable", not a junk suggestion and not other meal times', () => {
    const onlyJunk = JUNKY_EVENINGS.filter((e) => !e.items.some((i) => i.name === 'ביצה קשה' || i.name === 'טונה במים'))
    const withBreakfast = [...onlyJunk, entry('2026-10-04', '08:00', ['yogurt'], 'breakfast'), entry('2026-10-05', '08:00', ['yogurt'], 'breakfast')]
    const r = suggest({ history: withBreakfast, intake: EVENING_INTAKE, targets: T, now })
    expect(r.kind).toBe('nothing_fits')
    expect(r.kind === 'nothing_fits' && r.excluded).toBeGreaterThan(3)
  })

  it('schnitzel (fried) is filtered out; chicken breast and tuna remain for the same need', () => {
    const r = suggest({ history: HISTORY, intake: EVENING_INTAKE, targets: T, now })
    const names = r.kind === 'suggestions' ? r.items.map((s) => s.name) : []
    expect(names).not.toContain('שניצל')
    expect(names).toContain('טונה במים')
  })

  it('nutritional quality breaks ties: same fit and habit → the leaner protein first', () => {
    const h = ['2026-10-01', '2026-10-02', '2026-10-03'].flatMap((d) => [entry(d, '20:00', [item('chicken', 150)]), entry(d, '20:00', [item('eggs', 210)])])
    const r = suggest({ history: h, intake: EVENING_INTAKE, targets: T, now })
    expect(r.kind === 'suggestions' && r.items[0].name).toBe('חזה עוף')
  })
})
