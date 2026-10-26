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
  // no Apple Watch seen (the run came from Strava) → iPhone alone: the short daily routine it can't see
  // is added, costed like workouts — (MET × 3.5 × 82 / 200 − 1,777.5 / 1,440) × minutes:
  // bed 3.3·3′ ≈ 10.5 + teeth 2.0·6′ ≈ 9.8 + shower 2.0·10′ ≈ 16.4 + dressing 2.5·6′ ≈ 14.1 → 51 (no work schedule set)
  await expect(energy.getByText('שגרה בלי הטלפון')).toBeVisible()
  await expect(energy.getByTestId('energy-total')).toHaveText(/1,571/) // 1,100 + 420 + 51
  await expect(hero(page)).toContainText('2,583') // 2,112 + 420 + 51
  await energy.getByRole('button', { name: 'מה המספרים אומרים' }).click()
  await expect(energy.getByTestId('routine-explainer')).toContainText('מקלחת')
  await expect(energy.getByTestId('routine-explainer')).toContainText('51')
  await expect(energy.getByTestId('energy-confidence')).toContainText('רמת ביטחון')

  // with an Apple Watch the watch measures the routine itself → nothing is added
  await page.getByRole('button', { name: 'הגדרות' }).click()
  await page.getByRole('dialog').getByRole('radio', { name: 'גם Apple Watch' }).click()
  await expect.poll(() => sb.rows('mz_profiles', u.id)[0]?.health_device).toBe('watch')
  await page.keyboard.press('Escape')
  await expect(energy.getByText('שגרה בלי הטלפון')).toHaveCount(0)

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

const profileRow = (userId: string, extra: Record<string, unknown> = {}) => ({ user_id: userId, sex: 'male', age: 32, height_cm: 178, weight_kg: 62, protein_target_g: 120, deficit_min: 100, deficit_max: 300, updated_at: '2026-10-01T10:00:00Z', ...extra })

test('weight: empty state, quick entry, same-day correction, edit, delete + undo, survives reload', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id))
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
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
  // a long history opens on 3 months; one tap target (and tooltip) per weigh-in in range
  const points = chart.locator('rect > title')
  await expect(page.getByRole('radio', { name: '3 חודשים' })).toHaveAttribute('aria-checked', 'true')
  await expect(points).toHaveCount(14) // 3 months ≈ 13–14 weekly points
  await page.getByRole('radio', { name: 'חודש', exact: true }).click()
  await expect(points).toHaveCount(5)
  await expect(chart.locator('circle')).toHaveCount(5)
  await page.getByRole('radio', { name: 'הכל' }).click()
  await expect(points).toHaveCount(105)
  // two years of dots would be a smear: only the newest is drawn, the line carries the rest
  await expect(chart.locator('circle')).toHaveCount(1)
  // axis labels are whole kilograms and span at least 4 kg
  const ticks = (await chart.locator('svg > g > text').allTextContents()).map(Number)
  expect(ticks.every((t) => Number.isInteger(t))).toBe(true)
  expect(Math.max(...ticks) - Math.min(...ticks)).toBeGreaterThanOrEqual(4)
  // the list starts short, can be expanded
  await expect(page.getByRole('button', { name: 'כל השקילות (105)' })).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/accounts-weight-history.png', fullPage: true })
})

test('weight: the onboarding weight is the first weigh-in, saved to the account', async ({ page }) => {
  const u = sb.addUser('נועה', '123456')
  await page.goto('/')
  await login(page, 'נועה', '123456')
  await onboard(page, '70.5')
  await expect.poll(() => sb.rows('mz_weights', u.id).map((r) => [r.date, r.weight_kg])).toEqual([['2026-10-06', 70.5]])
  await openWeight(page)
  await expect(page.getByTestId('weight-current')).toContainText('70.5')
})

