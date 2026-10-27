/**
 * NutritionAIProvider abstraction.
 *
 * Every provider takes the same request (system instruction + user text +
 * optional image + JSON schema) and returns raw text. Parsing/validation is
 * done once, centrally, in pipeline.ts — providers are never trusted.
 *
 * Model choice (researched Oct 2026 — free tiers change often, so all of this
 * is configurable through env, no code change needed):
 *  - Primary:  Google Gemini API free tier (AI Studio key, no card). Flash
 *              models: vision + native JSON-schema output + strong reasoning.
 *              Tried in order; a 404 (renamed/retired model) or 429 moves on.
 *  - Fallback: Groq free tier, `qwen/qwen3.8-27b` (then `openai/gpt-oss-120b` for text) — vision + JSON mode, very
 *              fast, separate quota from Google.
 *  - Fallback: OpenRouter `openrouter/free` — routes to whatever free
 *              vision-capable model is currently available.
 *  - Last resort (text only): the deterministic local parser.
 */

export interface ProviderRequest {
  system: string
  /** the same instructions without the food table — for providers with a small per-minute token budget */
  systemCompact?: string
  user: string
  image?: { data: string; mimeType: string }
  jsonSchema: Record<string, unknown>
}

export interface ProviderResponse {
  text: string
  model: string
}

export type ProviderErrorKind = 'rate_limit' | 'unavailable' | 'bad_request' | 'auth' | 'timeout' | 'not_found'

// (no TS parameter properties anywhere in _shared: keeps it runnable by Node's type stripping)
export class ProviderError extends Error {
  kind: ProviderErrorKind
  status?: number
  constructor(kind: ProviderErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
    this.status = status
  }
}

export interface NutritionAIProvider {
  readonly id: string
  readonly supportsVision: boolean
  complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse>
}

export type Env = (key: string) => string | undefined
type FetchFn = typeof fetch

function classify(status: number, body: string): ProviderError {
  if (status === 429) return new ProviderError('rate_limit', `rate limited: ${body.slice(0, 200)}`, status)
  if (status === 401 || status === 403) return new ProviderError('auth', `auth: ${body.slice(0, 200)}`, status)
  if (status === 404) return new ProviderError('not_found', `model not found: ${body.slice(0, 200)}`, status)
  if (status === 400 || status === 422) return new ProviderError('bad_request', `bad request: ${body.slice(0, 300)}`, status)
  return new ProviderError('unavailable', `HTTP ${status}: ${body.slice(0, 200)}`, status)
}

async function post(fetchFn: FetchFn, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  let res: Response
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal })
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || (e as Error)?.name === 'TimeoutError') throw new ProviderError('timeout', 'timeout')
    throw new ProviderError('unavailable', `network: ${(e as Error)?.message ?? e}`)
  }
  const text = await res.text()
  if (!res.ok) throw classify(res.status, text)
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError('unavailable', 'non-JSON HTTP body')
  }
}

// ── Gemini ────────────────────────────────────────────────────────────────

/** Gemini's JSON-schema dialect rejects a few keywords zod emits. */
export function geminiSafeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(geminiSafeSchema)
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(schema)) {
      if (k === '$schema' || k === 'additionalProperties' || k === 'default' || k === '$id') continue
      out[k] = geminiSafeSchema(v)
    }
    return out
  }
  return schema
}

export class GeminiProvider implements NutritionAIProvider {
  readonly id = 'gemini'
  readonly supportsVision = true
  private apiKey: string
  private models: string[]
  private fetchFn: FetchFn
  /**
   * Hedging: if a model hasn't answered after this long, the next model starts in
   * parallel and the first good answer wins (0 = strictly one after another).
   * Production showed Gemini sometimes stalling for the whole budget while an
   * immediate retry answered in ~4 s.
   */
  private hedgeMs: number
  constructor(apiKey: string, models: string[], fetchFn: FetchFn = fetch, hedgeMs = 0) {
    this.apiKey = apiKey
    this.models = models
    this.fetchFn = fetchFn
    this.hedgeMs = hedgeMs
  }

  /** one model, with the plain-JSON retry for models that reject schema/thinking config */
  private async attempt(model: string, req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    try {
      return await this.call(model, req, true, signal)
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('unavailable', String(e))
      if (err.kind !== 'bad_request') throw err
      // older/newer models may reject responseJsonSchema/thinkingConfig — retry plain JSON mode
      return this.call(model, req, false, signal)
    }
  }

