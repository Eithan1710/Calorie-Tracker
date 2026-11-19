// One-off: where does the time go? Each model alone with the real prompt, then the real pipeline.
import { analyzeFood, buildSystemPrompt, buildCompactSystemPrompt, buildUserPrompt, AI_JSON_SCHEMA } from '../../supabase/functions/_shared/pipeline.ts'
import { GeminiProvider, OpenAICompatProvider, DEFAULT_GEMINI_MODELS, DEFAULT_GROQ_MODEL } from '../../supabase/functions/_shared/providers.ts'
const env = (k) => process.env[k]
const req = { mode: 'analyze', text: 'ציקן לימון 1,300 קלוריות בסך הכול:\n\n\t•\tחלבון: כ-60 גרם\n\t•\tפחמימות: כ-160 גרם\n\t•\tשומן: כ-40 גרם' }
const preq = { system: buildSystemPrompt(), systemCompact: buildCompactSystemPrompt(), user: buildUserPrompt(req), jsonSchema: AI_JSON_SCHEMA }
const time = async (label, fn) => { const t = Date.now(); try { const r = await fn(); console.log(`${label}: OK ${Date.now() - t} ms model=${r.model}`) } catch (e) { console.log(`${label}: FAIL ${Date.now() - t} ms ${e.kind ?? ''} ${e.status ?? ''} ${String(e.message).slice(0, 200)}`) } }
for (let round = 1; round <= 2; round++) {
  for (const m of DEFAULT_GEMINI_MODELS.split(',')) await time(`r${round} gemini ${m}`, () => new GeminiProvider(env('GEMINI_API_KEY'), [m]).complete(preq, AbortSignal.timeout(45000)))
  for (const m of DEFAULT_GROQ_MODEL.split(',')) {
    const g = new OpenAICompatProvider('groq', 'https://api.groq.com/openai/v1', env('GROQ_API_KEY'), m, true, {}, { reasoning_format: 'hidden' })
    g.compact = true; g.maxTokens = 2500
    await time(`r${round} groq ${m}`, () => g.complete(preq, AbortSignal.timeout(45000)))
  }
}
const t = Date.now()
const r = await analyzeFood(req, { env })
console.log(`pipeline: ${Date.now() - t} ms`, r.ok ? JSON.stringify(r.analysis.totals) + ' ' + r.analysis.provider : r.error)