test('weight: a failed database save is shown as failed — never as saved — and is sent once the database accepts it', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id))
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await openWeight(page)
  const entry = page.getByRole('form', { name: 'שקילה חדשה' })

  // the database refuses the write (e.g. a permissions problem)
  sb.failWrites.mz_weights = { status: 403, code: '42501', message: 'new row violates row-level security policy for table "mz_weights"' }
  await entry.getByLabel('שקילה חדשה').fill('61.8')
  await entry.getByRole('button', { name: 'שמור' }).click()
  const alert = page.getByTestId('weight-save-error')
  await expect(alert).toBeVisible()
  await expect(alert).toContainText('לא נשמר בחשבון')
  await expect(alert).toContainText('אין הרשאה')
  await expect(page.getByText(/^נשמר · /)).toHaveCount(0) // no success toast
  await expect(page.getByTestId('weight-unsynced')).toHaveCount(1)
  expect(sb.rows('mz_weights', u.id)).toHaveLength(0)
  // the entry is kept on the device, also across a reload
  await page.reload()
  await openWeight(page)
  await expect(page.getByTestId('weight-current')).toContainText('61.8')
  await expect(page.getByTestId('weight-unsynced')).toHaveCount(1)

  // the database works again → "נסה שוב" (or any later sync) sends it; only now "נשמר"
  sb.failWrites.mz_weights = undefined
  await entry.getByLabel('שקילה חדשה').fill('61.6')
  await entry.getByRole('button', { name: 'עדכן' }).click()
  await expect(page.getByText('עודכן · 61.6 ק״ג')).toBeVisible()
  await expect(alert).toHaveCount(0)
  await expect(page.getByTestId('weight-unsynced')).toHaveCount(0)
  expect(sb.rows('mz_weights', u.id).map((r) => [r.date, r.weight_kg, r.deleted_at])).toEqual([['2026-10-06', 61.6, null]])

  // an explicit retry after a failure
  sb.failWrites.mz_weights = { status: 500, code: 'XX000', message: 'internal error' }
  await entry.getByLabel('תאריך השקילה').fill('2026-09-29')
  await entry.getByLabel('שקילה חדשה').fill('62.4')
  await entry.getByRole('button', { name: 'שמור' }).click()
  await expect(alert).toContainText('השמירה לשרת נכשלה')
  sb.failWrites.mz_weights = undefined
  await alert.getByRole('button', { name: 'נסה שוב' }).click()
  await expect(alert).toHaveCount(0)
  await expect.poll(() => sb.rows('mz_weights', u.id).map((r) => r.date).sort()).toEqual(['2026-09-29', '2026-10-06'])
})

test('weight: history loads after logout / login and on another device; an entry the server never got is recovered without duplicates', async ({ page, browser }) => {
  const u = sb.addUser('איתן', '123456')
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id))
  ;(sb.tables.mz_weights ??= []).push(
    { user_id: u.id, date: '2026-09-22', weight_kg: 63.0, created_at: '2026-09-22T06:00:00Z', updated_at: '2026-09-22T06:00:00Z', deleted_at: null },
    { user_id: u.id, date: '2026-09-29', weight_kg: 62.5, created_at: '2026-09-29T06:00:00Z', updated_at: '2026-09-29T06:00:00Z', deleted_at: null },
  )
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await openWeight(page)
  await expect(page.getByTestId('weight-current')).toContainText('62.5')
  const entry = page.getByRole('form', { name: 'שקילה חדשה' })
  await entry.getByLabel('שקילה חדשה').fill('61.9')
  await entry.getByRole('button', { name: 'שמור' }).click()
  await expect(page.getByText('נשמר · 61.9 ק״ג')).toBeVisible()
  await expect.poll(() => sb.rows('mz_weights', u.id).length).toBe(3)

  // simulate the old bug: the server lost today's row although this device marked it as sent
  sb.tables.mz_weights = sb.rows('mz_weights').filter((r) => r.date !== '2026-10-06')
  await page.reload()
  await expect.poll(() => sb.rows('mz_weights', u.id).map((r) => [r.date, r.weight_kg]).sort()).toEqual([
    ['2026-09-22', 63],
    ['2026-09-29', 62.5],
    ['2026-10-06', 61.9],
  ])

  // logout → login: same history (from the account, not just this device)
  await logout(page)
  await login(page, 'איתן', '123456')
  await openWeight(page)
  await expect(page.getByTestId('weight-current')).toContainText('61.9')
  await expect(page.getByTestId('weight-change')).toContainText('−0.6')

  // another device: the whole history, chart included; a change there reaches the first device
  const other = await browser.newContext()
  await sb.install(other)
  const p2 = await other.newPage()
  await p2.clock.install({ time: new Date('2026-10-06T13:00:00+03:00') })
  await p2.goto('/')
  await login(p2, 'איתן', '123456')
  await expect(p2.getByRole('heading', { name: 'היום' })).toBeVisible()
  await openWeight(p2)
  await expect(p2.getByTestId('weight-current')).toContainText('61.9')
  await expect(p2.getByTestId('weight-chart').locator('rect > title')).toHaveCount(3)
  await p2.getByRole('button', { name: /29 בספטמבר/ }).click()
  await p2.getByRole('dialog').getByLabel('משקל').fill('62.3')
  await p2.getByRole('dialog').getByRole('button', { name: 'שמירה' }).click()
  await expect(p2.getByText('עודכן · 62.3 ק״ג')).toBeVisible()
  await other.close()
  expect(sb.rows('mz_weights', u.id)).toHaveLength(3) // corrections never add rows

  await page.reload()
  await openWeight(page)
  await expect(page.getByRole('button', { name: /29 בספטמבר.*62\.3/ })).toBeVisible()
  // and a stale copy from an old device cannot overwrite the newer weigh-in
  expect(sb.rows('mz_weights', u.id).find((r) => r.date === '2026-09-29')?.weight_kg).toBe(62.3)
})

