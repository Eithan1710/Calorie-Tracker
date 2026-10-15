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
  await expect(hero(page)).toContainText('158')
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

test('Apple Health: resting + active energy and an imported Strava run, no double counting', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  // what the Shortcuts automation wrote at 12:30 (health-ingest → mz_ingest_health)
  ;(sb.tables.mz_health_data ??= []).push({
    user_id: u.id, date: '2026-10-06', steps: 6000, active_kcal: 420, resting_kcal: 1100,
    health_as_of: '2026-10-06T12:30:00+03:00', source: 'shortcut', updated_at: '2026-10-06T09:30:05Z',
  })
  ;(sb.tables.mz_exercises ??= []).push({
    id: '11111111-1111-5111-8111-111111111111', user_id: u.id, date: '2026-10-06', type: 'run', origin: 'apple_health',
    title: 'Running', source_app: 'Strava', started_at: '2026-10-06T07:00:00+03:00', ended_at: '2026-10-06T07:30:00+03:00',
    duration_min: 30, distance_km: 5, reported_kcal: 330, muscles: [], lifts: [], outside_health: false,
    created_at: '2026-10-06T04:00:00Z', updated_at: '2026-10-06T09:30:05Z', deleted_at: null,
  })
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await onboard(page, '82')

  const energy = page.getByRole('region', { name: 'שריפה היום' })
  // measured so far = 1,100 resting + 420 active; the run (330) is inside "active", not added
  await expect(energy.getByTestId('energy-total')).toHaveText(/1,520/)
  await expect(energy).toContainText('Apple Health')
  await expect(energy.getByTestId('energy-status')).toContainText('היום 12:30')
  // full-day: resting projected from 12.5 h (1,100 × 24 / 12.5 = 2,112) + 420 active
  await expect(energy.getByTestId('energy-projection')).toContainText('2,530')
  await expect(hero(page)).toContainText('שריפה צפויה היום')
  await expect(hero(page)).toContainText('2,532')

  const workouts = page.getByRole('button', { name: /אימונים היום/ })
  await expect(workouts).toContainText('Strava')
  await expect(workouts).toContainText('5 ק״מ')
  await expect(workouts).toContainText('330')
  await expect(workouts).toContainText('כלול בפעילה')
  await page.screenshot({ path: 'docs/screenshots/accounts-apple-health.png', fullPage: true })

  // a gym session logged by hand is assumed to be in Apple's active energy …
  await workouts.click()
  const d = page.getByRole('dialog')
  await d.getByRole('button', { name: '60' }).click()
  await d.getByRole('button', { name: /הוסף/ }).click()
  await expect(page.getByText(/כלול בשריפה של Apple Health/)).toBeVisible()
  await expect(hero(page)).toContainText('2,532')
  // … unless the user says Apple Health did not measure it: then (only) its estimate is added
  await page.getByRole('button', { name: /אימונים היום/ }).click()
  await page.getByRole('dialog').getByLabel(/בלי שעון/).check()
  await page.keyboard.press('Escape')
  await expect(hero(page)).toContainText('2,888') // + (5.0 MET × 3.5 × 82 / 200 − 1,777.5 / 1,440) × 60 ≈ 356
  await expect.poll(() => sb.rows('mz_exercises').filter((r) => r.outside_health === true).length).toBe(1)
  // the imported run was not pushed back or duplicated
  expect(sb.rows('mz_exercises').filter((r) => r.origin === 'apple_health')).toHaveLength(1)
})

// ── body weight ──────────────────────────────────────────────────────────────

async function openWeight(page: Page) {
  await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'היסטוריה' }).click()
  await page.getByRole('radio', { name: 'משקל' }).click()
}

