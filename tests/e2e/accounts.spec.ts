import { expect, test, type Page } from '@playwright/test'
import { MockSupabase } from './mockSupabase'

/**
 * Accounts against a mocked Supabase (see mockSupabase.ts, which enforces
 * owner-only access like the real RLS policies). Runs on a dev server built
 * with VITE_SUPABASE_URL pointing at the mock.
 */

const hero = (page: Page) => page.getByRole('region', { name: 'מאזן קלורי' })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function login(page: Page, username: string, password: string) {
  await page.getByLabel('שם משתמש').fill(username)
  await page.getByLabel('סיסמה', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'כניסה' }).click()
}

async function register(page: Page, username: string, password: string) {
  await page.getByRole('radio', { name: 'משתמש חדש' }).click()
  await page.getByLabel('שם משתמש').fill(username)
  await page.getByLabel('סיסמה', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'יצירת חשבון' }).click()
}

async function onboard(page: Page, weight: string) {
  await page.getByLabel('גיל').fill('32')
  await page.getByLabel('גובה').fill('178')
  await page.getByLabel('משקל').fill(weight)
  await page.getByRole('button', { name: 'בוא נתחיל' }).click()
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'הגדרות' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'התנתקות' }).click()
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible()
}

async function logFood(page: Page, text: string) {
  await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
  await page.getByLabel('תיאור האוכל').fill(text)
  await page.getByRole('button', { name: 'חשב' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

// no uncaught exceptions or console errors in any scenario (network 4xx from mocked endpoints aside)
let consoleErrors: string[] = []
test.beforeEach(async ({ page }) => {
  consoleErrors = []
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) consoleErrors.push(m.text())
  })
})
test.afterEach(async () => {
  expect(consoleErrors).toEqual([])
})

let sb: MockSupabase

test.beforeEach(async ({ context, page }) => {
  sb = new MockSupabase()
  await sb.install(context)
  await page.clock.install({ time: new Date('2026-10-06T13:00:00+03:00') })
})

test('login screen is Hebrew; wrong password gets a clear Hebrew error', async ({ page }) => {
  sb.addUser('זובקוב', '123456')
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeDisabled()
  await login(page, 'זובקוב', 'wrong-pass')
  await expect(page.getByRole('alert')).toHaveText('שם משתמש או סיסמה שגויים.')
  await login(page, 'משתמש_לא_קיים', '123456')
  await expect(page.getByRole('alert')).toHaveText('שם משתמש או סיסמה שגויים.')
})

test('register validates input and refuses a taken username', async ({ page }) => {
  sb.addUser('זובקוב', '123456')
  await page.goto('/')
  await register(page, 'דנה כהן', '123456')
  await expect(page.getByRole('alert')).toContainText('בלי רווחים')
  await register(page, 'דנה', '123')
  await expect(page.getByRole('alert')).toContainText('לפחות 6')
  await register(page, 'זובקוב', '654321')
  await expect(page.getByRole('alert')).toContainText('כבר תפוס')
})

test('register → onboarding → stays signed in after reload → logout', async ({ page }) => {
  await page.goto('/')
  await register(page, 'זובקוב', '123456')
  await expect(page.getByRole('heading', { name: 'שלום, זובקוב' })).toBeVisible()
  await onboard(page, '82')
  // the profile went to this user's row only
  await expect.poll(() => sb.rows('mz_profiles').length).toBe(1)
  expect(sb.rows('mz_profiles')[0].user_id).toBe(sb.users[0].id)
  expect(sb.users[0].password).toBe('123456') // (mock only) the app never stores it locally:
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('123456')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await logout(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible()
})

test('two users on the same device see only their own data', async ({ page }) => {
  await page.goto('/')
  await register(page, 'אלון', 'secret1')
  await onboard(page, '82')
  await logFood(page, '2 פרוסות לחם')
  await expect(hero(page)).toContainText('160')
  await expect.poll(() => sb.rows('mz_food_entries').length).toBe(1)
  await logout(page)

  await register(page, 'בתיה', 'secret2')
  // new account: no profile, no food — nothing from the first user leaks in
  await onboard(page, '60')
  await expect(page.getByText('עוד לא נרשם כלום.')).toBeVisible()
  await logFood(page, '3 ביצים')
  await expect(hero(page)).toContainText('215')
  await logout(page)

  // back to the first user: their meal and their body weight (82 kg) are back
  await login(page, 'אלון', 'secret1')
  await expect(page.getByRole('region', { name: 'מה אכלתי' })).toContainText('לחם')
  await expect(page.getByRole('region', { name: 'מה אכלתי' })).not.toContainText('ביצים')
  await page.getByRole('button', { name: 'הגדרות' }).click()
  await expect(page.getByRole('dialog').getByLabel('משקל')).toHaveValue('82')

  const [a, b] = sb.users
  expect(String(sb.rows('mz_food_entries', a.id)[0].title)).toContain('לחם')
  expect(sb.rows('mz_food_entries', a.id)).toHaveLength(1)
  expect(sb.rows('mz_food_entries', b.id)).toHaveLength(1)
  expect(sb.rejectedWrites).toBe(0)
})

test('a new device pulls the profile and history from the account', async ({ page, browser }) => {
  await page.goto('/')
  await register(page, 'זובקוב', '123456')
  await onboard(page, '90')
  await logFood(page, '2 פרוסות לחם')
  await expect.poll(() => sb.rows('mz_food_entries').length).toBe(1)

  // a fresh browser profile = another device
  const other = await browser.newContext()
  await sb.install(other)
  const p2 = await other.newPage()
  await p2.clock.install({ time: new Date('2026-10-06T13:00:00+03:00') })
  await p2.goto('/')
  await login(p2, 'זובקוב', '123456')
  await expect(p2.getByRole('heading', { name: 'היום' })).toBeVisible() // no onboarding: profile came from the server
  await expect(p2.getByRole('region', { name: 'מה אכלתי' })).toContainText('לחם')
  await other.close()
})

test('photo is uploaded into the user’s own folder and linked to the entry', async ({ page }) => {
  await page.goto('/')
  await register(page, 'זובקוב', '123456')
  await onboard(page, '82')
  await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
  const d = page.getByRole('dialog')
  await d.getByTestId('food-photo-input').setInputFiles({ name: 'meal.png', mimeType: 'image/png', buffer: PNG })
  await expect(d.getByAltText('התמונה של הארוחה')).toBeVisible()
  await d.getByLabel('תיאור האוכל').fill('2 פרוסות לחם')
  await d.getByRole('button', { name: 'חשב' }).click()
  await d.getByRole('button', { name: 'אישור' }).click()

  const uid = sb.users[0].id
  await expect.poll(() => sb.rows('mz_food_entries').length).toBe(1)
  await expect.poll(() => [...sb.objects.keys()].length).toBe(1)
  const [key] = [...sb.objects.keys()]
  const row = sb.rows('mz_food_entries')[0]
  expect(key.startsWith(`${uid}/${row.id}/`)).toBe(true)
  expect(row.photo_path).toBe(key)
  expect(sb.objects.get(key)!.size).toBeGreaterThan(0)
})
