// One-off: the real pipeline with the production defaults (no Groq: its key is invalid). Never prints keys.
import { analyzeFood } from '../../supabase/functions/_shared/pipeline.ts'
const env = (k) => (k === 'GROQ_API_KEY' ? undefined : process.env[k])
for (const text of ['חזה עוף 150 גרם עם אורז ושני פרוסות לחם', 'פריכיות', 'ציקן לימון 1,300 קלוריות', 'ציקן לימון 1,300 קלוריות בסך הכול:\n\t•\tחלבון: כ-60 גרם\n\t•\tפחמימות: כ-160 גרם\n\t•\tשומן: כ-40 גרם']) {
  const logs = []
  const t = Date.now()
  const r = await analyzeFood({ mode: 'analyze', text }, { env, log: (l) => logs.push(l) })
  console.log(`run "${text.split('\n')[0]}": ${Date.now() - t} ms`, r.ok ? `${r.analysis.provider} ${r.analysis.model ?? ''} ${JSON.stringify(r.analysis.totals)}` : r.error, JSON.stringify(logs[0]?.attempts ?? []))
}
