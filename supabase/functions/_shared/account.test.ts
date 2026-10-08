import { describe, expect, it } from 'vitest'
import { authPassword, normalizeUsername, usernameError, usernameToEmail } from './account.ts'

describe('username accounts', () => {
  it('accepts Hebrew and Latin usernames', () => {
    expect(usernameError('זובקוב')).toBeNull()
    expect(usernameError('dana_k')).toBeNull()
    expect(usernameError('  זובקוב  ')).toBeNull()
  })
  it('rejects empty, too short, spaces and symbols — in Hebrew', () => {
    expect(usernameError('')).toContain('שם משתמש')
    expect(usernameError('א')).toContain('לפחות')
    expect(usernameError('דנה כהן')).toContain('בלי רווחים')
    expect(usernameError('a@b')).toContain('בלי רווחים')
  })
  it('short passwords are fine: Auth sees a prefixed form (same rule as mz_create_member)', () => {
    expect(authPassword('ליין')).toBe('maazan:ליין')
    expect(authPassword('123456')).toBe('maazan:123456')
  })
  it('accepts the three member usernames', () => {
    for (const u of ['זובקוב', 'אמא', 'איתן']) expect(usernameError(u)).toBeNull()
  })
  it('maps a username to one stable, ASCII-only login address', async () => {
    const a = await usernameToEmail('זובקוב')
    expect(a).toMatch(/^u[0-9a-f]{40}@users\.maazan\.app$/)
    expect(await usernameToEmail(' זובקוב ')).toBe(a)
    expect(await usernameToEmail('Dana')).toBe(await usernameToEmail('dana'))
    expect(await usernameToEmail('dana')).not.toBe(a)
    expect(normalizeUsername('Dana')).toBe('dana')
  })
})
