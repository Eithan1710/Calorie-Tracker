import { AnalysisSchema, type Analysis, type AnalyzeRequest } from '../../supabase/functions/_shared/schema.ts'
import { parseLocally } from '../../supabase/functions/_shared/localParser.ts'
import { API_BASE, SUPABASE_ANON_KEY } from './config'
import { getAccessToken } from './supabase'

export type AnalyzeOutcome =
  | { ok: true; analysis: Analysis; offline?: boolean }
  | { ok: false; code: string; message: string; clarification?: string | null; canQueue?: boolean }

const MSG = {
  unclear: 'לא הצלחתי לנתח את האוכל. נסה לתאר קצת יותר את הכמות.',
  offline: 'אין חיבור כרגע. שמרתי את מה שכתבת — ננתח אוטומטית כשהחיבור יחזור.',
  unavailable: 'הניתוח לא זמין כרגע. נסה שוב בעוד רגע.',
  photoOffline: 'אין חיבור כרגע, וניתוח תמונה דורש אינטרנט. אפשר לכתוב מה אכלת.',
}

function localFallback(text: string, reason: 'offline' | 'unavailable'): AnalyzeOutcome {
  const local = parseLocally(text)
  if (local.analysis && local.unmatched.length === 0) return { ok: true, analysis: local.analysis, offline: true }
  if (local.analysis) {
    local.analysis.clarification = `לא זיהיתי בלי AI: ${local.unmatched.join(', ')}`
    return { ok: true, analysis: local.analysis, offline: true }
  }
  return { ok: false, code: reason, message: reason === 'offline' ? MSG.offline : MSG.unavailable, canQueue: true }
}

async function post(body: AnalyzeRequest, timeoutMs = 35000): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = await getAccessToken()
  if (token) headers.authorization = `Bearer ${token}`
  else if (SUPABASE_ANON_KEY) headers.authorization = `Bearer ${SUPABASE_ANON_KEY}`
  if (SUPABASE_ANON_KEY) headers.apikey = SUPABASE_ANON_KEY
  return fetch(`${API_BASE}/analyze-food`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
}

async function call(body: AnalyzeRequest): Promise<AnalyzeOutcome> {
  const isPhoto = Boolean(body.image)
  const text = body.text ?? ''
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (isPhoto) return { ok: false, code: 'offline', message: MSG.photoOffline }
    if (body.mode === 'analyze') return localFallback(text, 'offline')
    return { ok: false, code: 'offline', message: MSG.offline }
  }
  let res: Response
  try {
    res = await post(body)
  } catch {
    if (isPhoto) return { ok: false, code: 'offline', message: MSG.photoOffline }
    return body.mode === 'analyze' ? localFallback(text, 'offline') : { ok: false, code: 'offline', message: MSG.unavailable }
  }
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  if (res.ok) {
    // the server is trusted more than the model, but still validate before saving
    const parsed = AnalysisSchema.safeParse(json)
    if (parsed.success) return { ok: true, analysis: parsed.data }
    return body.mode === 'analyze' && !isPhoto ? localFallback(text, 'unavailable') : { ok: false, code: 'invalid', message: MSG.unclear }
  }
  const err = (json ?? {}) as { error?: string; message?: string; clarification?: string | null }
  if ((res.status === 401 || res.status === 404 || res.status >= 500) && body.mode === 'analyze' && !isPhoto) {
    // auth missing / no backend deployed / provider outage → deterministic parser still helps
    const fb = localFallback(text, 'unavailable')
    if (fb.ok) return fb
  }
  return {
    ok: false,
    code: err.error ?? 'unavailable',
    message: err.message ?? (res.status === 401 ? 'צריך להתחבר (בהגדרות) כדי להשתמש בניתוח החכם.' : MSG.unavailable),
    clarification: err.clarification ?? null,
  }
}

export function analyzeText(text: string) {
  return call({ mode: 'analyze', text })
}

export function analyzePhoto(image: { data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }, note = '') {
  return call({ mode: 'analyze', text: note, image })
}

export function correctAnalysis(previous: Analysis, correction: string, originalText = '') {
  return call({
    mode: 'correct',
    text: originalText,
    correction,
    previous: previous.items.map((i) => ({ name: i.name, grams: i.grams, db_key: i.db_key ?? null })),
  })
}
