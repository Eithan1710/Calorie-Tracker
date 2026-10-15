// AI photo-analysis benchmark (runs in GitHub Actions with the repo's AI secrets; never prints keys).
//   node scripts/perf/bench-ai.mjs  → perf-out/ai.json + perf-out/ai.md
// Same 5 public food photos (Wikimedia Commons) for every configuration; measures the
// provider call (wall time + Gemini token usage) and runs the real pipeline on the reply.
import { mkdirSync, writeFileSync } from 'node:fs'
import { analyzeFood, buildSystemPrompt, AI_JSON_SCHEMA } from '../../supabase/functions/_shared/pipeline.ts'
import { geminiSafeSchema } from '../../supabase/functions/_shared/providers.ts'

const OUT = 'perf-out'
mkdirSync(OUT, { recursive: true })
const KEY = process.env.GEMINI_API_KEY
const GROQ = process.env.GROQ_API_KEY
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = { models: {}, images: [], runs: [], notes: [] }

// ── available models ──
if (KEY) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': KEY } })
  const j = await r.json()
  out.models.gemini = (j.models ?? []).filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent')).map((m) => m.name.replace('models/', '')).filter((n) => /flash|pro/.test(n))
}
if (GROQ) {
  const r = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${GROQ}` } })
  const j = await r.json().catch(() => ({}))
  out.models.groq = (j.data ?? []).map((m) => m.id)
}

// ── images: real food photos, two sizes (Commons thumbnails are JPEG) ──
const TERMS = ['shakshuka', 'hummus plate pita', 'schnitzel rice salad', 'omelette breakfast plate', 'spaghetti bolognese plate']
for (const term of TERMS) {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(`filetype:bitmap ${term}`)}&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1280`
  const j = await (await fetch(api, { headers: { 'user-agent': 'maazan-bench/1.0 (personal app benchmark)' } })).json()
  const pages = Object.values(j.query?.pages ?? {}).filter((p) => p.imageinfo?.[0]?.mime === 'image/jpeg' && p.imageinfo[0].width >= 1400)
  const p = pages[0]
  if (!p) { out.notes.push(`no image for ${term}`); continue }
  const t1280 = p.imageinfo[0].thumburl
  const t1024 = t1280.replace(/\/1280px-/, '/1024px-')
  const get = async (u) => Buffer.from(await (await fetch(u, { headers: { 'user-agent': 'maazan-bench/1.0' } })).arrayBuffer()).toString('base64')
  out.images.push({ term, title: p.title, b1280: await get(t1280), b1024: await get(t1024) })
}

// ── one Gemini call with explicit settings, usage recorded ──
async function gemini(model, thinking, b64, system) {
  const generationConfig = { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 4096, responseJsonSchema: geminiSafeSchema(AI_JSON_SCHEMA) }
  if (thinking) generationConfig.thinkingConfig = /^gemini-2\.5/.test(model) ? { thinkingBudget: thinking === 'minimal' ? 0 : 1024 } : { thinkingLevel: thinking }
  const t0 = performance.now()
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: 'Analyse the food in this photo.' }, { inlineData: { mimeType: 'image/jpeg', data: b64 } }] }], generationConfig }),
  })
  const ms = Math.round(performance.now() - t0)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) return { ms, error: `${res.status} ${(j.error?.message ?? '').slice(0, 120)}` }
  const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought && p.text).map((p) => p.text).join('')
  const u = j.usageMetadata ?? {}
  return { ms, text, usage: { prompt: u.promptTokenCount, thoughts: u.thoughtsTokenCount ?? 0, output: u.candidatesTokenCount, cached: u.cachedContentTokenCount ?? 0 } }
}

