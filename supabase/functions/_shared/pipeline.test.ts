import { describe, expect, it, vi } from 'vitest'
import { analyzeFood, buildSystemPrompt } from './pipeline.ts'
import { extractJson, GeminiProvider, OpenAICompatProvider, ProviderError, providersFromEnv, type NutritionAIProvider } from './providers.ts'
import { NUTRITION_SKILL } from './skill.generated.ts'
import { withGrams } from './nutrition.ts'
import { readFileSync } from 'node:fs'

const noEnv = (extra: Record<string, string> = {}) => (k: string) => ({ USDA_FDC_DISABLED: 'true', ...extra })[k]

const fake = (id: string, reply: string | (() => never), vision = true): NutritionAIProvider => ({
  id,
  supportsVision: vision,
  complete: vi.fn(async () => {
    if (typeof reply === 'function') reply()
    return { text: reply as string, model: `${id}-model` }
  }),
})

const burgerJson = JSON.stringify({
  status: 'ok',
  meal_title_he: 'ההמבורגר שלך',
  emoji: '🍔',
  items: [
    { name_he: 'המבורגר', name_en: 'beef patty', db_key: 'ground_beef_raw', grams: 200, state: 'raw', confidence: 0.8, assumptions: ['משקל נא'] },
    { name_he: 'לחמנייה', name_en: 'bun', db_key: 'roll', grams: 70, state: 'as_sold', confidence: 0.8, assumptions: [] },
    {
      name_he: 'רוטב הבית', name_en: 'burger sauce', db_key: null, grams: 30, grams_low: 20, grams_high: 40, state: 'as_sold',
      est_per100: { kcal: 400, protein_g: 1, fat_g: 40, carbs_g: 8 }, confidence: 0.5, assumptions: ['כמות רוטב משוערת'],
    },
  ],
  clarification_he: null,
  overall_confidence: 0.7,
})

