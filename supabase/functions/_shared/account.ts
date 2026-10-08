/**
 * Username accounts on top of Supabase Auth. Closed app: there is no sign-up.
 * Accounts are created by the project owner in the SQL editor with
 * public.mz_create_member(username, password) (migration
 * 20261009000000_members_and_volume.sql), which uses exactly this mapping.
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
 *
 * Members may have short passwords (e.g. 4 characters). The Auth project is
 * shared with another app and keeps its own minimum length, so the password
 * Supabase sees is "maazan:" + the member's password — always long enough.
 * Supabase Auth stores only a bcrypt hash of it.
 */

export const ACCOUNT_EMAIL_DOMAIN = 'users.maazan.app'
export const USERNAME_MIN = 2
export const USERNAME_MAX = 24
export const PASSWORD_MAX = 64 // bcrypt uses the first 72 bytes, including the prefix
const PASSWORD_PREFIX = 'maazan:'

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

/** The password as stored in Supabase Auth (see header). Same rule as public.mz_create_member. */
export function authPassword(pw: string): string {
  return PASSWORD_PREFIX + pw
}

export async function usernameToEmail(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`maazan:${normalizeUsername(raw)}`))
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `u${hex.slice(0, 40)}@${ACCOUNT_EMAIL_DOMAIN}`
}
