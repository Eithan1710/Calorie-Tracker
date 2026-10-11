import { describe, expect, it } from 'vitest'
import { FOOD_BY_KEY, FOODS } from './foodDb.ts'
import { parseLocally } from './localParser.ts'
import { analyzeFood } from './pipeline.ts'
import { curatedAsDbFood, itemFromDb, normFood, pickCandidate, searchCurated, type DbFood, type SearchFoods } from './foodMatch.ts'
import type { NutritionAIProvider } from './providers.ts'

/**
 * Food-database quality and accuracy suite.
 *
 * Reference values are the published per-100 g records named in each comment
 * (moh:<code> = Israeli Ministry of Health national nutrition DB, fdc:<id> =
 * USDA FoodData Central, off:<barcode> = product label). The CI job
 * "food data" additionally rebuilds the curated table from the raw datasets and
 * fails if any number differs from its source record.
 */

// ── 1. curated table integrity ───────────────────────────────────────────────
describe('curated table: structure and plausibility', () => {
  it('covers the everyday Israeli foods', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(200)
    for (const k of ['pita', 'laffa', 'hummus', 'tahini', 'falafel', 'shakshuka', 'schnitzel', 'shawarma', 'kebab', 'sabich',
      'salad_veg', 'salad_oil', 'cottage_5', 'white_cheese_5', 'labane', 'bamba', 'bissli', 'chocolate_milk', 'milky',
      'couscous_cooked', 'ptitim_cooked', 'majadra', 'malawach', 'jachnun', 'burekas', 'rugelach', 'protein_yogurt']) {
      expect(FOOD_BY_KEY[k], k).toBeDefined()
    }
  })

  it.each(FOODS.map((f) => [f.key, f] as const))('%s: has a source, valid links and plausible numbers', (_k, f) => {
    if (f.verification !== 'estimate') expect(Boolean(f.ref), `${f.key} ref`).toBe(true)
    expect(['official', 'label', 'recipe', 'community', 'estimate']).toContain(f.verification)
    expect(['raw', 'cooked', 'as_sold']).toContain(f.state)
    for (const k of f.includes ?? []) expect(FOOD_BY_KEY[k], `${f.key} includes ${k}`).toBeDefined()
    if (f.pair) {
      const other = FOOD_BY_KEY[f.pair]
      expect(other, `${f.key} pair`).toBeDefined()
      expect(other.state === f.state, `${f.key} pair has the other state`).toBe(false)
    }
    if (f.no_oil) {
      expect(f.fat_added, `${f.key} with no_oil must include oil`).toBe(true)
      expect(Boolean(FOOD_BY_KEY[f.no_oil]?.fat_added), `${f.no_oil} must not include oil`).toBe(false)
      expect(FOOD_BY_KEY[f.no_oil].kcal).toBeLessThanOrEqual(f.kcal)
    }
    expect(f.kcal).toBeGreaterThanOrEqual(0)
    expect(f.kcal).toBeLessThanOrEqual(900)
    expect(f.p + f.f + f.c).toBeLessThanOrEqual(101)
    if (f.sug !== undefined) expect(f.sug).toBeLessThanOrEqual(f.c + 1.5)
    if (f.sat !== undefined) expect(f.sat).toBeLessThanOrEqual(f.f + 0.6)
    for (const [u, g] of Object.entries(f.units)) {
      expect(g, `${f.key}.${u}`).toBeGreaterThan(0)
      expect(g, `${f.key}.${u}`).toBeLessThanOrEqual(1000)
    }
  })

  it('no alias points to two different foods', () => {
    const seen = new Map<string, string>()
    const clashes: string[] = []
    for (const f of FOODS) {
      for (const a of new Set([f.he, ...f.aliases].map(normFood))) {
        const prev = seen.get(a)
        if (prev && prev !== f.key) clashes.push(`${a}: ${prev} / ${f.key}`)
        seen.set(a, f.key)
      }
    }
    expect(clashes).toEqual([])
  })

  it('fixes the old wrong aliases', () => {
    const key = (t: string) => parseLocally(t).analysis?.items[0]?.db_key
    expect(key('כרובית')).toBe('cauliflower') // was mapped to broccoli
    expect(key('מלון')).toBe('melon') // was watermelon
    expect(key('מרק עוף')).toBe('chicken_soup') // was vegetable soup
    expect(key('טורטיה')).toBe('tortilla') // was laffa
    expect(key("ג'חנון")).toBe('jachnun') // was malawach
    expect(key('שמן')).toBe('oil')
    expect(key('שמן זית')).toBe('olive_oil')
  })
})