async function groq(model, b64, system) {
  const t0 = performance.now()
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${GROQ}` },
    body: JSON.stringify({ model, temperature: 0.2, max_tokens: 3000, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: 'Analyse the food in this photo.' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }] }] }),
  })
  const ms = Math.round(performance.now() - t0)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) return { ms, error: `${res.status} ${(j.error?.message ?? '').slice(0, 120)}` }
  return { ms, text: j.choices?.[0]?.message?.content ?? '' }
}

/** reply → the app's real pipeline (validation, nutrient lookup, totals); no DB, no USDA live calls */
async function toTotals(text) {
  const provider = { id: 'bench', supportsVision: true, complete: async () => ({ text, model: 'bench' }) }
  const env = (k) => ({ USDA_FDC_DISABLED: 'true' })[k]
  const r = await analyzeFood({ mode: 'analyze', text: '', image: { data: 'x', mimeType: 'image/jpeg' } }, { env, providers: [provider] })
  return r.ok ? { kcal: r.analysis.totals.calories, protein: r.analysis.totals.protein_g, items: r.analysis.items.map((i) => `${i.name} ${i.grams}g`).join(', ') } : { error: r.error }
}

const system = buildSystemPrompt()
out.prompt_chars = system.length
const g = out.models.gemini ?? []
const primary = g.includes('gemini-3.5-flash') ? 'gemini-3.5-flash' : g.find((m) => /^gemini-3.*flash$/.test(m)) ?? g[0]
const lite = g.find((m) => /flash-lite$/.test(m) && /^gemini-3/.test(m)) ?? g.find((m) => /flash-lite/.test(m) && !/preview|exp/.test(m))
const configs = [
  { id: 'A current: low thinking, 1280px', model: primary, thinking: 'low', size: 'b1280', rounds: 2 },
  { id: 'B minimal thinking, 1280px', model: primary, thinking: 'minimal', size: 'b1280', rounds: 2 },
  { id: 'C minimal thinking, 1024px', model: primary, thinking: 'minimal', size: 'b1024', rounds: 1 },
  ...(lite ? [{ id: `D ${lite}, minimal, 1024px`, model: lite, thinking: 'minimal', size: 'b1024', rounds: 1 }] : []),
]
if (KEY && primary) {
  for (const c of configs) {
    for (let round = 0; round < c.rounds; round++) {
      for (const img of out.images) {
        const r = await gemini(c.model, c.thinking, img[c.size], system)
        const totals = r.text ? await toTotals(r.text) : null
        out.runs.push({ config: c.id, model: c.model, image: img.term, round, ms: r.ms, error: r.error, usage: r.usage, img_kb: Math.round((img[c.size].length * 3) / 4 / 1024), ...totals })
        console.log(c.id, img.term, r.ms, r.error ?? '', totals?.kcal ?? '')
        await sleep(6500) // stay well inside free-tier rate limits
      }
    }
  }
}
// Groq fallback candidates: which vision models answer at all, and how fast
const groqVision = (out.models.groq ?? []).filter((m) => /llama-4|scout|maverick|vision|qwen.*vl/i.test(m)).slice(0, 2)
if (GROQ && out.images[0]) {
  for (const m of ['qwen/qwen3.6-27b', ...groqVision]) {
    const r = await groq(m, out.images[0].b1024, system)
    const totals = r.text ? await toTotals(r.text) : null
    out.runs.push({ config: `groq ${m}`, model: m, image: out.images[0].term, ms: r.ms, error: r.error, ...totals })
    await sleep(3000)
  }
}

// ── summary ──
const by = {}
for (const r of out.runs) (by[r.config] ??= []).push(r)
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null }
let md = `# AI photo benchmark\n\nsystem prompt: ${out.prompt_chars} chars · images: ${out.images.map((i) => i.title).join('; ')}\n\n| config | ok/n | median ms | max ms | median thoughts tok | median output tok | prompt tok |\n|---|---|---|---|---|---|---|\n`
for (const [k, rs] of Object.entries(by)) {
  const ok = rs.filter((r) => !r.error && r.kcal)
  md += `| ${k} | ${ok.length}/${rs.length} | ${med(ok.map((r) => r.ms))} | ${Math.max(...ok.map((r) => r.ms), 0)} | ${med(ok.map((r) => r.usage?.thoughts ?? 0))} | ${med(ok.map((r) => r.usage?.output ?? 0))} | ${med(ok.map((r) => r.usage?.prompt ?? 0))} |\n`
}
md += `\n## kcal per image (accuracy consistency vs. A)\n\n| image | ${Object.keys(by).join(' | ')} |\n|---|${Object.keys(by).map(() => '---').join('|')}|\n`
for (const img of out.images) md += `| ${img.term} | ${Object.values(by).map((rs) => rs.filter((r) => r.image === img.term).map((r) => r.error ? 'ERR' : r.kcal ?? '—').join(' / ')).join(' | ')} |\n`
md += `\nGemini models: ${(out.models.gemini ?? []).join(', ')}\n\nGroq models: ${(out.models.groq ?? []).join(', ')}\n\nnotes: ${out.notes.join('; ')}\n`
writeFileSync(`${OUT}/ai.md`, md)
for (const i of out.images) { delete i.b1280; delete i.b1024 }
writeFileSync(`${OUT}/ai.json`, JSON.stringify(out, null, 2))
console.log(md)