  /**
   * Gemini answers 503 "overloaded" in bursts (seen at Israeli evening peak: every model at once).
   * Those clear within seconds, so after a round where all models were overloaded, one more round
   * starts after a short pause — while the overall budget allows; then the fallbacks take over.
   */
  async complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    try {
      return await this.round(req, signal)
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError('unavailable', String(e))
      if (!(err.kind === 'unavailable' && (err.status === 503 || err.status === 500)) || signal?.aborted) throw err
      await new Promise((r) => setTimeout(r, this.retryPauseMs))
      if (signal?.aborted) throw err
      return this.round(req, signal)
    }
  }

  retryPauseMs = 1500

  private round(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    return new Promise((resolve, reject) => {
      const controllers: AbortController[] = []
      let next = 0
      let pending = 0
      let done = false
      let lastErr: ProviderError | null = null
      let hedge: ReturnType<typeof setTimeout> | undefined
      const finish = (fn: () => void) => {
        if (done) return
        done = true
        clearTimeout(hedge)
        controllers.forEach((c) => c.abort())
        fn()
      }
      const failIfExhausted = () => {
        if (!done && pending === 0 && next >= this.models.length) finish(() => reject(lastErr ?? new ProviderError('unavailable', 'no gemini models configured')))
      }
      const launch = () => {
        if (done || next >= this.models.length) return failIfExhausted()
        const model = this.models[next++]
        const c = new AbortController()
        controllers.push(c)
        pending++
        this.attempt(model, req, signal ? AbortSignal.any([signal, c.signal]) : c.signal).then(
          (r) => finish(() => resolve(r)),
          (e) => {
            pending--
            if (done) return
            lastErr = e instanceof ProviderError ? e : new ProviderError('unavailable', String(e))
            // wrong key, or the overall budget is spent → stop; anything else → next model
            if (lastErr.kind === 'auth' || signal?.aborted) return finish(() => reject(lastErr))
            launch()
            failIfExhausted()
          },
        )
        clearTimeout(hedge)
        if (this.hedgeMs > 0 && next < this.models.length) hedge = setTimeout(() => !done && launch(), this.hedgeMs)
      }
      if (signal?.aborted) return reject(new ProviderError('timeout', 'timeout'))
      signal?.addEventListener('abort', () => finish(() => reject(lastErr?.kind === 'timeout' ? lastErr : new ProviderError('timeout', 'timeout'))), { once: true })
      launch()
    })
  }

  private async call(model: string, req: ProviderRequest, rich: boolean, signal?: AbortSignal): Promise<ProviderResponse> {
    const parts: unknown[] = [{ text: req.user }]
    if (req.image) parts.push({ inlineData: { mimeType: req.image.mimeType, data: req.image.data } })
    const generationConfig: Record<string, unknown> = { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 4096 }
    if (rich) {
      generationConfig.responseJsonSchema = geminiSafeSchema(req.jsonSchema)
      if (/^gemini-[3-9]/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: 'low' }
      else if (/^gemini-2\.5/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 1024 }
    }
    const json = await post(
      this.fetchFn,
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': this.apiKey },
      { systemInstruction: { parts: [{ text: req.system }] }, contents: [{ role: 'user', parts }], generationConfig },
      signal,
    )
    const cand = json?.candidates?.[0]
    const text: string = (cand?.content?.parts ?? [])
      .filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === 'string')
      .map((p: { text: string }) => p.text)
      .join('')
    if (!text) {
      const reason = cand?.finishReason ?? json?.promptFeedback?.blockReason ?? 'empty'
      throw new ProviderError('unavailable', `empty response (${reason})`)
    }
    return { text, model }
  }
}

// ── OpenAI-compatible (Groq, OpenRouter, …) ────────────────────────────────

export class OpenAICompatProvider implements NutritionAIProvider {
  readonly id: string
  readonly supportsVision: boolean
  private baseUrl: string
  private apiKey: string
  /** tried in order: a model the provider retired (404) falls through to the next one */
  private models: string[]
  private extraHeaders: Record<string, string>
  private extraBody: Record<string, unknown>
  private fetchFn: FetchFn
  /** small per-minute token budget (Groq free tier: 8K TPM incl. max_tokens) → send the compact prompt */
  compact = false
  maxTokens = 3000
  constructor(
    id: string,
    baseUrl: string,
    apiKey: string,
    model: string,
    supportsVision: boolean,
    extraHeaders: Record<string, string> = {},
    extraBody: Record<string, unknown> = {},
    fetchFn: FetchFn = fetch,
  ) {
    this.id = id
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.models = [...new Set(model.split(',').map((m) => m.trim()).filter(Boolean))]
    this.supportsVision = supportsVision
    this.extraHeaders = extraHeaders
    this.extraBody = extraBody
    this.fetchFn = fetchFn
  }