// ── 2. accuracy against reference records (deterministic parser) ─────────────
const kcal = (text: string) => parseLocally(text).analysis!.totals.calories
const keys = (text: string) => parseLocally(text).analysis!.items.map((i) => i.db_key)

describe('reference accuracy: everyday Israeli inputs', () => {
  it('180 g cooked couscous uses the cooked record', () => {
    // moh:10127 couscous cooked without oil = 175 kcal/100 g → 315
    expect(keys('180 גרם קוסקוס מבושל')).toEqual(['couscous_cooked'])
    expect(kcal('180 גרם קוסקוס מבושל')).toBe(315)
  })

  it('two eggs and two slices of bread', () => {
    // moh:1561 egg 143 × 100 g = 143; moh:1919 white bread 264 × 60 g = 158.4
    expect(kcal('2 ביצים ו-2 פרוסות לחם')).toBe(143 + 158)
  })

  it('a pita with 100 g hummus', () => {
    // moh:1946 pita 227 × 100 g; moh:1640 hummus salad 269 × 100 g
    expect(keys('פיתה עם 100 גרם חומוס')).toEqual(['pita', 'hummus'])
    expect(kcal('פיתה עם 100 גרם חומוס')).toBe(227 + 269)
  })

  it('150 g chicken breast with 8 g oil counts the oil once', () => {
    // moh:805 roasted breast 160 × 1.5 = 240; moh:4449 oil 884 × 0.08 = 70.7
    const a = parseLocally('150 גרם חזה עוף ו-8 גרם שמן').analysis!
    expect(a.items.map((i) => i.db_key)).toEqual(['chicken_breast_cooked', 'oil'])
    expect(a.totals.calories).toBe(240 + 71)
  })

  it('a dish cooked with stated oil switches to its no-oil record', () => {
    // shakshuka with oil moh:1590 (101) → without oil moh:1594 (67) because the oil is listed
    const a = parseLocally('300 גרם שקשוקה עם כף שמן זית').analysis!
    expect(a.items.map((i) => i.db_key)).toEqual(['shakshuka_no_oil', 'olive_oil'])
    expect(a.items[0].calories).toBe(201)
  })

  it('raw and cooked are different records', () => {
    expect(kcal('200 גרם אורז לא מבושל')).toBe(730) // moh:2730 raw rice 365
    expect(kcal('200 גרם אורז')).toBe(260) // moh:2721 cooked rice 130
    expect(kcal('200 גרם חזה עוף נא')).toBe(240) // fdc:171077 raw breast 120
    expect(kcal('200 גרם חזה עוף')).toBe(320) // moh:805 roasted 160
  })

  it('Israeli dairy and snacks', () => {
    expect(kcal("גביע קוטג' 5%")).toBe(238) // moh:494 Tnuva 5% = 95 × 250 g
    expect(kcal('גבינה לבנה 3% 100 גרם')).toBe(82) // moh:8595
    expect(kcal('שקית במבה')).toBe(134) // moh:2581 534 × 25 g
    expect(kcal('שוקו בשקית')).toBe(113) // moh:158 Tnuva 2% = 50 × 225 ml
    expect(kcal('דנונה פרו')).toBe(116) // off:7290112336712 label 58 × 200 g
  })

  it('street food as a standard recipe, without double counting', () => {
    // recipe: pita 100 + fried eggplant 80 + egg 50 + tahini 30 + salad 50 + amba 10 (all MoH records)
    const a = parseLocally('סביח עם טחינה').analysis!
    expect(a.items.map((i) => i.db_key)).toEqual(['sabich'])
    expect(a.items[0].origin).toBe('recipe')
  })

  it('every item says where its numbers came from', () => {
    for (const it of parseLocally("2 ביצים, פיתה, קוטג', 150 גרם חזה עוף").analysis!.items) {
      expect(it.ref).toMatch(/^cur:/)
      expect(it.verification).toBeDefined()
      expect(it.basis).toBeDefined()
    }
  })
})

// ── 3. search and matching ───────────────────────────────────────────────────
describe('curated search (offline)', () => {
  const top = (q: string) => searchCurated(q, 3).map((r) => r.ref.key)
  it('finds Hebrew, English, typos and prefixed words', () => {
    expect(top('קוטג')[0]).toBe('cottage_5')
    expect(top('קוטג׳ 3%')[0]).toBe('cottage_3')
    expect(top('cottage')).toContain('cottage_5')
    expect(top('שניצל')[0]).toBe('schnitzel')
    expect(top('שניצצל')[0]).toBe('schnitzel') // typo
    expect(top('והחומוס')[0]).toBe('hummus') // prefix
    expect(top('אורז')[0]).toBe('rice_white_cooked')
  })
  it('normalises like the database', () => {
    expect(normFood('קוטג׳ 5%')).toBe('קוטג 5%')
    expect(normFood("ג'חנון")).toBe('גחנונ')
    expect(normFood('תפו"א')).toBe('תפוא')
  })
})