test('weight: with the app left open past midnight a new weigh-in goes to the new day, yesterday stays', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id))
  await page.clock.setSystemTime(new Date('2026-10-06T23:58:00+03:00'))
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await openWeight(page)
  const entry = page.getByRole('form', { name: 'שקילה חדשה' })
  await entry.getByLabel('שקילה חדשה').fill('65')
  await entry.getByRole('button', { name: 'שמור' }).click()
  await expect(page.getByText('נשמר · 65.0 ק״ג')).toBeVisible()
  await page.clock.runFor(5 * 60_000) // 00:03, the screen was never closed
  await entry.getByLabel('שקילה חדשה').fill('64.6')
  await expect(entry.getByRole('button', { name: 'שמור' })).toBeVisible() // not "עדכן": a new day
  await entry.getByRole('button', { name: 'שמור' }).click()
  await expect.poll(() => sb.rows('mz_weights', u.id).map((r) => [r.date, r.weight_kg]).sort()).toEqual([
    ['2026-10-06', 65],
    ['2026-10-07', 64.6],
  ])
})

test('weight: the energy balance between the two weigh-ins uses the same daily numbers; the server copy of each day follows late Apple Health data', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id, { weight_kg: 60.1 }))
  const PER100 = { kcal: 160, protein_g: 10, fat_g: 4, carbs_g: 20 } // 1 kg → 1,600 kcal · 100 g P · 200 g C · 40 g F
  const days = ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']
  for (const d of days) {
    ;(sb.tables.mz_food_entries ??= []).push(foodRow(u.id, d, '13:00', 'lunch', 'ארוחה', 1000, PER100))
    ;(sb.tables.mz_health_data ??= []).push({ user_id: u.id, date: d, steps: 7000, source: 'shortcut', active_kcal: 300, resting_kcal: 1500, health_as_of: `${d}T23:59:00+03:00`, updated_at: `${d}T21:00:00Z` })
  }
  ;(sb.tables.mz_weights ??= []).push(
    { user_id: u.id, date: '2026-09-29', weight_kg: 60.1, created_at: '2026-09-29T07:10:00Z', updated_at: '2026-09-29T07:10:00Z', deleted_at: null },
    { user_id: u.id, date: '2026-10-06', weight_kg: 59.2, created_at: '2026-10-06T07:20:00Z', updated_at: '2026-10-06T07:20:00Z', deleted_at: null },
  )
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await openWeight(page)
  // each day: 1,500 resting + 300 active + 33 short routine without the phone (iPhone alone) + 167 digestion
  // (25% P · 7.5% C · 2% F) = 2,000 burned − 1,600 eaten = 400 (no work schedule set for this account)
  const b = page.getByTestId('weighin-balance')
  await expect(b).toContainText('7 ימים')
  await expect(b).toContainText('גירעון מצטבר של 2,800')
  await expect(b).toContainText('400') // per day
  await expect(b).toContainText('0.36') // ≈ kg of fat at 7,700 kcal/kg
  await expect(b).toContainText('−0.9') // what the scale says
  await page.screenshot({ path: 'docs/screenshots/accounts-weighin-balance.png' })

  // the server copy of each day (mz_daily_summaries) matches what the app shows…
  await expect.poll(() => sb.rows('mz_daily_summaries', u.id).find((r) => r.date === '2026-10-05')?.calories_out).toBe(2000)
  // …and follows Apple Health energy that arrives later for a day already logged
  sb.tables.mz_health_data = sb.rows('mz_health_data').map((r) => (r.date === '2026-10-05' ? { ...r, active_kcal: 500, updated_at: '2026-10-06T09:00:00Z' } : r))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(() => sb.rows('mz_daily_summaries', u.id).find((r) => r.date === '2026-10-05')?.calories_out).toBe(2200)
  await expect(b).toContainText('גירעון מצטבר של 3,000')

  // a day without food is not counted as 0 kcal eaten: no comparison then
  sb.tables.mz_food_entries = sb.rows('mz_food_entries').map((r) => (r.date === '2026-10-02' ? { ...r, deleted_at: '2026-10-06T09:30:00Z', updated_at: '2026-10-06T09:30:00Z' } : r))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(b).toContainText('חסר רישום אוכל ב-1 מתוך 7 ימים')
})