  async complete(req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    // text-only models can't take a photo: only the multimodal ones are tried then
    const models = req.image ? this.models.filter((m) => !TEXT_ONLY_MODEL.test(m)) : this.models
    let last: unknown = new ProviderError('not_found', 'no model configured')
    for (const model of models) {
      try {
        return await this.callModel(model, req, signal)
      } catch (e) {
        last = e
        if (!(e instanceof ProviderError && e.kind === 'not_found')) throw e
      }
    }
    throw last
  }

  private async callModel(model: string, req: ProviderRequest, signal?: AbortSignal): Promise<ProviderResponse> {
    const compactReq = req.systemCompact ? { ...req, system: req.systemCompact } : req
    const first = this.compact ? compactReq : req
    try {
      return await this.call(model, first, true, signal)
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'bad_request') return this.call(model, first, false, signal)
      // 413: the request is over the provider's token budget — once more without the food table
      if (e instanceof ProviderError && e.status === 413 && first !== compactReq) return this.call(model, compactReq, true, signal)
      throw e
    }
  }

  private async call(model: string, req: ProviderRequest, rich: boolean, signal?: AbortSignal): Promise<ProviderResponse> {
    const userContent: unknown[] = [{ type: 'text', text: req.user }]
    if (req.image) userContent.push({ type: 'image_url', image_url: { url: `data:${req.image.mimeType};base64,${req.image.data}` } })
    const body: Record<string, unknown> = {
      model,
      temperature: 0.2,
      max_tokens: this.maxTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.image ? userContent : req.user },
      ],
    }
    if (rich) Object.assign(body, { response_format: { type: 'json_object' } }, this.extraBody)
    const json = await post(this.fetchFn, `${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.apiKey}`, ...this.extraHeaders }, body, signal)
    const text: string | undefined = json?.choices?.[0]?.message?.content
    if (!text) throw new ProviderError('unavailable', 'empty response')
    return { text, model: json?.model ?? model }
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

export const DEFAULT_GEMINI_MODELS = 'gemini-3.5-flash,gemini-3-flash-preview' // gemini-2.5-flash: 404 since Oct 2026
/**
 * Groq renames its preview models often (qwen3.6 → qwen3.8 returned 404 on 26.10.2026): a list, tried
 * in order on 404. qwen3.8-27b is multimodal + JSON mode (preview); gpt-oss-120b is production, text only.
 */
export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b,openai/gpt-oss-120b'
/** models that take no image input */
const TEXT_ONLY_MODEL = /gpt-oss|llama-3\.|whisper/i
export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free'

export function providersFromEnv(env: Env, fetchFn: FetchFn = fetch): NutritionAIProvider[] {
  const order = (env('AI_PROVIDER_ORDER') ?? 'gemini,groq,openrouter').split(',').map((s) => s.trim()).filter(Boolean)
  const list: NutritionAIProvider[] = []
  for (const id of order) {
    if (id === 'gemini' && env('GEMINI_API_KEY')) {
      const models = (env('GEMINI_MODELS') ?? DEFAULT_GEMINI_MODELS).split(',').map((s) => s.trim()).filter(Boolean)
      list.push(new GeminiProvider(env('GEMINI_API_KEY')!, models, fetchFn, Number(env('GEMINI_HEDGE_MS') ?? 8000)))
    }
    if (id === 'groq' && env('GROQ_API_KEY')) {
      const groq = new OpenAICompatProvider(
        'groq',
        'https://api.groq.com/openai/v1',
        env('GROQ_API_KEY')!,
        [env('GROQ_MODEL'), DEFAULT_GROQ_MODEL].filter(Boolean).join(','),
        (env('GROQ_VISION') ?? 'true') !== 'false',
        {},
        { reasoning_format: 'hidden' },
        fetchFn,
      )
      // free tier: 8K tokens per minute *including* max_tokens — the full prompt (~8.5K) answered 413
      groq.compact = true
      groq.maxTokens = 2500
      list.push(groq)
    }
    if (id === 'openrouter' && env('OPENROUTER_API_KEY')) {
      list.push(
        new OpenAICompatProvider(
          'openrouter',
          'https://openrouter.ai/api/v1',
          env('OPENROUTER_API_KEY')!,
          env('OPENROUTER_MODEL') ?? DEFAULT_OPENROUTER_MODEL,
          (env('OPENROUTER_VISION') ?? 'true') !== 'false',
          { 'x-title': 'Maazan calorie tracker' },
          {},
          fetchFn,
        ),
      )
    }
  }
  return list
}

/** Pull the first JSON object out of a model reply (handles ```json fences and <think> blocks). */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    const start = t.indexOf('{')
    const end = t.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
    return undefined
  }
}