const row = (o: Partial<DbFood> & Pick<DbFood, 'id' | 'kcal'>): DbFood => ({
  source: 'moh', verification: 'official', name_he: o.id, name_en: null, brand: null, state: 'as_sold', fat_added: false,
  protein_g: 5, fat_g: 3, carbs_g: 5, servings: [], score: 1, ...o,
})

describe('pickCandidate', () => {
  const target = { name_he: 'יוגורט חלבון תות', brand: 'דנונה', state: 'as_sold' as const, est_per100: { kcal: 65, protein_g: 10, fat_g: 0, carbs_g: 5 } }
  it('prefers the stated brand', () => {
    const m = pickCandidate([row({ id: 'moh:1', kcal: 70, score: 1.1 }), row({ id: 'off:2', kcal: 65, score: 0.95, source: 'off', verification: 'label', brand: 'דנונה' })], target, { statedOil: false })
    expect(m?.food.id).toBe('off:2')
  })
  it('rejects records whose energy contradicts the description', () => {
    expect(pickCandidate([row({ id: 'moh:3', kcal: 400, score: 1.3 })], { ...target, brand: null }, { statedOil: false })).toBeNull()
  })
  it('a community entry does not beat an equally relevant official one', () => {
    const m = pickCandidate([row({ id: 'off:4', kcal: 65, score: 1.0, source: 'off', verification: 'community' }), row({ id: 'moh:5', kcal: 66, score: 1.14 })], { ...target, brand: null }, { statedOil: false })
    expect(m?.food.id).toBe('moh:5')
  })
  it('avoids "fried in oil" records when the oil is logged separately', () => {
    const t = { name_he: 'חזה עוף', state: 'cooked' as const, est_per100: { kcal: 165, protein_g: 31, fat_g: 4, carbs_g: 0 } }
    const cands = [row({ id: 'moh:fried', kcal: 190, score: 1.15, fat_added: true, state: 'cooked' }), row({ id: 'moh:plain', kcal: 160, score: 1.05, state: 'cooked' })]
    expect(pickCandidate(cands, t, { statedOil: true })?.food.id).toBe('moh:plain')
  })
  it('respects raw vs cooked', () => {
    const t = { name_he: 'חזה עוף', state: 'raw' as const, est_per100: { kcal: 120, protein_g: 22, fat_g: 3, carbs_g: 0 } }
    const cands = [row({ id: 'moh:cooked', kcal: 160, score: 1.2, state: 'cooked' }), row({ id: 'fdc:raw', kcal: 120, score: 1.0, state: 'raw', source: 'usda' })]
    expect(pickCandidate(cands, t, { statedOil: false })?.food.id).toBe('fdc:raw')
  })
  it('builds an item that keeps provenance', () => {
    const it = itemFromDb(row({ id: 'off:7290112336712', kcal: 58, protein_g: 10.5, fat_g: 0, carbs_g: 3.3, source: 'off', verification: 'label', brand: 'דנונה' }), 200)
    expect(it.calories).toBe(116)
    expect(it.ref).toBe('off:7290112336712')
    expect(it.verification).toBe('label')
    expect(it.basis).toBe('stated')
    const cur = itemFromDb(curatedAsDbFood(FOOD_BY_KEY.pita), 100, 'counted')
    expect(cur.db_key).toBe('pita')
    expect(cur.ref).toBe('cur:pita')
  })
})

// ── 4. natural-language pipeline with the food database ─────────────────────
const ai = (items: object[], extra: object = {}): NutritionAIProvider => ({
  id: 'fake',
  supportsVision: true,
  complete: async () => ({ text: JSON.stringify({ status: 'ok', meal_title_he: 'ארוחה', emoji: '🍽️', overall_confidence: 0.7, items, ...extra }), model: 'm' }),
})
const env = (k: string) => ({ USDA_FDC_DISABLED: 'true' })[k as 'USDA_FDC_DISABLED']
const item = (o: object) => ({ name_en: '', db_key: null, state: 'as_sold', confidence: 0.8, assumptions: [], quantity_basis: 'stated', ...o })

