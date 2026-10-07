// Supabase Edge Function: POST /functions/v1/mz-config
// Receives the AI provider keys from GitHub Actions and stores them in Vault.
//
// Auth: the GitHub Actions OIDC token (no shared secret needed). Only workflows
// running in MZ_GITHUB_REPO on the main branch are accepted, so forks and pull
// requests of the public repo can't overwrite the keys.
import { createClient } from '@supabase/supabase-js'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { corsHeaders, json } from '../_shared/http.ts'
import { setSecret } from '../_shared/secrets.ts'

const ISSUER = 'https://token.actions.githubusercontent.com'
const AUDIENCE = 'maazan-supabase'
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`))

const Body = z.object({
  GEMINI_API_KEY: z.string().max(300).optional(),
  GROQ_API_KEY: z.string().max(300).optional(),
  OPENROUTER_API_KEY: z.string().max(300).optional(),
  USDA_FDC_API_KEY: z.string().max(300).optional(),
})

const VAULT_NAMES: Record<keyof z.infer<typeof Body>, string> = {
  GEMINI_API_KEY: 'mz_gemini_api_key',
  GROQ_API_KEY: 'mz_groq_api_key',
  OPENROUTER_API_KEY: 'mz_openrouter_api_key',
  USDA_FDC_API_KEY: 'mz_usda_fdc_api_key',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const token = req.headers.get('x-github-oidc') ?? ''
  const repo = (Deno.env.get('MZ_GITHUB_REPO') ?? 'Eithan1710/Calorie-Tracker').toLowerCase()
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: ISSUER, audience: AUDIENCE })
    if (String(payload.repository ?? '').toLowerCase() !== repo || payload.ref !== 'refs/heads/main') {
      return json({ error: 'forbidden' }, 403)
    }
  } catch {
    return json({ error: 'invalid token' }, 401)
  }

  const body = Body.safeParse(await req.json().catch(() => null))
  if (!body.success) return json({ error: 'invalid body' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const stored: string[] = []
  for (const [k, v] of Object.entries(body.data) as [keyof typeof VAULT_NAMES, string | undefined][]) {
    if (v && v.trim()) {
      if (!(await setSecret(admin, VAULT_NAMES[k], v.trim()))) return json({ error: `failed to store ${k}` }, 500)
      stored.push(k)
    }
  }
  return json({ ok: true, stored })
})
