// Supabase Edge Function: POST /functions/v1/mz-register
// Creates a מאזן account from a username + password.
//
// Why a function instead of supabase.auth.signUp() in the browser: accounts use
// synthetic addresses (see _shared/account.ts) that can't receive a
// confirmation email, and this project's Auth settings are shared with another
// app. Creating the user with the admin API marks it confirmed, so the new user
// can sign in immediately with signInWithPassword — the password itself is
// hashed (bcrypt) by Supabase Auth and never stored or logged here.
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { corsHeaders, json } from '../_shared/http.ts'
import { cleanUsername, passwordError, usernameError, usernameToEmail } from '../_shared/account.ts'

const Body = z.object({
  username: z.string().max(100),
  password: z.string().max(200),
})

// Light abuse guard per function instance: at most 5 sign-ups per IP per 10 minutes.
const WINDOW_MS = 10 * 60_000
const MAX_PER_WINDOW = 5
const recent = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS)
  hits.push(now)
  recent.set(ip, hits)
  if (recent.size > 5000) recent.clear()
  return hits.length > MAX_PER_WINDOW
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'bad_request', message: 'POST only' }, 405)

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (rateLimited(ip)) return json({ error: 'rate_limited', message: 'יותר מדי ניסיונות הרשמה. נסה שוב בעוד כמה דקות.' }, 429)

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return json({ error: 'bad_request', message: 'משהו בבקשה לא תקין. נסה שוב.' }, 400)
  const { username, password } = parsed.data

  const uErr = usernameError(username)
  if (uErr) return json({ error: 'invalid_username', message: uErr }, 422)
  const pErr = passwordError(password)
  if (pErr) return json({ error: 'weak_password', message: pErr }, 422)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await admin.auth.admin.createUser({
    email: await usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username: cleanUsername(username), app: 'maazan' },
  })
  if (error) {
    const msg = `${error.message ?? ''}`.toLowerCase()
    if ((error as { code?: string }).code === 'email_exists' || msg.includes('already') || msg.includes('exists')) {
      return json({ error: 'username_taken', message: 'שם המשתמש הזה כבר תפוס. בחר שם אחר.' }, 409)
    }
    if ((error as { code?: string }).code === 'weak_password' || msg.includes('password')) {
      return json({ error: 'weak_password', message: 'הסיסמה חלשה מדי. נסה סיסמה ארוכה יותר.' }, 422)
    }
    console.error('createUser failed', error.message)
    return json({ error: 'unavailable', message: 'ההרשמה נכשלה. נסה שוב בעוד רגע.' }, 500)
  }
  return json({ ok: true }, 201)
})
