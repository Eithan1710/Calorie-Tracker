/**
 * Local API for `npm run dev` / `npm run preview`: serves POST /api/analyze-food
 * with the same pipeline the Supabase Edge Function uses. Keys are read from
 * .env on the server side only (no VITE_ prefix → never bundled into the app).
 */
import type { Plugin, Connect } from 'vite'
import { loadEnv } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

const MAX_BODY = 6 * 1024 * 1024

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function apiPlugin(): Plugin {
  let env: Record<string, string> = {}
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (!req.url?.startsWith('/api/analyze-food')) return next()
    if (req.method !== 'POST') return send(res, 405, { error: 'bad_request', message: 'POST only' })
    try {
      const [{ analyzeFood }, { AnalyzeRequestSchema }] = await Promise.all([
        import('../supabase/functions/_shared/pipeline.ts'),
        import('../supabase/functions/_shared/schema.ts'),
      ])
      const parsed = AnalyzeRequestSchema.safeParse(JSON.parse(await readBody(req)))
      if (!parsed.success) return send(res, 400, { error: 'bad_request', message: 'משהו בבקשה לא תקין. נסה שוב.' })
      const result = await analyzeFood(parsed.data, {
        env: (k) => env[k] ?? process.env[k],
        log: (e) => console.log(`[analyze-food] ${e.ok ? 'ok' : 'fail'} provider=${e.provider} model=${e.model ?? '-'} ${e.latency_ms}ms`, e.attempts.length ? e.attempts : ''),
      })
      if (result.ok) return send(res, 200, result.analysis)
      return send(res, result.error === 'unavailable' ? 503 : 422, { error: result.error, message: result.message, clarification: result.clarification ?? null })
    } catch (e) {
      console.error('[analyze-food]', e)
      return send(res, 400, { error: 'bad_request', message: 'משהו בבקשה לא תקין. נסה שוב.' })
    }
  }
  return {
    name: 'maazan-local-api',
    configResolved(config) {
      env = loadEnv(config.mode, config.envDir ?? process.cwd(), '')
    },
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