describe('pipeline + food database', () => {
  it('a branded Israeli yogurt resolves to the exact product', async () => {
    const searchFoods: SearchFoods = async () => [
      row({ id: 'moh:62', kcal: 65, score: 1.05, name_he: 'יוגורט 3% שומן תנובה' }),
      row({ id: 'off:7290110566975', kcal: 65, protein_g: 10, fat_g: 0, carbs_g: 5.6, score: 0.95, source: 'off', verification: 'community', name_he: 'יוגורט דנונה פרו בטעם תות', brand: 'דנונה' }),
    ]
    const r = await analyzeFood({ mode: 'analyze', text: 'יוגורט דנונה פרו תות' }, {
      env, searchFoods,
      providers: [ai([item({ name_he: 'יוגורט דנונה PRO תות', brand: 'דנונה', grams: 200, quantity_basis: 'counted', est_per100: { kcal: 65, protein_g: 10, fat_g: 0, carbs_g: 5.6 } })])],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const it = r.analysis.items[0]
    expect(it.ref).toBe('off:7290110566975')
    expect(it.calories).toBe(130)
    expect(it.protein_g).toBe(20)
    expect(it.verification).toBe('community')
  })

  it('an AI guess never replaces a database value; a bad match is refused', async () => {
    const searchFoods: SearchFoods = async () => [row({ id: 'moh:9', kcal: 520, score: 1.3 })]
    const r = await analyzeFood({ mode: 'analyze', text: 'מרק' }, {
      env, searchFoods,
      providers: [ai([item({ name_he: 'מרק כתום', grams: 300, quantity_basis: 'estimated', est_per100: { kcal: 40, protein_g: 1, fat_g: 1, carbs_g: 6 } })])],
    })
    expect(r.ok && r.analysis.items[0].source).toBe('ai')
    expect(r.ok && r.analysis.items[0].verification).toBe('estimate')
  })

  it('an assumed oil is dropped when the dish already includes frying oil', async () => {
    const r = await analyzeFood({ mode: 'analyze', text: 'שניצל' }, {
      env,
      providers: [ai([
        item({ name_he: 'שניצל', db_key: 'schnitzel', grams: 146, quantity_basis: 'counted', state: 'cooked' }),
        item({ name_he: 'שמן לטיגון', db_key: 'oil', grams: 10, quantity_basis: 'estimated' }),
      ])],
    })
    expect(r.ok && r.analysis.items.map((i) => i.db_key)).toEqual(['schnitzel'])
    expect(r.ok && r.analysis.totals.calories).toBe(394) // moh:818 270 × 1.46
  })

  it('a stated oil is kept and the dish switches to its no-oil record', async () => {
    const r = await analyzeFood({ mode: 'analyze', text: 'אורז ביתי עם 10 גרם שמן' }, {
      env,
      providers: [ai([
        item({ name_he: 'אורז', db_key: 'rice_home', grams: 200, state: 'cooked' }),
        item({ name_he: 'שמן', db_key: 'oil', grams: 10 }),
      ])],
    })
    expect(r.ok && r.analysis.items.map((i) => i.db_key)).toEqual(['rice_white_cooked', 'oil'])
    expect(r.ok && r.analysis.totals.calories).toBe(260 + 88)
  })

  it('asks raw-or-cooked when the state is unknown and it matters', async () => {
    const r = await analyzeFood({ mode: 'analyze', text: '250 גרם אורז' }, {
      env,
      providers: [ai([item({ name_he: 'אורז', db_key: 'rice_white_cooked', grams: 250, state: 'unknown' })])],
    })
    expect(r.ok && r.analysis.clarification).toMatch(/לפני או אחרי בישול/)
  })

  it('a database outage does not break analysis', async () => {
    const searchFoods: SearchFoods = async () => { throw new Error('down') }
    const r = await analyzeFood({ mode: 'analyze', text: 'כבד עוף' }, {
      env, searchFoods,
      providers: [ai([item({ name_he: 'כבד עוף', grams: 150, state: 'cooked', est_per100: { kcal: 170, protein_g: 25, fat_g: 7, carbs_g: 1 } })])],
    })
    expect(r.ok && r.analysis.items[0].source).toBe('ai')
  })

  it('a database row linked to a curated food uses the curated record', async () => {
    const searchFoods: SearchFoods = async () => [{ ...curatedAsDbFood(FOOD_BY_KEY.laffa, 1.2) }]
    const r = await analyzeFood({ mode: 'analyze', text: 'לאפה' }, {
      env, searchFoods,
      providers: [ai([item({ name_he: 'לאפה', grams: 130, quantity_basis: 'counted', est_per100: { kcal: 260, protein_g: 8, fat_g: 3, carbs_g: 50 } })])],
    })
    expect(r.ok && r.analysis.items[0].db_key).toBe('laffa')
    expect(r.ok && r.analysis.items[0].calories).toBe(317) // off:7290016475067 244 × 1.3
  })
})