test('work hours without the phone + the quick activity check: saved, estimated once, never asked twice', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id, { weight_kg: 60.1 }))
  // Tuesday, Apple Health snapshot from 12:30 (phone with him at lunch)
  ;(sb.tables.mz_health_data ??= []).push({ user_id: u.id, date: '2026-10-06', steps: 2400, source: 'shortcut', active_kcal: 90, resting_kcal: 820, health_as_of: '2026-10-06T12:30:00+03:00', updated_at: '2026-10-06T09:30:05Z' })
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  const energy = page.getByRole('region', { name: 'שריפה היום' })
  // the full-day burn as the screen reader line states it (not the animated number)
  const burned = async () => Number(/נשרפו ([\d,]+)/.exec((await hero(page).textContent()) ?? '')?.[1].replace(/,/g, ''))
  const before = await burned()

  // the weekly work schedule, once: Sun–Thu 09:30–18:00, phone with me 12:00–13:00 (the defaults)
  await page.getByRole('button', { name: 'הגדרות' }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('switch', { name: 'עבודה בלי הטלפון' }).click()
  await expect(d.getByTestId('office-schedule-summary')).toContainText('09:30–12:00')
  await expect(d.getByTestId('office-schedule-summary')).toContainText('13:00–18:00')
  await expect.poll(() => sb.rows('mz_profiles', u.id)[0]?.routine_schedule).toEqual({ days: [0, 1, 2, 3, 4], start: '09:30', end: '18:00', phoneBreaks: [['12:00', '13:00']] })
  // an invalid change is explained and not saved
  await d.getByLabel('סוף העבודה').fill('08:00')
  await expect(d.getByRole('alert')).toContainText('אחרי')
  await d.getByLabel('סוף העבודה').fill('18:00')
  await page.keyboard.press('Escape')

  // the hours without the phone are estimated (7.5 h of desk work) — Apple's numbers stay as they are
  await expect(energy.getByText('שגרה בלי הטלפון')).toBeVisible()
  await energy.getByRole('button', { name: 'מה המספרים אומרים' }).click()
  const rx = energy.getByTestId('routine-explainer')
  await expect(rx).toContainText('09:30–12:00, 13:00–18:00')
  await expect(rx).toContainText('עבודה מול מחשב בלי הטלפון')
  await expect(rx).toContainText('קימות והליכה קצרה במשרד')
  await expect(energy.getByTestId('energy-confidence')).toContainText('מ-Apple Health 910')
  await expect(page.getByTestId('burn-uncertainty')).toContainText('±')
  const after = await burned()
  expect(after - before).toBeGreaterThan(200) // 7.5 h at a desk ≈ 0.5 kcal/min above rest
  expect(after - before).toBeLessThan(300)

  // the quick check: salsa (Apple Health didn't see it) → its estimate is added, once
  const check = page.getByTestId('activity-check')
  await check.getByRole('button', { name: /סלסה/ }).click()
  await check.getByRole('radio', { name: '1.5 שע׳' }).click()
  await expect(check.getByTestId('activity-check-estimate')).toContainText('יתווסף')
  const beforeSalsa = await burned()
  await check.getByRole('button', { name: 'כן, שמור' }).click()
  await expect.poll(() => sb.rows('mz_exercises', u.id).map((r) => [r.type, r.duration_min, r.outside_health ?? false])).toEqual([['dance', 90, true]])
  await expect.poll(burned).toBeGreaterThan(beforeSalsa + 150) // 90 min of salsa (MET 4.5) above rest
  await expect(check.getByRole('button', { name: /סלסה/ })).toHaveCount(0) // not asked again
  // gym recorded in Hevy → already inside Apple's Active Energy: recorded, nothing added
  const total1 = await burned()
  await check.getByRole('button', { name: /חדר כושר/ }).click()
  await check.getByRole('radio', { name: '60 דק׳' }).click()
  await expect(check.getByLabel(/Hevy/)).toBeChecked()
  await check.getByRole('button', { name: 'כן, שמור' }).click()
  await expect(page.getByText(/כבר בתוך Apple Health/)).toBeVisible()
  await expect.poll(() => sb.rows('mz_exercises', u.id).length).toBe(2)
  expect(sb.rows('mz_exercises', u.id).find((r) => r.type === 'strength')?.outside_health ?? false).toBe(false)
  expect(await burned()).toBe(total1)
  // "no" is remembered for the day
  await check.getByRole('button', { name: /ריצה/ }).click()
  await check.getByRole('button', { name: 'לא היום' }).click()
  await expect(check.getByRole('button', { name: /ריצה/ })).toHaveCount(0)

  // after a reload: the schedule, the answers and the activities are all still there
  await page.reload()
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await expect(energy.getByText('שגרה בלי הטלפון')).toBeVisible()
  await expect(page.getByTestId('activity-check').getByRole('button', { name: /ריצה|סלסה|חדר כושר/ })).toHaveCount(0)
  await expect(page.getByTestId('activity-check').getByRole('button', { name: /טיפוס/ })).toBeVisible()
  await page.screenshot({ path: 'docs/screenshots/accounts-routine-check.png', fullPage: true })
  // skipping hides the check for the day
  await page.getByTestId('activity-check').getByRole('button', { name: 'דלג' }).click()
  await expect(page.getByTestId('activity-check')).toHaveCount(0)
})

