import { createHash, randomUUID } from 'node:crypto'
import type { BrowserContext, Route } from '@playwright/test'

/**
 * A tiny in-memory stand-in for the Supabase endpoints the app uses
 * (Auth password sign-in, PostgREST tables incl. mz_members, and
 * Storage), mounted with Playwright routing. Like the real database it
 * enforces row ownership: every read returns only the caller's rows and a
 * write with someone else's user_id is rejected, so the UI can be tested for
 * per-account isolation without a live project.
 */

export const MOCK_URL = 'https://mock.supabase.test'

interface User {
  id: string
  email: string
  username: string
  password: string
}

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (sub: string) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`

/** Same mapping as supabase/functions/_shared/account.ts */
export function emailFor(username: string) {
  const norm = username.normalize('NFKC').trim().toLowerCase()
  return `u${createHash('sha256').update(`maazan:${norm}`).digest('hex').slice(0, 40)}@users.maazan.app`
}

export class MockSupabase {
  users: User[] = []
  tables: Record<string, Record<string, unknown>[]> = {}
  objects = new Map<string, { owner: string; size: number }>()
  rejectedWrites = 0

  /** Like public.mz_create_member: an Auth user + a mz_members row. Auth stores "maazan:" + password. */
  addUser(username: string, password: string, { member = true } = {}): User {
    const u = { id: randomUUID(), email: emailFor(username), username, password: `maazan:${password}` }
    this.users.push(u)
    if (member) (this.tables.mz_members ??= []).push({ user_id: u.id, username })
    return u
  }

  rows(table: string, userId?: string) {
    return (this.tables[table] ?? []).filter((r) => !userId || r.user_id === userId)
  }

  private session(u: User) {
    return {
      access_token: jwt(u.id),
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `r-${u.id}`,
      user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, user_metadata: { username: u.username, app: 'maazan' }, app_metadata: { provider: 'email' }, created_at: new Date().toISOString() },
    }
  }

  private caller(route: Route): User | null {
    const auth = route.request().headers()['authorization'] ?? ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const parts = token.split('.')
    if (parts.length !== 3) return null
    try {
      const sub = JSON.parse(Buffer.from(parts[1], 'base64url').toString()).sub
      return this.users.find((u) => u.id === sub) ?? null
    } catch {
      return null
    }
  }

  async install(context: BrowserContext) {
    await context.route(`${MOCK_URL}/**`, (route) => this.handle(route))
  }

  private json(route: Route, status: number, body: unknown) {
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } })
  }

  private async handle(route: Route) {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    }

    // ── functions ──
    if (path.startsWith('/functions/v1/')) return this.json(route, 404, { error: 'not found' })

    // ── auth ──
    if (path === '/auth/v1/token') {
      const body = req.postDataJSON() as { email?: string; password?: string; refresh_token?: string }
      if (url.searchParams.get('grant_type') === 'refresh_token') {
        const u = this.users.find((x) => `r-${x.id}` === body.refresh_token)
        return u ? this.json(route, 200, this.session(u)) : this.json(route, 400, { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' })
      }
      const u = this.users.find((x) => x.email === body.email && x.password === body.password)
      if (!u) return this.json(route, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', message: 'Invalid login credentials' })
      return this.json(route, 200, this.session(u))
    }
    if (path === '/auth/v1/user') {
      const u = this.caller(route)
      return u ? this.json(route, 200, this.session(u).user) : this.json(route, 401, { message: 'invalid JWT' })
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })

    // ── storage ──
    if (path.startsWith('/storage/v1/object/sign/')) {
      const u = this.caller(route)
      const key = decodeURIComponent(path.replace('/storage/v1/object/sign/mz-food-photos/', ''))
      if (!u || !key.startsWith(`${u.id}/`) || !this.objects.has(key)) return this.json(route, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
      return this.json(route, 200, { signedURL: `/object/sign/mz-food-photos/${key}?token=t` })
    }
    if (path.startsWith('/storage/v1/object/mz-food-photos/')) {
      const u = this.caller(route)
      const key = decodeURIComponent(path.replace('/storage/v1/object/mz-food-photos/', ''))
      if (!u || !key.startsWith(`${u.id}/`)) {
        this.rejectedWrites++
        return this.json(route, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
      }
      this.objects.set(key, { owner: u.id, size: req.postDataBuffer()?.length ?? 0 })
      return this.json(route, 200, { Key: `mz-food-photos/${key}`, Id: randomUUID() })
    }
    if (path.startsWith('/storage/v1/')) return this.json(route, 200, [])

    // ── PostgREST with owner-only "RLS" ──
    if (path.startsWith('/rest/v1/rpc/')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    if (path.startsWith('/rest/v1/')) {
      const table = path.replace('/rest/v1/', '')
      const u = this.caller(route)
      if (!u) return this.json(route, 401, { code: '42501', message: 'permission denied' })
      const method = req.method()
      // like the real policies: non-members get nothing from any mz_ table
      const member = this.rows('mz_members', u.id).length > 0
      if (!member && table !== 'mz_members') {
        if (method === 'GET' || method === 'HEAD') return this.json(route, 200, [])
        this.rejectedWrites++
        return this.json(route, 403, { code: '42501', message: 'new row violates row-level security policy' })
      }
      if (method === 'GET' || method === 'HEAD') {
        const rows = this.rows(table, u.id)
        const accept = req.headers()['accept'] ?? ''
        if (accept.includes('vnd.pgrst.object')) return rows.length === 1 ? this.json(route, 200, rows[0]) : this.json(route, 406, { code: 'PGRST116', details: 'The result contains 0 rows', hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
        return this.json(route, 200, rows)
      }
      if (method === 'POST' || method === 'PATCH') {
        const body = req.postDataJSON()
        const incoming = (Array.isArray(body) ? body : [body]) as Record<string, unknown>[]
        if (incoming.some((r) => r.user_id !== undefined && r.user_id !== u.id)) {
          this.rejectedWrites++
          return this.json(route, 403, { code: '42501', message: 'new row violates row-level security policy' })
        }
        const t = (this.tables[table] ??= [])
        for (const r of incoming) {
          const row = { ...r, user_id: u.id }
          const key = (x: Record<string, unknown>) => (x.id ? `id:${x.id}` : x.date ? `d:${x.user_id}:${x.date}` : x.endpoint ? `e:${x.endpoint}` : `u:${x.user_id}`)
          const i = t.findIndex((x) => key(x) === key(row))
          if (i >= 0) t[i] = { ...t[i], ...row }
          else t.push(row)
        }
        return route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' })
      }
      if (method === 'DELETE') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    }
    return this.json(route, 404, { message: `unmocked ${req.method()} ${path}` })
  }
}
