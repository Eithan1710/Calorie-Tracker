import { describe, expect, it } from 'vitest'
import { normalizeUsername, passwordError, usernameError, usernameToEmail } from './account.ts'

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
  it('passwords: at least 6 characters ("123456" is allowed)', () => {
    expect(passwordError('123456')).toBeNull()
    expect(passwordError('12345')).toContain('6')
    expect(passwordError('')).toContain('סיסמה')
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
