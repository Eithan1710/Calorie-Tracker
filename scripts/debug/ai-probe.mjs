// One-off: which Gemini models answer, and how fast (the real prompt). Never prints keys.
import { buildSystemPrompt, buildCompactSystemPrompt, buildUserPrompt, AI_JSON_SCHEMA } from '../../supabase/functions/_shared/pipeline.ts'
import { GeminiProvider } from '../../supabase/functions/_shared/providers.ts'
const KEY = process.env.GEMINI_API_KEY
const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': KEY } })
const all = ((await r.json()).models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace('models/', ''))
console.log('models:', all.filter((n) => /flash|pro/.test(n)).join(' '))
const cands = all.filter((n) => /^gemini-(3|2\.5)/.test(n) && /flash/.test(n) && !/image|tts|audio|live|embedding/.test(n))
const req = { mode: 'analyze', text: 'חזה עוף 150 גרם עם אורז ושני פרוסות לחם' }
const preq = { system: buildSystemPrompt(), systemCompact: buildCompactSystemPrompt(), user: buildUserPrompt(req), jsonSchema: AI_JSON_SCHEMA }
for (let round = 1; round <= 2; round++)
  for (const m of cands) {
    const t = Date.now()
    try { const res = await new GeminiProvider(KEY, [m]).complete(preq, AbortSignal.timeout(30000)); console.log(`r${round} ${m}: OK ${Date.now() - t} ms ${res.text.length} chars`) }
    catch (e) { console.log(`r${round} ${m}: FAIL ${Date.now() - t} ms ${e.kind ?? ''} ${e.status ?? ''} ${String(e.message).slice(0, 90).replace(/\s+/g, ' ')}`) }
  }