describe('analyzeFood pipeline', () => {
  it('computes nutrients from the table, not from the model', async () => {
    const r = await analyzeFood({ mode: 'analyze', text: 'המבורגר 200 גרם עם לחמנייה' }, { env: noEnv(), providers: [fake('a', burgerJson)] })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [patty, bun, sauce] = r.analysis.items
    expect(patty.source).toBe('db')
    expect(patty.calories).toBe(508) // 200 g × 254
    expect(patty.protein_g).toBeCloseTo(34.4)
    expect(bun.calories).toBe(195) // 70 × 2.79
    expect(sauce.source).toBe('ai')
    expect(sauce.confidence).toBeLessThanOrEqual(0.5)
    expect(r.analysis.totals.calories).toBe(508 + 195 + 120)
    expect(r.analysis.totals.calories_low).toBeLessThan(r.analysis.totals.calories)
    expect(r.analysis.totals.calories_high).toBeGreaterThan(r.analysis.totals.calories)
    expect(r.analysis.provider).toBe('a')
  })

  it('falls back to the next provider on invalid JSON', async () => {
    const bad = fake('bad', '{"items": "lots of food", "calories": "about 600"}')
    const good = fake('good', burgerJson)
    const r = await analyzeFood({ mode: 'analyze', text: 'המבורגר' }, { env: noEnv(), providers: [bad, good] })
    expect(r.ok && r.analysis.provider).toBe('good')
  })

  it('falls back on malformed (non-JSON) output', async () => {
    const r = await analyzeFood(
      { mode: 'analyze', text: 'המבורגר' },
      { env: noEnv(), providers: [fake('x', 'Sure! Here is your analysis: about 700 calories'), fake('y', burgerJson)] },
    )
    expect(r.ok && r.analysis.provider).toBe('y')
  })

  it('falls back on rate limits / API errors', async () => {
    const limited = fake('limited', () => { throw new ProviderError('rate_limit', '429', 429) })
    const r = await analyzeFood({ mode: 'analyze', text: 'המבורגר' }, { env: noEnv(), providers: [limited, fake('b', burgerJson)] })
    expect(r.ok && r.analysis.provider).toBe('b')
  })

  it('uses the offline parser when every provider fails (text)', async () => {
    const down = fake('down', () => { throw new ProviderError('unavailable', '503', 503) })
    const r = await analyzeFood({ mode: 'analyze', text: '3 ביצים ו2 פרוסות לחם' }, { env: noEnv(), providers: [down] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.analysis.provider).toBe('local')
      expect(r.analysis.items.map((i) => i.db_key)).toEqual(['egg', 'bread_white'])
    }
  })

  it('returns a friendly error when nothing works', async () => {
    const down = fake('down', () => { throw new ProviderError('unavailable', '503', 503) })
    const r = await analyzeFood({ mode: 'analyze', text: 'משהו מוזר שאין לו שם' }, { env: noEnv(), providers: [down] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('unavailable')
      expect(r.message).toMatch(/[֐-׿]/)
    }
  })

  it('skips text-only providers for photos and reports unclear images', async () => {
    const textOnly = fake('textonly', burgerJson, false)
    const unclear = fake('vision', JSON.stringify({ status: 'unclear', meal_title_he: '', emoji: '', items: [], overall_confidence: 0.1 }))
    const r = await analyzeFood({ mode: 'analyze', text: '', image: { data: 'AAAA', mimeType: 'image/jpeg' } }, { env: noEnv(), providers: [textOnly, unclear] })
    expect(textOnly.complete).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('unclear_image')
      expect(r.message).toContain('התמונה')
    }
  })

  it('reports not_food', async () => {
    const r = await analyzeFood(
      { mode: 'analyze', text: 'מה השעה' },
      { env: noEnv(), providers: [fake('a', JSON.stringify({ status: 'not_food', items: [], overall_confidence: 0.9 }))] },
    )
    expect(!r.ok && r.error).toBe('not_food')
  })

  it('repairs implausible AI per-100g values using Atwater factors', async () => {
    const json = JSON.stringify({
      status: 'ok', meal_title_he: 'x', emoji: '🍽️', overall_confidence: 0.6,
      items: [{ name_he: 'מאפה', name_en: 'pastry', db_key: null, grams: 100, state: 'as_sold', confidence: 0.6, assumptions: [], est_per100: { kcal: 50, protein_g: 10, fat_g: 20, carbs_g: 40 } }],
    })
    const r = await analyzeFood({ mode: 'analyze', text: 'מאפה' }, { env: noEnv(), providers: [fake('a', json)] })
    expect(r.ok && r.analysis.items[0].calories).toBe(380)
  })

  it('drops items that cannot be computed and asks the user', async () => {
    const json = JSON.stringify({
      status: 'ok', meal_title_he: 'x', emoji: '🍽️', overall_confidence: 0.6,
      items: [
        { name_he: 'ביצה', name_en: 'egg', db_key: 'egg', grams: 50, state: 'as_sold', confidence: 0.8, assumptions: [] },
        { name_he: '???', name_en: '', db_key: 'not_a_key', grams: 100, state: 'unknown', confidence: 0.3, assumptions: [] },
      ],
    })
    const r = await analyzeFood({ mode: 'analyze', text: 'ביצה ו???' }, { env: noEnv(), providers: [fake('a', json)] })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.analysis.items).toHaveLength(1)
      expect(r.analysis.clarification).toBeTruthy()
    }
  })

  it('uses USDA FDC for foods outside the table when the hit agrees with the estimate', async () => {
    const json = JSON.stringify({
      status: 'ok', meal_title_he: 'כבד', emoji: '🍖', overall_confidence: 0.7,
      items: [{ name_he: 'כבד עוף', name_en: 'chicken liver pan-fried', db_key: null, grams: 150, state: 'cooked', confidence: 0.7, assumptions: [], est_per100: { kcal: 170, protein_g: 25, fat_g: 7, carbs_g: 1 } }],
    })
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ foods: [{ description: 'Chicken, liver, pan-fried', foodNutrients: [
        { nutrientId: 1008, unitName: 'KCAL', value: 172 }, { nutrientId: 1003, value: 25.8 }, { nutrientId: 1004, value: 6.4 }, { nutrientId: 1005, value: 1.1 },
      ] }] })),
    ) as unknown as typeof fetch
    const r = await analyzeFood({ mode: 'analyze', text: 'כבד עוף' }, { env: (k) => (k === 'USDA_FDC_API_KEY' ? 'k' : undefined), providers: [fake('a', json)], fetchFn })
    expect(r.ok && r.analysis.items[0].source).toBe('usda')
    expect(r.ok && r.analysis.items[0].calories).toBe(258)
  })

  it('sends previous items + correction in correction mode', async () => {
    const p = fake('a', burgerJson)
    await analyzeFood(
      { mode: 'correct', text: '', previous: [{ name: 'אורז', grams: 200, db_key: 'rice_white_cooked' }], correction: 'זה היה 250 גרם אורז' },
      { env: noEnv(), providers: [p] },
    )
    const req = (p.complete as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(req.user).toContain('CORRECTION MODE')
    expect(req.user).toContain('250 גרם אורז')
    expect(req.user).toContain('rice_white_cooked')
  })

  it('rejects empty requests', async () => {
    const r = await analyzeFood({ mode: 'analyze', text: '' }, { env: noEnv(), providers: [] })
    expect(!r.ok && r.error).toBe('bad_request')
  })
})

