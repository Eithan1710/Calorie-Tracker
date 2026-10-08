/**
 * Username accounts on top of Supabase Auth (shared by the app and the
 * mz-register edge function, so both derive exactly the same login).
 *
 * Supabase Auth identifies password users by email. מאזן users only pick a
 * username (Hebrew or Latin), so each username maps deterministically to a
 * synthetic, never-mailed address:
 *
 *     normalize("זובקוב") → sha-256 → "u<40 hex>@users.maazan.app"
 *
 * Hashing keeps the address ASCII-only and short whatever the script, and the
 * mapping is case/Unicode-normalised so "Dana" and "dana" are the same account.
 * The readable username is kept in the user's metadata for display.
 * Passwords are never handled here beyond being passed to Supabase Auth,
 * which stores only a bcrypt hash.
 */

export const ACCOUNT_EMAIL_DOMAIN = 'users.maazan.app'
export const USERNAME_MIN = 2
export const USERNAME_MAX = 24
export const PASSWORD_MIN = 6
export const PASSWORD_MAX = 72 // bcrypt limit

const USERNAME_RE = /^[\p{L}\p{M}\p{N}_.-]+$/u

/** Display form: trimmed, Unicode-normalised. */
export function cleanUsername(raw: string): string {
  return raw.normalize('NFKC').trim()
}

/** Identity form: what the account is keyed by (case-insensitive). */
export function normalizeUsername(raw: string): string {
  return cleanUsername(raw).toLowerCase()
}

/** Hebrew validation message, or null when the username is acceptable. */
export function usernameError(raw: string): string | null {
  const u = cleanUsername(raw)
  if (!u) return 'צריך שם משתמש'
  if ([...u].length < USERNAME_MIN) return `שם משתמש צריך לפחות ${USERNAME_MIN} תווים`
  if ([...u].length > USERNAME_MAX) return `שם משתמש עד ${USERNAME_MAX} תווים`
  if (!USERNAME_RE.test(u)) return 'שם משתמש: אותיות, ספרות, נקודה, מקף או קו תחתון — בלי רווחים'
  return null
}

export function passwordError(pw: string): string | null {
  if (!pw) return 'צריך סיסמה'
  if (pw.length < PASSWORD_MIN) return `סיסמה צריכה לפחות ${PASSWORD_MIN} תווים`
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX) return 'הסיסמה ארוכה מדי'
  return null
}

export async function usernameToEmail(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`maazan:${normalizeUsername(raw)}`))
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `u${hex.slice(0, 40)}@${ACCOUNT_EMAIL_DOMAIN}`
}