test('a device that synced the profile with an older app version still gets the work schedule (same timestamp)', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  const at = '2026-10-06T07:47:20.222Z'
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id, { weight_kg: 59.5, updated_at: at, routine_schedule: { days: [0, 1, 2, 3, 4], start: '09:30', end: '18:00', phoneBreaks: [['12:00', '13:00']] } }))
  ;(sb.tables.mz_health_data ??= []).push({ user_id: u.id, date: '2026-10-06', steps: 3400, source: 'shortcut', active_kcal: 89, resting_kcal: 820, health_as_of: '2026-10-06T12:30:00+03:00', updated_at: '2026-10-06T09:30:05Z' })
  // what the older app left on the phone: the profile with the server's timestamp, but no schedule
  await page.addInitScript(
    ([key, settings]) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, settings)
    },
    [`maazan:settings:${u.id}`, JSON.stringify({ profile: { sex: 'male', age: 32, heightCm: 178, weightKg: 59.5 }, proteinTarget: 120, deficitTarget: { min: 100, max: 300 }, remindersEnabled: false, reminderTime: '21:30', profileUpdatedAt: at, summariesVersion: 5 })] as const,
  )
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  const energy = page.getByRole('region', { name: 'שריפה היום' })
  await energy.getByRole('button', { name: 'מה המספרים אומרים' }).click()
  await expect(energy.getByTestId('routine-explainer')).toContainText('09:30–12:00, 13:00–18:00')
  // the server's copy of the day is rewritten with the work hours
  await expect.poll(() => (sb.rows('mz_daily_summaries', u.id).find((r) => r.date === '2026-10-06')?.energy_breakdown as { no_phone_minutes?: number } | undefined)?.no_phone_minutes).toBe(450)
  // and nothing is pushed back over the server's profile
  expect(sb.rows('mz_profiles', u.id)[0].updated_at).toBe(at)
})

