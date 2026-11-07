import { describe, expect, it } from 'vitest'
import { AI_DAILY_LIMIT, quotaExceeded } from './quota.ts'

describe('AI quota', () => {
  it('blocks at the limit, not before; an unknown count never blocks', () => {
    expect(quotaExceeded(AI_DAILY_LIMIT - 1)).toBe(false)
    expect(quotaExceeded(AI_DAILY_LIMIT)).toBe(true)
    expect(quotaExceeded(null)).toBe(false)
    expect(quotaExceeded(undefined)).toBe(false)
  })
})
