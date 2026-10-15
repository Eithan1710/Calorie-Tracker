import type { Analysis, AnalyzeRequest } from '../../supabase/functions/_shared/schema.ts'
import { API_BASE, SUPABASE_ANON_KEY } from './config'
import { getAccessToken } from './auth'
import type { PhotoFlowTimer } from './perf'

export type AnalyzeOutcome =
  | { ok: true; analysis: Analysis; offline?: boolean }
  | { ok: false; code: string; message: string; clarification?: string | null; canQueue?: boolean }

const MSG = {
  unclear: 'לא הצלחתי לנתח את האוכל. נסה לתאר קצת יותר את הכמות.',
  offline: 'אין חיבור כרגע. שמרתי את מה שכתבת — ננתח אוטומטית כשהחיבור יחזור.',
  unavailable: 'הניתוח לא זמין כרגע. נסה שוב בעוד רגע.',
  photoOffline: 'אין חיבור כרגע, וניתוח תמונה דורש אינטרנט. אפשר לכתוב מה אכלת.',
  slow: 'הניתוח לוקח יותר מדי זמן. נסה שוב בעוד רגע.',
}

// Not needed to open the app or send a photo: zod (response validation) and the offline
// parser (with its food table) load in the background — the response takes seconds anyway.
const schemaModule = () => import('../../supabase/functions/_shared/schema.ts')
const parserModule = () => import('../../supabase/functions/_shared/localParser.ts')

/**
 * Load the offline parser + validation right after the first screen is up, so logging
 * still works if the connection drops later (the installed app also has them cached).
 */
export function preloadOffline(extra: Promise<unknown>[] = []): Promise<void> {
  return Promise.all([schemaModule(), parserModule(), ...extra]).then(
    () => {
      ;(window as unknown as { __mzOfflineReady?: boolean }).__mzOfflineReady = true
    },
    () => {},
  )
}

async function localFallback(text: string, reason: 'offline' | 'unavailable'): Promise<AnalyzeOutcome> {
  const mod = await parserModule().catch(() => null)
  if (!mod) return { ok: false, code: reason, message: reason === 'offline' ? MSG.offline : MSG.unavailable, canQueue: true }
  const { parseLocally } = mod
  const local = parseLocally(text)
  if (local.analysis && local.unmatched.length === 0) return { ok: true, analysis: local.analysis, offline: true }
  if (local.analysis) {
    local.analysis.clarification = `לא זיהיתי בלי AI: ${local.unmatched.join(', ')}`
    return { ok: true, analysis: local.analysis, offline: true }
  }
  return { ok: false, code: reason, message: reason === 'offline' ? MSG.offline : MSG.unavailable, canQueue: true }
}

async function post(body: AnalyzeRequest, timeoutMs: number, timer?: PhotoFlowTimer): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (SUPABASE_ANON_KEY) {
    // the analyze function only serves signed-in users: send the session's access token
    const token = await getAccessToken().catch(() => null)
    headers.authorization = `Bearer ${token ?? SUPABASE_ANON_KEY}`
    headers.apikey = SUPABASE_ANON_KEY
  }
  const payload = JSON.stringify(body)
  timer?.sent(payload.length)
  return fetch(`${API_BASE}/analyze-food`, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(timeoutMs) })
}

const isTimeout = (e: unknown) => (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError'

/** identical requests in flight share one network call (double taps, retries racing) */
const inflight = new Map<string, Promise<AnalyzeOutcome>>()

async function call(body: AnalyzeRequest, timer?: PhotoFlowTimer): Promise<AnalyzeOutcome> {
  const key = JSON.stringify([body.mode, body.text, body.correction, body.image?.data.length, body.image?.data.slice(-64)])
  const running = inflight.get(key)
  if (running) return running
  const p = callOnce(body, timer).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function callOnce(body: AnalyzeRequest, timer?: PhotoFlowTimer): Promise<AnalyzeOutcome> {
  const isPhoto = Boolean(body.image)
  const text = body.text ?? ''
  void schemaModule().catch(() => {}) // warm up while the request is in flight
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (isPhoto) return { ok: false, code: 'offline', message: MSG.photoOffline }
    if (body.mode === 'analyze') return localFallback(text, 'offline')
    return { ok: false, code: 'offline', message: MSG.offline }
  }
  let res: Response | null = null
  // one quick retry when the connection drops (mobile networks); never after a timeout
  for (let attempt = 0; attempt < 2 && !res; attempt++) {
    try {
      res = await post(body, 30_000, timer)
    } catch (e) {
      if (isTimeout(e)) return isPhoto || body.mode !== 'analyze' ? { ok: false, code: 'timeout', message: MSG.slow } : localFallback(text, 'unavailable')
      if (attempt === 0 && navigator.onLine !== false) {
        await new Promise((r) => setTimeout(r, 700))
        continue
      }
      if (isPhoto) return { ok: false, code: 'offline', message: MSG.photoOffline }
      return body.mode === 'analyze' ? localFallback(text, 'offline') : { ok: false, code: 'offline', message: MSG.unavailable }
    }
  }
  if (!res) return { ok: false, code: 'unavailable', message: MSG.unavailable }
  timer?.received(res.headers.get('server-timing'))
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* non-JSON */
  }
  if (res.ok) {
    // the server is trusted more than the model, but still validate before saving
    const schema = await schemaModule().catch(() => null)
    if (!schema) return { ok: false, code: 'unavailable', message: MSG.unavailable }
    const parsed = schema.AnalysisSchema.safeParse(json)
    if (parsed.success) return { ok: true, analysis: parsed.data }
    return body.mode === 'analyze' && !isPhoto ? localFallback(text, 'unavailable') : { ok: false, code: 'invalid', message: MSG.unclear }
  }
  const err = (json ?? {}) as { error?: string; message?: string; clarification?: string | null }
  if ((res.status === 401 || res.status === 404 || res.status >= 500) && body.mode === 'analyze' && !isPhoto) {
    // auth missing / no backend deployed / provider outage → deterministic parser still helps
    const fb = await localFallback(text, 'unavailable')
    if (fb.ok) return fb
  }
  return {
    ok: false,
    code: err.error ?? 'unavailable',
    message: err.message ?? MSG.unavailable,
    clarification: err.clarification ?? null,
  }
}

export function analyzeText(text: string) {
  return call({ mode: 'analyze', text })
}

export function analyzePhoto(image: { data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }, note = '', timer?: PhotoFlowTimer) {
  return call({ mode: 'analyze', text: note, image }, timer)
}

export function correctAnalysis(previous: Analysis, correction: string, originalText = '') {
  return call({
    mode: 'correct',
    text: originalText,
    correction,
    previous: previous.items.map((i) => ({ name: i.name, grams: i.grams, db_key: i.db_key ?? null })),
  })
}