// ── daily step goal ──────────────────────────────────────────────────────────

test('step goal: saved to the account, progress from the Apple Health steps already collected, back on another device', async ({ page, browser }) => {
  const u = sb.addUser('איתן', '123456')
  ;(sb.tables.mz_profiles ??= []).push(profileRow(u.id))
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  const card = page.getByTestId('steps-card')
  // nothing synced yet: "—", not 0, with the default goal
  await expect(card.getByTestId('steps-progress')).toContainText('—')
  await expect(card.getByTestId('steps-progress')).toContainText('8,000')
  await expect(card.getByTestId('steps-note')).toContainText('אין עדיין נתוני צעדים')

  // a 10,000 goal, saved to the account
  await card.click()
  const d = page.getByRole('dialog')
  await d.getByLabel('יעד צעדים יומי').fill('10000')
  await expect.poll(() => sb.rows('mz_profiles', u.id)[0]?.step_goal).toBe(10000)
  // invalid → explained, not saved
  await d.getByLabel('יעד צעדים יומי').fill('300')
  await expect(d.getByRole('alert')).toContainText('בין')
  await d.getByLabel('יעד צעדים יומי').fill('10000')
  await page.keyboard.press('Escape')

  // the Shortcuts automation delivers steps (the existing ingestion → mz_health_data)
  ;(sb.tables.mz_health_data ??= []).push({ user_id: u.id, date: '2026-10-06', steps: 6500, source: 'shortcut', active_kcal: 310, resting_kcal: 1200, health_as_of: '2026-10-06T12:40:00+03:00', updated_at: '2026-10-06T09:40:05Z' })
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(card.getByTestId('steps-progress')).toContainText('6,500')
  await expect(card.getByTestId('steps-progress')).toContainText('10,000')
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6500')
  await expect(card.getByTestId('steps-note')).toContainText('עוד 3,500 ליעד')
  await expect(card.getByTestId('steps-note')).toContainText('Apple Health')
  await expect(card.getByTestId('steps-reached')).toHaveCount(0)

  // a later sync with more steps → goal reached
  sb.tables.mz_health_data = sb.rows('mz_health_data').map((r) => (r.date === '2026-10-06' ? { ...r, steps: 10420, health_as_of: '2026-10-06T19:10:00+03:00', updated_at: '2026-10-06T16:10:05Z' } : r))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(card.getByTestId('steps-reached')).toBeVisible()
  await expect(card.getByTestId('steps-note')).toContainText('420 מעל היעד')
  await expect.poll(() => card.getByTestId('steps-bar').evaluate((el) => el.getBoundingClientRect().width / el.parentElement!.getBoundingClientRect().width), { timeout: 3000 }).toBeGreaterThan(0.99)
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'docs/screenshots/accounts-step-goal.png' })

  // another device: same goal from the account
  const other = await browser.newContext()
  await sb.install(other)
  const p2 = await other.newPage()
  await p2.clock.install({ time: new Date('2026-10-06T13:00:00+03:00') })
  await p2.goto('/')
  await login(p2, 'איתן', '123456')
  await expect(p2.getByTestId('steps-card').getByTestId('steps-progress')).toContainText('10,420')
  await expect(p2.getByTestId('steps-card').getByTestId('steps-progress')).toContainText('10,000')
  await other.close()
})

// ── suggestions from the user's own history ─────────────────────────────────

