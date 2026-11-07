/**
 * Per-member limit on AI analyses (photos, text, corrections) in a rolling 24 hours. The AI runs on
 * shared provider keys; the limit stops one account (or a stolen session) from using them up for
 * everyone. Generous: the heaviest real day so far was 14 analyses.
 */
export const AI_DAILY_LIMIT = 100

export function quotaExceeded(countLast24h: number | null | undefined, limit = AI_DAILY_LIMIT): boolean {
  // unknown count (the log query failed) → allow: the limit must never block normal use by itself
  return typeof countLast24h === 'number' && countLast24h >= limit
}

export const QUOTA_MESSAGE = 'הגעת למכסת הניתוחים החכמים להיום. אפשר עדיין להוסיף אוכל מהחיפוש או בהקלדה — ומחר המכסה מתחדשת.'