describe('providers', () => {
  const okGemini = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text }] } }] }))

  it('Gemini: moves to the next model on 404 / 429 and strips thought parts', async () => {
    const calls: string[] = []
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url)
      if (url.includes('model-a')) return new Response('gone', { status: 404 })
      if (url.includes('model-b')) return new Response('quota', { status: 429 })
      return okGemini('{"ok":1}')
    }) as unknown as typeof fetch
    const g = new GeminiProvider('key', ['model-a', 'model-b', 'model-c'], fetchFn)
    const r = await g.complete({ system: 's', user: 'u', jsonSchema: {} })
    expect(r).toEqual({ text: '{"ok":1}', model: 'model-c' })
    expect(calls).toHaveLength(3)
  })

  it('Gemini: retries without schema/thinking config on 400', async () => {
    const bodies: Record<string, unknown>[] = []
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      bodies.push(body)
      return body.generationConfig.responseJsonSchema ? new Response('bad schema', { status: 400 }) : okGemini('{}')
    }) as unknown as typeof fetch
    await new GeminiProvider('key', ['gemini-3.5-flash'], fetchFn).complete({ system: 's', user: 'u', jsonSchema: { type: 'object' } })
    expect(bodies).toHaveLength(2)
    expect((bodies[0].generationConfig as Record<string, unknown>).thinkingConfig).toBeTruthy()
    expect((bodies[1].generationConfig as Record<string, unknown>).thinkingConfig).toBeUndefined()
  })

  it('Gemini: auth errors are not retried across models', async () => {
    const fetchFn = vi.fn(async () => new Response('denied', { status: 403 })) as unknown as typeof fetch
    await expect(new GeminiProvider('bad', ['a', 'b'], fetchFn).complete({ system: 's', user: 'u', jsonSchema: {} })).rejects.toMatchObject({ kind: 'auth' })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('OpenAI-compatible: sends image as data URL with JSON mode', async () => {
    let body: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: '{"a":1}' } }] }))
    }) as unknown as typeof fetch
    const p = new OpenAICompatProvider('groq', 'https://x', 'k', 'm', true, {}, {}, fetchFn)
    await p.complete({ system: 's', user: 'u', image: { data: 'QUJD', mimeType: 'image/jpeg' }, jsonSchema: {} })
    expect(JSON.stringify(body.messages)).toContain('data:image/jpeg;base64,QUJD')
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('builds the provider chain from env in the configured order', () => {
    const env = (k: string) => ({ GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q', OPENROUTER_API_KEY: 'o', AI_PROVIDER_ORDER: 'groq,gemini' })[k]
    expect(providersFromEnv(env).map((p) => p.id)).toEqual(['groq', 'gemini'])
    expect(providersFromEnv(() => undefined)).toEqual([])
  })

  it('extractJson handles fences, think blocks and surrounding prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('<think>hmm {no}</think>{"a":2}')).toEqual({ a: 2 })
    expect(extractJson('Here you go: {"a":3} hope it helps')).toEqual({ a: 3 })
    expect(extractJson('no json here')).toBeUndefined()
  })
})

describe('skill + corrections', () => {
  it('system prompt embeds the up-to-date SKILL.md and the table', () => {
    const md = readFileSync('skills/nutrition-analysis/SKILL.md', 'utf8').replace(/^---[\s\S]*?---\s*/, '')
    expect(NUTRITION_SKILL).toBe(md)
    const sys = buildSystemPrompt()
    expect(sys).toContain('chicken_breast_cooked')
    expect(sys).toContain('Never present an estimate as exact')
  })

  it('editing grams recalculates nutrients and removes the range', async () => {
    const r = await analyzeFood({ mode: 'analyze', text: 'x' }, { env: noEnv(), providers: [fake('a', burgerJson)] })
    if (!r.ok) throw new Error('expected ok')
    const sauce = r.analysis.items[2]
    const edited = withGrams(sauce, 15)
    expect(edited.calories).toBe(60)
    expect(edited.grams_low).toBeUndefined()
    expect(edited.confidence).toBeGreaterThan(sauce.confidence)
  })
})