function foodRow(userId: string, day: string, hm: string, meal: string, name: string, grams: number, per100: { kcal: number; protein_g: number; fat_g: number; carbs_g: number }) {
  const k = grams / 100
  const at = new Date(`${day}T${hm}:00+03:00`).toISOString()
  const it = { id: `${name}-${day}`, name, grams, per100, calories: Math.round(per100.kcal * k), protein_g: per100.protein_g * k, fat_g: per100.fat_g * k, carbs_g: per100.carbs_g * k, confidence: 0.85, assumptions: [], source: 'db', db_key: null }
  return {
    id: crypto.randomUUID(), user_id: userId, date: day, meal, title: name, emoji: '🍽️', items: [it],
    calories: it.calories, protein_g: it.protein_g, fat_g: it.fat_g, carbs_g: it.carbs_g, calories_low: null, calories_high: null,
    confidence: 0.85, provider: 'gemini', raw_text: name, status: 'ok', photo_path: null, created_at: at, updated_at: at, deleted_at: null,
  }
}

test('suggestions: only foods from my own log, around this time of day, by what is missing; adding one updates today', async ({ page }) => {
  const u = sb.addUser('איתן', '123456')
  const other = sb.addUser('דנה', '654321')
  ;(sb.tables.mz_profiles ??= []).push({ user_id: u.id, sex: 'male', age: 32, height_cm: 178, weight_kg: 82, protein_target_g: 120, deficit_min: 100, deficit_max: 300, updated_at: '2026-10-01T10:00:00Z' })
  const CHICKEN = { kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0 }
  const TUNA = { kcal: 116, protein_g: 26, fat_g: 1, carbs_g: 0 }
  const YOGURT = { kcal: 58, protein_g: 10, fat_g: 0.2, carbs_g: 4 }
  const PASTA = { kcal: 158, protein_g: 5.8, fat_g: 0.9, carbs_g: 31 }
  const rows = (sb.tables.mz_food_entries ??= [])
  rows.push(
    foodRow(u.id, '2026-10-01', '08:05', 'breakfast', 'יוגורט חלבון', 200, YOGURT),
    foodRow(u.id, '2026-10-02', '07:55', 'breakfast', 'יוגורט חלבון', 200, YOGURT),
    foodRow(u.id, '2026-10-03', '08:10', 'breakfast', 'יוגורט חלבון', 200, YOGURT),
    foodRow(u.id, '2026-10-01', '20:10', 'dinner', 'חזה עוף', 150, CHICKEN),
    foodRow(u.id, '2026-10-03', '19:50', 'dinner', 'חזה עוף', 150, CHICKEN),
    foodRow(u.id, '2026-10-02', '19:40', 'dinner', 'טונה במים', 120, TUNA),
    foodRow(u.id, '2026-10-04', '20:20', 'dinner', 'טונה במים', 120, TUNA),
    // today: a big carb-heavy lunch → protein is what's missing tonight
    foodRow(u.id, '2026-10-06', '12:30', 'lunch', 'פסטה', 400, PASTA),
    // evening junk, eaten as often as the healthy dinners: never suggested
    foodRow(u.id, '2026-10-01', '20:30', 'dinner', 'במבה', 60, { kcal: 534, protein_g: 17.5, fat_g: 34, carbs_g: 39.5 }),
    foodRow(u.id, '2026-10-02', '20:20', 'dinner', 'במבה', 60, { kcal: 534, protein_g: 17.5, fat_g: 34, carbs_g: 39.5 }),
    foodRow(u.id, '2026-10-03', '20:05', 'dinner', 'עוגיית שוקולד צ׳יפס', 50, { kcal: 457, protein_g: 5.5, fat_g: 22.1, carbs_g: 61.4 }),
    foodRow(u.id, '2026-10-04', '20:00', 'dinner', 'עוגיית שוקולד צ׳יפס', 50, { kcal: 457, protein_g: 5.5, fat_g: 22.1, carbs_g: 61.4 }),
    foodRow(u.id, '2026-10-02', '19:55', 'dinner', 'חטיף חלבון', 60, { kcal: 339, protein_g: 35.7, fat_g: 7.6, carbs_g: 34.4 }),
    // someone else's evening food never shows up
    foodRow(other.id, '2026-10-02', '20:00', 'dinner', 'סטייק של דנה', 250, { kcal: 250, protein_g: 26, fat_g: 15, carbs_g: 0 }),
  )

  // 13:00: nothing logged around lunchtime before → no fallback to evening foods, just a short note
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  await expect(hero(page)).toContainText('632')
  await expect(page.getByTestId('suggestions-empty')).toBeVisible()
  await expect(page.getByRole('region', { name: 'הצעה לעכשיו' })).toHaveCount(0)

  // 20:00: evening foods that fill the protein gap
  await page.clock.setSystemTime(new Date('2026-10-06T20:00:00+03:00'))
  await page.reload()
  const card = page.getByRole('region', { name: 'הצעה לעכשיו' })
  await expect(card).toBeVisible()
  await expect(page.getByTestId('suggestions-need')).toContainText('חלבון')
  await expect(card).toContainText('חזה עוף')
  await expect(card).toContainText('טונה במים')
  await expect(card).not.toContainText('יוגורט') // a breakfast food, not at 20:00
  await expect(card).not.toContainText('סטייק של דנה')
  await expect(card).not.toContainText('במבה')
  await expect(card).not.toContainText('עוגיית')
  await expect(card).not.toContainText('חטיף')
  await expect(card.getByRole('listitem')).toHaveCount(2)
  await page.screenshot({ path: 'docs/screenshots/accounts-suggestions.png', fullPage: true })

  // adjust the amount (usual 150 g → +step) and add: a normal entry, totals update, it isn't suggested again
  await card.getByRole('button', { name: /^חזה עוף, 150 גרם/ }).click()
  await card.getByRole('button', { name: 'יותר' }).click()
  await expect(card.getByRole('group', { name: 'כמות חזה עוף' })).toContainText('190')
  await card.getByRole('button', { name: 'הוסף חזה עוף' }).click()
  await expect(hero(page)).toContainText('946') // 632 + 190 g × 1.65
  await expect(card).not.toContainText('חזה עוף')
  await expect(card).toContainText('טונה במים')
  await expect
    .poll(() => sb.rows('mz_food_entries', u.id).filter((r) => r.provider === 'history').map((r) => [r.title, r.date, r.meal, r.calories, (r.items as { grams: number }[])[0].grams]))
    .toEqual([['חזה עוף', '2026-10-06', 'dinner', 314, 190]])
})

