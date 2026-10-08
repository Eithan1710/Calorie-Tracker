import { expect, test, type Page } from '@playwright/test'
import { MockSupabase } from './mockSupabase'

/**
 * Accounts against a mocked Supabase (see mockSupabase.ts, which enforces
 * owner-only, members-only access like the real RLS policies). Runs on a dev server built
 * with VITE_SUPABASE_URL pointing at the mock.
 */

const hero = (page: Page) => page.getByRole('region', { name: 'מאזן קלורי' })
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function login(page: Page, username: string, password: string) {
  await page.getByLabel('שם משתמש').fill(username)
  await page.getByLabel('סיסמה', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'כניסה' }).click()
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

test('login screen is Hebrew, has no sign-up; wrong password gets a clear Hebrew error', async ({ page }) => {
  sb.addUser('זובקוב', 'רוקדסלסהטוב')
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeDisabled()
  await expect(page.getByText(/משתמש חדש|הרשמה|יצירת חשבון/)).toHaveCount(0)
  await login(page, 'זובקוב', 'wrong-pass')
  await expect(page.getByRole('alert')).toHaveText('שם משתמש או סיסמה שגויים.')
  await login(page, 'משתמש_לא_קיים', '123456')
  await expect(page.getByRole('alert')).toHaveText('שם משתמש או סיסמה שגויים.')
})

test('nothing is reachable without logging in', async ({ page }) => {
  sb.addUser('איתן', '123456')
  for (const path of ['/', '/?add=1', '/?steps=5000&date=2026-10-06']) {
    await page.goto(path)
    await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'מאזן קלורי' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'ניווט ראשי' })).toHaveCount(0)
  }
  expect(sb.rows('mz_health_data')).toHaveLength(0)
})

test('an Auth account that is not a member is refused', async ({ page }) => {
  sb.addUser('זר', 'whatever1', { member: false })
  await page.goto('/')
  await login(page, 'זר', 'whatever1')
  await expect(page.getByRole('alert')).toHaveText('לחשבון הזה אין גישה למאזן.')
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible()
})

test('short passwords work; stays signed in after reload; logout', async ({ page }) => {
  sb.addUser('אמא', 'ליין')
  await page.goto('/')
  await login(page, 'אמא', 'ליין')
  await expect(page.getByRole('heading', { name: 'שלום, אמא' })).toBeVisible()
  await onboard(page, '62')
  await expect.poll(() => sb.rows('mz_profiles').length).toBe(1)
  expect(sb.rows('mz_profiles')[0].user_id).toBe(sb.users[0].id)
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('ליין')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await logout(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'כניסה' })).toBeVisible()
})

test('two users on the same device see only their own data', async ({ page }) => {
  sb.addUser('איתן', '123456')
  sb.addUser('אמא', 'ליין')
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await onboard(page, '82')
  await logFood(page, '2 פרוסות לחם')
  await expect(hero(page)).toContainText('160')
  await expect.poll(() => sb.rows('mz_food_entries').length).toBe(1)
  await logout(page)

  await login(page, 'אמא', 'ליין')
  // her own account: no profile, no food — nothing from the first user leaks in
  await onboard(page, '60')
  await expect(page.getByText('עוד לא נרשם כלום.')).toBeVisible()
  await logFood(page, '3 ביצים')
  await expect(hero(page)).toContainText('215')
  await logout(page)

  // back to the first user: their meal and their body weight (82 kg) are back
  await login(page, 'איתן', '123456')
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
  sb.addUser('זובקוב', 'רוקדסלסהטוב')
  await page.goto('/')
  await login(page, 'זובקוב', 'רוקדסלסהטוב')
  await onboard(page, '90')
  await logFood(page, '2 פרוסות לחם')
  await expect.poll(() => sb.rows('mz_food_entries').length).toBe(1)

  // a fresh browser profile = another device
  const other = await browser.newContext()
  await sb.install(other)
  const p2 = await other.newPage()
  await p2.clock.install({ time: new Date('2026-10-06T13:00:00+03:00') })
  await p2.goto('/')
  await login(p2, 'זובקוב', 'רוקדסלסהטוב')
  await expect(p2.getByRole('heading', { name: 'היום' })).toBeVisible() // no onboarding: profile came from the server
  await expect(p2.getByRole('region', { name: 'מה אכלתי' })).toContainText('לחם')
  await other.close()
})

test('photo is uploaded into the user’s own folder and linked to the entry', async ({ page }) => {
  sb.addUser('איתן', '123456')
  await page.goto('/')
  await login(page, 'איתן', '123456')
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

test('strength workout with total volume and muscle groups syncs to the account', async ({ page }) => {
  sb.addUser('איתן', '123456')
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await onboard(page, '82')
  await page.getByRole('button', { name: /אימון/ }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('button', { name: '60' }).click()
  await d.getByRole('button', { name: 'רגליים' }).click()
  await d.getByLabel('משקל כולל שהורם באימון (לא חובה)').fill('8000')
  await d.getByRole('button', { name: /הוסף · ~/ }).click()
  await expect.poll(() => sb.rows('mz_exercises').length).toBe(1)
  const ex = sb.rows('mz_exercises')[0]
  expect(ex.volume_kg).toBe(8000)
  expect(ex.muscles).toEqual(['legs'])
})