test('weight: empty state, quick entry, same-day correction, edit, delete + undo, survives reload', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await onboard(page, '62')
  await openWeight(page)

  // friendly empty state, entry is right there
  await expect(page.getByText('עוד אין שקילות')).toBeVisible()
  await expect(page.getByTestId('weight-chart')).toHaveCount(0)
  const entry = page.getByRole('form', { name: 'שקילה חדשה' })
  const kg = entry.getByLabel('שקילה חדשה')
  await expect(entry.getByRole('button', { name: 'שמור' })).toBeDisabled()
  await kg.fill('5')
  await kg.blur()
  await expect(entry.getByText('משקל בין 20 ל-400 ק״ג')).toBeVisible()

  // first weigh-in (comma decimal, as an iPhone keyboard types it)
  await kg.fill('61,8')
  await entry.getByRole('button', { name: 'שמור' }).click()
  await expect(page.getByTestId('weight-current')).toContainText('61.8')
  await expect(page.getByText('השקילה הראשונה')).toBeVisible()
  await expect.poll(() => sb.rows('mz_weights', u.id).length).toBe(1)
  // the newest weigh-in also feeds the calorie model
  await expect.poll(() => sb.rows('mz_profiles', u.id)[0]?.weight_kg).toBe(61.8)

  // a week earlier, picked with the date control
  await entry.getByLabel('תאריך השקילה').fill('2026-09-29')
  await kg.fill('62.4')
  await entry.getByRole('button', { name: 'שמור' }).click()
  await expect(page.getByTestId('weight-change')).toContainText('−0.6')
  await expect(page.getByTestId('weight-change')).toContainText('29.9')

  // same day again = correction, not a duplicate
  await kg.fill('61.6')
  await expect(entry.getByRole('button', { name: 'עדכן' })).toBeVisible()
  await expect(entry.getByText(/כבר יש שקילה ביום הזה/)).toBeVisible()
  await entry.getByRole('button', { name: 'עדכן' }).click()
  await expect(page.getByTestId('weight-current')).toContainText('61.6')
  await expect.poll(() => sb.rows('mz_weights', u.id).filter((r) => !r.deleted_at).length).toBe(2)

  // edit: change value and move it a day; the list and chart follow
  await page.getByRole('button', { name: /29 בספטמבר.*62\.4/ }).click()
  const d = page.getByRole('dialog', { name: 'עריכת שקילה' })
  await d.getByLabel('משקל').fill('62.2')
  await d.getByLabel('תאריך').fill('2026-09-30')
  await d.getByRole('button', { name: 'שמירה' }).click()
  await expect(page.getByRole('button', { name: /30 בספטמבר.*62\.2/ })).toBeVisible()
  await expect.poll(() => sb.rows('mz_weights', u.id).filter((r) => !r.deleted_at).map((r) => r.date).sort()).toEqual(['2026-09-30', '2026-10-06'])

  // delete with undo
  await page.getByRole('button', { name: /30 בספטמבר/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'מחיקת השקילה' }).click()
  await expect(page.getByTestId('weight-change')).toHaveCount(0)
  await page.getByRole('button', { name: 'ביטול' }).last().click()
  await expect(page.getByTestId('weight-change')).toContainText('−0.6')

  await page.screenshot({ path: 'docs/screenshots/accounts-weight.png', fullPage: true })

  // persisted: reload → same data, still there (local copy + server)
  await page.reload()
  await openWeight(page)
  await expect(page.getByTestId('weight-current')).toContainText('61.6')
  await expect(page.getByTestId('weight-chart')).toBeVisible()
})

test('weight: long history from the server, range filters, honest axis; other accounts see nothing', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  const other = sb.addUser('דנה', '654321')
  ;(sb.tables.mz_profiles ??= []).push({ user_id: u.id, sex: 'male', age: 30, height_cm: 162, weight_kg: 61, protein_target_g: 120, deficit_min: 100, deficit_max: 300, updated_at: '2026-10-01T10:00:00Z' })
  // 2 years of weekly weigh-ins drifting 66 → 61 kg
  const start = Date.parse('2024-10-08T12:00:00Z')
  for (let i = 0; i < 105; i++) {
    const date = new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10)
    ;(sb.tables.mz_weights ??= []).push({ user_id: u.id, date, weight_kg: Math.round((66 - i * 0.048 + (i % 3) * 0.2) * 10) / 10, created_at: `${date}T07:00:00Z`, updated_at: `${date}T07:00:00Z`, deleted_at: null })
  }
  ;(sb.tables.mz_weights ??= []).push({ user_id: other.id, date: '2026-10-05', weight_kg: 77.7, created_at: '2026-10-05T07:00:00Z', updated_at: '2026-10-05T07:00:00Z', deleted_at: null })

  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await openWeight(page)
  await expect(page.getByTestId('weight-current')).toBeVisible()
  await expect(page.getByText('77.7')).toHaveCount(0)

  const chart = page.getByTestId('weight-chart')
  const dots = chart.locator('circle')
  await expect(dots).toHaveCount(14) // 3 months ≈ 13–14 weekly points
  await page.getByRole('radio', { name: 'חודש', exact: true }).click()
  await expect(dots).toHaveCount(5)
  await page.getByRole('radio', { name: 'הכל' }).click()
  await expect(dots).toHaveCount(105)
  // axis labels are whole kilograms and span at least 4 kg
  const ticks = (await chart.locator('svg > g > text').allTextContents()).map(Number)
  expect(ticks.every((t) => Number.isInteger(t))).toBe(true)
  expect(Math.max(...ticks) - Math.min(...ticks)).toBeGreaterThanOrEqual(4)
  // the list starts short, can be expanded
  await expect(page.getByRole('button', { name: 'כל השקילות (105)' })).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/accounts-weight-history.png', fullPage: true })
})