test('custom deficit band is saved to the account and comes back after logout / on another device', async ({ page, browser }) => {
  const u = sb.addUser('איתן', '123456')
  await page.goto('/')
  await login(page, 'איתן', '123456')
  await onboard(page, '62')
  await page.getByRole('button', { name: 'הגדרות' }).click()
  const d = page.getByRole('dialog')
  await d.getByRole('radiogroup', { name: 'היעד היומי' }).getByRole('radio', { name: /שמירה/ }).click()
  await d.getByRole('radio', { name: 'מותאם אישית' }).click()
  await d.getByRole('radio', { name: 'עודף', exact: true }).click()
  await d.getByLabel(/^מ-/).fill('150')
  await d.getByLabel(/^עד\s?קק/).fill('250')
  await expect
    .poll(() => {
      const r = sb.rows('mz_profiles', u.id)[0]
      return r && [r.goal_phase, r.calorie_mode, r.custom_deficit_min, r.custom_deficit_max, r.deficit_min, r.deficit_max]
    })
    .toEqual(['maintain', 'custom', -250, -150, -100, 100])
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('calorie-target')).toContainText('150–250')

  // log out and back in
  await logout(page)
  await login(page, 'איתן', '123456')
  await expect(page.getByTestId('calorie-target')).toContainText('150–250')

  // another device: pulled from the account
  const other = await browser.newContext()
  await sb.install(other)
  const p2 = await other.newPage()
  await p2.clock.install({ time: new Date('2026-10-06T13:00:00+03:00') })
  await p2.goto('/')
  await login(p2, 'איתן', '123456')
  await expect(p2.getByTestId('calorie-target')).toContainText('150–250')
  await p2.getByRole('button', { name: 'הגדרות' }).click()
  await expect(p2.getByRole('dialog').getByRole('radiogroup', { name: 'היעד היומי' }).getByRole('radio', { name: /שמירה/ })).toHaveAttribute('aria-checked', 'true')
  await expect(p2.getByRole('dialog').getByRole('radio', { name: 'עודף', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(p2.getByRole('dialog').getByLabel(/^מ-/)).toHaveValue('150')
  await expect(p2.getByRole('dialog').getByLabel(/^עד\s?קק/)).toHaveValue('250')
  await other.close()
})
