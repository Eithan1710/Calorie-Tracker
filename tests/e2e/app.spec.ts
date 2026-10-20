import { expect, test } from '@playwright/test'
import { addText, analysis, at, BURN_NO_STEPS, item, mockAnalyze, seedProfile } from './helpers'

const hero = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'מאזן קלורי' })
// a tiny valid PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const shot = (name: string, project: string) => `docs/screenshots/${project}-${name}.png`

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

test.describe('first run', () => {
  test('onboarding asks only for the profile, then shows today', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.locator('html')).toHaveAttribute('lang', 'he')
    const start = page.getByRole('button', { name: 'בוא נתחיל' })
    await expect(start).toBeDisabled()
    await page.getByLabel('גיל').fill('32')
    await page.getByLabel('גובה').fill('178')
    await page.getByLabel('משקל').fill('82')
    await expect(page.getByLabel('יעד חלבון יומי')).toHaveValue('120')
    await start.click()
    await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
    await expect(hero(page)).toContainText(String(BURN_NO_STEPS).replace(/(\d)(\d{3})$/, '$1,$2'))
  })
})

test.describe('daily logging', () => {
  test.beforeEach(async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T13:00:00')
  })

  test('add food by text (offline deterministic engine), totals & macros update', async ({ page }, info) => {
    await page.goto('/')
    await addText(page, "אכלתי 3 ביצים, 2 פרוסות לחם, קוטג' וסלט")
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('זה נראה נכון?')).toBeVisible()
    // 215 + 158 + 119 + 26 (MoH records: egg 143, white bread 264, cottage 5% 95, Israeli salad 17 per 100 g)
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/518/)
    await page.screenshot({ path: shot('review', info.project.name) })
    await dialog.getByRole('button', { name: 'אישור' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(hero(page)).toContainText('518')
    // protein 18.9 + 5.0 + 13.8 + 1.2 = 38.9 → 39
    await expect(page.getByRole('region', { name: 'חלבון' })).toContainText('39')
    await expect(page.getByText('נוסף · 518')).toBeVisible()
  })

  test('AI result: edit grams recalculates, then confirm', async ({ page }) => {
    await mockAnalyze(
      page,
      analysis(
        [
          item('a', 'המבורגר', 200, { kcal: 254, protein_g: 17.2, fat_g: 20, carbs_g: 0 }),
          item('b', 'לחמנייה', 70, { kcal: 279, protein_g: 9.5, fat_g: 3.8, carbs_g: 49.2 }),
        ],
        { title: 'ההמבורגר שלך', emoji: '🍔', clarification: 'ההמבורגר נשקל לפני או אחרי צלייה?' },
      ),
    )
    await page.goto('/')
    await addText(page, 'המבורגר 200 גרם עם לחמנייה')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('ההמבורגר שלך')).toBeVisible()
    await expect(dialog.getByText('ההמבורגר נשקל לפני או אחרי צלייה?')).toBeVisible()
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/703/) // 508 + 195
    // remove the bun
    await dialog.getByRole('button', { name: 'הסר לחמנייה' }).click()
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/508/)
    // type an exact amount
    const grams = dialog.getByLabel('גרמים של המבורגר')
    await grams.fill('150')
    await grams.press('Enter')
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/381/)
    await dialog.getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('381')
  })

  test('add food by photo, correct "זה היה 250 גרם אורז" → recalculated', async ({ page }, info) => {
    await mockAnalyze(
      page,
      analysis(
        [
          item('c', 'חזה עוף', 180, { kcal: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0 }, { db_key: 'chicken_breast_cooked', grams_low: 140, grams_high: 220, emoji: '🍗' }),
          item('r', 'אורז לבן', 200, { kcal: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28.2 }, { db_key: 'rice_white_cooked', grams_low: 150, grams_high: 250, emoji: '🍚' }),
          item('s', 'סלט', 100, { kcal: 20, protein_g: 0.8, fat_g: 0.2, carbs_g: 3.9 }, { db_key: 'salad_veg', emoji: '🥗' }),
        ],
        { title: 'עוף, אורז וסלט', emoji: '🍗', overall_confidence: 0.65 },
      ),
    )
    await page.goto('/')
    // a tiny valid PNG
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    // the dock camera button opens the camera directly (no file/gallery chooser)
    await expect(page.getByTestId('dock-photo-input')).toHaveAttribute('capture', 'environment')
    await expect(page.getByRole('button', { name: 'צלם אוכל' })).toBeVisible()
    await page.getByTestId('dock-photo-input').setInputFiles({ name: 'food.png', mimeType: 'image/png', buffer: png })
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('עוף, אורז וסלט')).toBeVisible()
    await expect(dialog.getByText('הערכה סבירה')).toBeVisible()
    await expect(dialog.getByText('טווח סביר')).toBeVisible()
    const before = 297 + 260 + 20
    await expect(dialog.getByTestId('analysis-total')).toHaveText(new RegExp(String(before)))
    await page.screenshot({ path: shot('photo-review', info.project.name) })

    await dialog.getByLabel('תיקון לניתוח').fill('זה היה 250 גרם אורז')
    await dialog.getByRole('button', { name: 'שלח תיקון' }).click()
    await expect(dialog.getByLabel('גרמים של אורז לבן')).toHaveValue('250')
    await expect(dialog.getByTestId('analysis-total')).toHaveText(new RegExp(String(before + 65)))
    await dialog.getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText(String(before + 65))
    // the photo stays with the entry: thumbnail in the log, and after a reload
    const log = page.getByRole('region', { name: 'מה אכלתי' })
    await expect(log.locator('img')).toHaveCount(1)
    await page.reload()
    await expect(page.getByRole('region', { name: 'מה אכלתי' }).locator('img')).toHaveCount(1)
  })

  test('attach a photo from the gallery inside the sheet (no camera needed), then edit it later', async ({ page }) => {
    let sentImage = false
    await page.route('**/api/analyze-food', async (route) => {
      sentImage = Boolean(route.request().postDataJSON()?.image)
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(analysis([item('o', 'אומלט', 150, { kcal: 154, protein_g: 10.6, fat_g: 11.7, carbs_g: 0.6 })], { title: 'אומלט', emoji: '🍳' })) })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
    const dialog = page.getByRole('dialog')
    // the gallery input has no `capture` attribute → iOS offers the photo library
    const input = dialog.getByTestId('food-photo-input')
    await expect(input).not.toHaveAttribute('capture', /.*/)
    await expect(dialog.getByRole('button', { name: /הוסף תמונה/ }).first()).toBeVisible()
    await input.setInputFiles({ name: 'IMG_0042.png', mimeType: 'image/png', buffer: PNG })
    await expect(dialog.getByAltText('התמונה של הארוחה')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'נתח את התמונה' })).toBeEnabled()
    await dialog.getByLabel('תיאור האוכל').fill('אומלט משתי ביצים')
    await dialog.getByRole('button', { name: 'חשב' }).click()
    await expect(dialog.getByText('אומלט').first()).toBeVisible()
    expect(sentImage).toBe(true)
    await dialog.getByRole('button', { name: 'אישור' }).click()
    const log = page.getByRole('region', { name: 'מה אכלתי' })
    await expect(log.locator('img')).toHaveCount(1)

    // open the entry: photo shown; remove it → the log falls back to the emoji
    await log.getByRole('button', { name: /אומלט/ }).click()
    const edit = page.getByRole('dialog')
    await expect(edit.getByAltText('התמונה של הארוחה')).toBeVisible()
    await edit.getByRole('button', { name: 'הסר תמונה' }).click()
    await expect(edit.getByRole('button', { name: 'הוסף תמונה' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(log.locator('img')).toHaveCount(0)
  })

  test('food logging without a photo is unchanged', async ({ page }) => {
    await page.goto('/')
    await addText(page, '2 פרוסות לחם')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('158')
    await expect(page.getByRole('region', { name: 'מה אכלתי' }).locator('img')).toHaveCount(0)
  })

  test('delete food, then undo', async ({ page }) => {
    await page.goto('/')
    await addText(page, '2 טוסטים עם גבינה צהובה')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('592')
    await page.getByRole('region', { name: 'מה אכלתי' }).getByRole('button', { name: /טוסט/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'מחיקה' }).click()
    await expect(page.getByText('עוד לא נרשם כלום.')).toBeVisible()
    await page.getByRole('button', { name: 'ביטול' }).click()
    await expect(hero(page)).toContainText('592')
  })

  test('food database: search, pick a serving, log it; swap an item for another record', async ({ page }, info) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /חיפוש במאגר המזון/ }).click()
    await dialog.getByLabel('חיפוש במאגר המזון').fill('קוטג 3')
    await dialog.getByRole('button', { name: /קוטג' 3%/ }).first().click()
    // amount: the serving chips come from the record (גביע = 250 g)
    await dialog.getByRole('button', { name: /גביע · 250/ }).click()
    await expect(dialog.getByText('תווית יצרן').first()).toBeVisible()
    await page.screenshot({ path: shot('food-search-amount', info.project.name) })
    await dialog.getByRole('button', { name: /הוסף · 193/ }).click() // moh:500 Tnuva 3% = 77 kcal/100 g × 250 g
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/193/)
    await dialog.getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('193')

    // swap: "לחם" was white bread; replace it with whole-wheat, keeping the 60 g
    await addText(page, '2 פרוסות לחם')
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/158/)
    await dialog.getByRole('button', { name: 'החלף לחם לבן' }).click()
    await dialog.getByLabel('חיפוש במאגר המזון').fill('לחם מלא')
    await dialog.getByRole('button', { name: /^לחם מלא/ }).first().click()
    await dialog.getByRole('button', { name: /החלף · 148/ }).click() // moh:2005 246 × 60 g
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/148/)
    await expect(dialog.getByLabel('גרמים של לחם מלא')).toHaveValue('60')
  })

  test('one-tap re-log of a recent meal', async ({ page }) => {
    await page.goto('/')
    await addText(page, 'יוגורט חלבון')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('116')
    await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /יוגורט חלבון/ }).click()
    await expect(hero(page)).toContainText('232')
  })
})

test.describe('energy & goal', () => {
  test.beforeEach(async ({ page }) => {
    await seedProfile(page)
  })

  test('running: pace + estimate, steps during the run are not double counted', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    await page.getByRole('button', { name: /אימון/ }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('radio', { name: /ריצה/ }).click()
    await d.getByLabel('מרחק').fill('5')
    await d.getByLabel('זמן בדקות או דקות:שניות').fill('25:00')
    await expect(d.getByText('5:00')).toBeVisible() // pace
    // 1 kcal × 82 kg × 5 km = 410 gross − 25 min × BMR/1440 (1.23) ≈ 380
    await expect(d.getByTestId('exercise-estimate')).toHaveText(/~380/)
    await d.getByRole('button', { name: /הוסף · ~380/ }).click()
    await expect(page.getByRole('button', { name: /אימון/ })).toContainText('5 ק״מ')
  })

  test('strength: duration × intensity (Compendium session METs) × body weight', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    await page.getByRole('button', { name: /אימון/ }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('radio', { name: /כוח/ }).click()
    await d.getByRole('button', { name: '75' }).click()
    const est = d.getByTestId('exercise-estimate')
    // moderate 5.0 MET: 5 × 3.5 × 82 / 200 = 7.18 kcal/min − 1.23 resting = 5.94 × 75 ≈ 450
    await expect(est).toHaveText(/~450/)
    await expect(d.getByTestId('exercise-range')).toBeVisible()
    await d.getByRole('radio', { name: 'קלה' }).click()
    await expect(est).toHaveText(/~280/) // 3.5 MET
    await d.getByRole('radio', { name: 'גבוהה' }).click()
    await expect(est).toHaveText(/~550/) // 6.0 MET
    await d.getByRole('radio', { name: /קצרות/ }).click()
    await expect(est).toHaveText(/~710/) // 7.5 MET, supersets / circuit
    await d.getByRole('radio', { name: /רגילות/ }).click()
    // shorter session → proportionally less
    await d.getByRole('button', { name: '45' }).click()
    await expect(est).toHaveText(/~330/)
    await d.getByRole('button', { name: '75' }).click()
    await d.getByRole('button', { name: /הוסף/ }).click()
    await expect(page.getByRole('button', { name: /אימון/ })).toContainText('550')
  })

  test('strength: muscle groups and total volume refine the estimate (bounded) and are saved', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    await page.getByRole('button', { name: /אימון/ }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('button', { name: '60' }).click()
    const est = d.getByTestId('exercise-estimate')
    // 60 min moderate, 82 kg: (5.0 × 3.5 × 82 / 200 − 1.23) × 60 ≈ 360
    await expect(est).toHaveText(/~360/)
    await d.getByRole('button', { name: 'רגליים' }).click()
    await expect(d.getByRole('button', { name: 'רגליים' })).toHaveAttribute('aria-pressed', 'true')
    await expect(est).toHaveText(/~400/) // legs: MET × 1.10
    await d.getByRole('button', { name: 'רגליים' }).click()
    await d.getByRole('button', { name: 'ידיים' }).click()
    await expect(est).toHaveText(/~310/) // arms only: MET × 0.90
    await d.getByRole('button', { name: 'ידיים' }).click()
    await d.getByRole('button', { name: 'רגליים' }).click()
    await d.getByRole('button', { name: 'כתפיים' }).click()
    await d.getByLabel('משקל כולל שהורם באימון (לא חובה)').fill('8000')
    await expect(est).toHaveText(/~450/) // + 8,000 kg × 0.0059 ≈ 47
    await expect(d.getByTestId('exercise-volume-part')).toContainText('45')
    await d.getByRole('button', { name: /הוסף · ~450/ }).click()
    await page.getByRole('button', { name: /אימון/ }).click()
    await expect(page.getByRole('dialog').getByRole('list', { name: 'אימונים היום' })).toContainText('רגליים, כתפיים · 8,000 ק״ג')
  })

  test('changing body weight changes the workout estimate', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    await page.getByRole('button', { name: 'הגדרות' }).click()
    await page.getByRole('dialog').getByLabel('משקל').fill('100')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /אימון/ }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('button', { name: '75' }).click()
    // 5 × 3.5 × 100 / 200 = 8.75 − (BMR 1957.5 / 1440 = 1.36) = 7.39 × 75 ≈ 550 (vs ~450 at 82 kg)
    await expect(d.getByTestId('exercise-estimate')).toHaveText(/~550/)
  })

  test('manual steps raise calories burned', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    await expect(hero(page)).toContainText('2,053')
    await page.getByRole('button', { name: /צעדים/ }).click()
    await page.getByRole('dialog').getByLabel('צעדים היום').fill('8000')
    await page.getByRole('dialog').getByRole('button', { name: 'עדכון' }).click()
    // 8000 × 0.7387 m × 82 × 0.5 × 1.1 = 266 more
    await expect(hero(page)).toContainText('2,320')
    // no Apple Health data: the breakdown is an honest estimate (rows add up to the total)
    const energy = page.getByRole('region', { name: 'שריפה היום' })
    await expect(energy.getByTestId('energy-total')).toHaveText(/2,320/)
    await expect(energy.getByTestId('energy-status')).toContainText('הערכה')
    await page.screenshot({ path: shot('energy-estimate', test.info().project.name), fullPage: true })
  })

  test('steps arrive from a Shortcut URL', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/?steps=7842&date=2026-10-06')
    await expect(page.getByRole('button', { name: /צעדים/ })).toContainText('7,842')
    await expect(page).toHaveURL(/\/$/)
  })

  test('goal: 200 kcal deficit in the evening → היעד הושג', async ({ page }, info) => {
    await at(page, '2026-10-06T21:00:00')
    await mockAnalyze(page, analysis([item('x', 'ארוחות היום', 1000, { kcal: (BURN_NO_STEPS - 200) / 10, protein_g: 7, fat_g: 2, carbs_g: 30 })], { title: 'כל היום' }))
    await page.goto('/')
    await addText(page, 'כל מה שאכלתי היום')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('היעד הושג')
    await expect(hero(page)).toContainText('−200')
    await expect(page.getByRole('region', { name: 'חלבון' })).toContainText('70')
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(800) // let the count-up animation settle
    await page.screenshot({ path: shot('today-success', info.project.name), fullPage: false })
  })

  test('goal: surplus and "almost" are reported gently', async ({ page }) => {
    await at(page, '2026-10-06T21:00:00')
    await mockAnalyze(page, analysis([item('x', 'x', 1000, { kcal: (BURN_NO_STEPS + 100) / 10, protein_g: 5, fat_g: 5, carbs_g: 20 })]))
    await page.goto('/')
    await addText(page, 'הרבה')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('עודף קלורי קטן היום')
    await expect(hero(page)).toContainText('+100')
  })

  test('mid-day big deficit → shows how much is left to eat (no warning)', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    await addText(page, '3 ביצים')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('אפשר לאכול עוד')
    await expect(hero(page)).not.toContainText('גדול מהיעד')
  })
})

test.describe('resilience', () => {
  test.beforeEach(async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T13:00:00')
  })

  test('offline: known foods still log instantly; unknown text is queued and analysed when back online', async ({ page, context }) => {
    await page.goto('/')
    // like a real launch: the app loads its offline parser right after the first screen
    await page.waitForFunction(() => (window as unknown as { __mzOfflineReady?: boolean }).__mzOfflineReady === true)
    await context.setOffline(true)
    await addText(page, '3 ביצים')
    await expect(page.getByRole('dialog').getByText('חושב מהמאגר בלי AI')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('215')
    // a 4-digit mid-day balance must not push the layout wider than the phone (it used to hide the dock)
    const vw = page.viewportSize()!.width
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(vw)

    await addText(page, 'פשטידה של סבתא')
    await expect(page.getByRole('alert')).toContainText('אין חיבור')
    await page.getByRole('button', { name: 'לשמור ולנתח אחר כך' }).click()
    await expect(page.getByText('ממתין לניתוח')).toBeVisible()

    await mockAnalyze(page, analysis([item('p', 'פשטידה', 200, { kcal: 220, protein_g: 9, fat_g: 14, carbs_g: 15 })], { title: 'פשטידה של סבתא', emoji: '🥧' }))
    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(page.getByText('ממתין לניתוח')).toHaveCount(0)
    await expect(hero(page)).toContainText('655')
  })

  test('AI outage: friendly Hebrew message, no technical error', async ({ page }) => {
    await mockAnalyze(page, { error: 'unavailable', message: 'הניתוח לא זמין כרגע. נסה שוב בעוד רגע.' }, 503)
    await page.goto('/')
    await addText(page, 'מנה מיוחדת מהשף')
    await expect(page.getByRole('alert')).toContainText('הניתוח לא זמין כרגע')
    await expect(page.getByRole('alert')).not.toContainText('503')
  })

  test('AI outage for known foods → deterministic fallback still works', async ({ page }) => {
    await mockAnalyze(page, { error: 'unavailable', message: 'x' }, 503)
    await page.goto('/')
    await addText(page, '2 פרוסות לחם')
    await expect(page.getByRole('dialog').getByTestId('analysis-total')).toHaveText(/158/)
  })

  test('invalid JSON from the server is never saved', async ({ page }) => {
    await mockAnalyze(page, '{"items":"lots","calories":"about 600"}')
    await page.goto('/')
    await addText(page, 'משהו לא מוכר בכלל')
    await expect(page.getByRole('alert')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'סגירה' }).click()
    await expect(page.getByText('עוד לא נרשם כלום.')).toBeVisible()
  })

  test('unclear photo → asks for another photo or text', async ({ page }) => {
    await mockAnalyze(page, { error: 'unclear_image', message: 'התמונה קצת לא ברורה לי. אפשר לנסות תמונה נוספת או לכתוב מה אכלת.' }, 422)
    await page.goto('/')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await page.getByTestId('dock-photo-input').setInputFiles({ name: 'blur.png', mimeType: 'image/png', buffer: png })
    await expect(page.getByRole('alert')).toContainText('התמונה קצת לא ברורה לי')
  })
})

test.describe('reminder', () => {
  test('after 21:30 with nothing logged → in-app nudge; disappears once logged', async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T21:45:00')
    await page.goto('/')
    const nudge = page.getByRole('button', { name: /לא שכחת לעדכן את היום/ })
    await expect(nudge).toBeVisible()
    await nudge.click()
    await page.getByLabel('תיאור האוכל').fill('סלט')
    await page.getByRole('button', { name: 'חשב' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(nudge).toHaveCount(0)
  })

  test('before 21:30 → no nudge', async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T20:00:00')
    await page.goto('/')
    await expect(page.getByRole('button', { name: /לא שכחת לעדכן את היום/ })).toHaveCount(0)
  })
})

test.describe('layout & a11y', () => {
  test.beforeEach(async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T13:00:00')
  })

  test('RTL: title on the right, no horizontal scroll', async ({ page }) => {
    await page.goto('/')
    const vw = page.viewportSize()!.width
    const box = await page.getByRole('heading', { name: 'היום' }).boundingBox()
    expect(box!.x + box!.width).toBeGreaterThan(vw / 2)
    const sw = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(sw).toBeLessThanOrEqual(vw)
  })

  test('dock: every button is on top and works, also right after a sheet closes', async ({ page }) => {
    await mockAnalyze(page, analysis([item('e', 'ביצה', 150, { kcal: 143, protein_g: 12.6, fat_g: 9.5, carbs_g: 0.7 })]))
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'ניווט ראשי' })
    const onTop = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('nav[aria-label="ניווט ראשי"] button, nav[aria-label="ניווט ראשי"] label[aria-label]')].map((b) => {
          const r = b.getBoundingClientRect()
          return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button, label') === b
        }),
      )
    await expect(nav.getByRole('button', { name: 'היסטוריה' })).toBeVisible()
    expect(await onTop()).toEqual([true, true, true, true])
    // labels + selected state are visible, not only icons
    await expect(nav.getByRole('button', { name: 'היום' })).toHaveAttribute('aria-current', 'page')
    await expect(nav).toContainText('היסטוריה')
    await expect(nav).toContainText('צילום')
    // add a meal, and tap the dock while the sheet is still animating away
    await addText(page, '3 ביצים')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    expect(await onTop()).toEqual([true, true, true, true])
    await nav.getByRole('button', { name: 'היסטוריה' }).click()
    await expect(page.getByRole('heading', { name: 'היסטוריה' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'היסטוריה' })).toHaveAttribute('aria-current', 'page')
    const chooser = page.waitForEvent('filechooser')
    await nav.getByRole('button', { name: 'צלם אוכל' }).click()
    await chooser
  })

  test('layout: one column on mobile, two on desktop', async ({ page }, info) => {
    await page.goto('/')
    await expect(hero(page)).toBeVisible()
    // measure after the cards' entrance animation (they slide up 10 px)
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)))
    const heroBox = (await hero(page).boundingBox())!
    const logBox = (await page.getByRole('region', { name: 'מה אכלתי' }).boundingBox())!
    if (info.project.name === 'desktop') expect(Math.abs(heroBox.y - logBox.y)).toBeLessThan(5)
    else expect(logBox.y).toBeGreaterThan(heroBox.y + heroBox.height)
    await page.screenshot({ path: shot('today-empty', info.project.name) })
  })

  test('sheets are modal dialogs and close with Escape', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
    const d = page.getByRole('dialog')
    await expect(d).toHaveAttribute('aria-modal', 'true')
    await expect(page.getByLabel('תיאור האוכל')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('touch targets are at least 40px', async ({ page }) => {
    await page.goto('/')
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => ({ t: b.getAttribute('aria-label') ?? b.textContent, r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.height < 40 || r.width < 40)
        .map(({ t }) => t),
    )
    expect(small).toEqual([])
  })

  test('history: week & month with charts; tapping a day opens it', async ({ page }, info) => {
    await page.goto('/')
    await addText(page, '3 ביצים ו2 פרוסות לחם')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await page.getByRole('button', { name: 'היסטוריה' }).click()
    await expect(page.getByRole('heading', { name: 'היסטוריה' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'מאזן יומי' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'חלבון' })).toBeVisible()
    await page.getByRole('radio', { name: 'חודש' }).click()
    await expect(page.getByText('מאזן ממוצע')).toBeVisible()
    await page.screenshot({ path: shot('history', info.project.name) })
    await page.getByRole('region', { name: 'ימים' }).getByRole('button').first().click()
    await expect(page.getByRole('heading', { name: 'היום' })).toBeVisible()
  })

  test('settings: minimal, explains the burn calculation', async ({ page }, info) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'הגדרות' }).click()
    const d = page.getByRole('dialog')
    await expect(d.getByLabel('יעד חלבון יומי')).toHaveValue('120')
    await d.getByRole('button', { name: 'איך מחושבת השריפה?' }).click()
    await expect(d.getByText(/Mifflin-St Jeor/)).toBeVisible()
    await expect(d.getByRole('radiogroup', { name: 'היעד היומי' })).toBeVisible()
    await page.screenshot({ path: shot('settings', info.project.name) })
  })
})

test.describe('custom calorie range', () => {
  test.beforeEach(async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T13:00:00')
  })

  test('phase + custom range work together: save, validate, switch phase and mode, survive a reload, judge the day', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'הגדרות' }).click()
    let d = page.getByRole('dialog')
    // the phases are still there, automatic mode by default
    const phases = d.getByRole('radiogroup', { name: 'היעד היומי' })
    for (const name of ['ריקומפ', 'ירידה במשקל', 'שמירה', 'עלייה נקייה']) await expect(phases.getByRole('radio', { name: new RegExp(name) })).toBeVisible()
    await expect(phases.getByRole('radio', { name: /ריקומפ/ })).toHaveAttribute('aria-checked', 'true')
    await expect(d.getByRole('radio', { name: 'אוטומטי' })).toHaveAttribute('aria-checked', 'true')
    await expect(d.getByTestId('auto-target')).toContainText('קק״ל')

    // custom: any values
    await d.getByRole('radio', { name: 'מותאם אישית' }).click()
    await d.getByLabel('מינימום').fill('1900')
    await d.getByLabel('מקסימום').fill('2100')
    await expect(d.getByTestId('custom-target')).toContainText('1,900–2,100')
    // invalid input is refused with a reason; the saved range stays
    await d.getByLabel('מינימום').fill('2200')
    await expect(d.getByRole('alert')).toContainText('המינימום צריך להיות נמוך מהמקסימום')
    await expect(d.getByRole('alert')).toContainText('1,900–2,100')
    await d.getByLabel('מינימום').fill('1900')
    await page.screenshot({ path: shot('settings-custom-range', test.info().project.name) })
    await page.keyboard.press('Escape')

    // Today shows the range
    await expect(page.getByTestId('calorie-target')).toContainText('יעד יומי')
    await expect(page.getByTestId('calorie-target')).toContainText('1,900–2,100') // the range sits in a direction isolate

    // a different phase does not overwrite the custom range
    await page.getByRole('button', { name: 'הגדרות' }).click()
    d = page.getByRole('dialog')
    await d.getByRole('radiogroup', { name: 'היעד היומי' }).getByRole('radio', { name: /ירידה במשקל/ }).click()
    await expect(d.getByLabel('מינימום')).toHaveValue('1900')
    await expect(d.getByLabel('מקסימום')).toHaveValue('2100')
    // automatic → the phase's band again; back to custom → the values are still there
    await d.getByRole('radio', { name: 'אוטומטי' }).click()
    await expect(d.getByTestId('auto-target')).toBeVisible()
    await d.getByRole('radio', { name: 'מותאם אישית' }).click()
    await expect(d.getByLabel('מינימום')).toHaveValue('1900')
    await expect(d.getByLabel('מקסימום')).toHaveValue('2100')
    await page.keyboard.press('Escape')

    // persisted after a reload, for this account's settings
    await page.reload()
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('maazan:settings') ?? '{}'))
    expect(saved).toMatchObject({ calorieMode: 'custom', customKcal: { min: 1900, max: 2100 }, goalPhase: 'cut', deficitTarget: { min: 300, max: 500 } })
    await expect(page.getByTestId('calorie-target')).toContainText('1,900–2,100')

    // the day is judged against the whole range
    await mockAnalyze(page, analysis([item('m', 'ארוחה גדולה', 600, { kcal: 300, protein_g: 20, fat_g: 10, carbs_g: 30 })], { title: 'ארוחה גדולה' }))
    await addText(page, 'ארוחה גדולה')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('1,800') // eaten
    await expect(hero(page)).toContainText('יש מקום') // 13:00, below the range: room to eat
    await expect(hero(page)).toContainText('100–300')
    await mockAnalyze(page, analysis([item('s', 'חטיף', 100, { kcal: 200, protein_g: 5, fat_g: 5, carbs_g: 30 })], { title: 'חטיף' }))
    await addText(page, 'חטיף')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('2,000')
    await expect(hero(page)).toContainText('בטווח היעד')
    await addText(page, 'חטיף')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('2,200')
    await expect(hero(page)).toContainText('מעל טווח היעד')
    await expect(hero(page)).toContainText('100 קק״ל מעל')
    await page.screenshot({ path: shot('today-custom-range', test.info().project.name) })

    // history: days in target against the same range
    await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'היסטוריה' }).click()
    await expect(page.getByText('קלוריות ביום')).toBeVisible()
    await expect(page.getByText(/1,900–2,100/).first()).toBeVisible()

    // automatic again: the original balance view is back
    await page.getByRole('navigation', { name: 'ניווט ראשי' }).getByRole('button', { name: 'היום' }).click()
    await page.getByRole('button', { name: 'הגדרות' }).click()
    await page.getByRole('dialog').getByRole('radio', { name: 'אוטומטי' }).click()
    await page.keyboard.press('Escape')
    await expect(hero(page)).toContainText('מאזן היום')
  })
})

test.describe('install as an app', () => {
  const fakeInstallEvent = (outcome: 'accepted' | 'dismissed') =>
    `(() => {
      const e = new Event('beforeinstallprompt', { cancelable: true })
      e.prompt = async () => { window.__prompted = (window.__prompted || 0) + 1 }
      e.userChoice = Promise.resolve({ outcome: '${outcome}', platform: 'web' })
      window.dispatchEvent(e)
    })()`

  test.beforeEach(async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T13:00:00')
  })

  test('no install button until the browser offers installation (desktop)', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('region', { name: 'התקנת האפליקציה' })).toHaveCount(0)
  })

  test('Chrome offers install → our button shows the native dialog only on tap, then hides', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(fakeInstallEvent('accepted'))
    const banner = page.getByRole('region', { name: 'התקנת האפליקציה' })
    await expect(banner).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted ?? 0)).toBe(0)
    await banner.getByRole('button', { name: 'התקן את האפליקציה' }).click()
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: number }).__prompted ?? 0)).toBe(1)
    await expect(banner).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('region', { name: 'התקנת האפליקציה' })).toHaveCount(0)
  })

  test('the banner can be dismissed and stays dismissed; settings still offers it', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(fakeInstallEvent('dismissed'))
    await page.getByRole('region', { name: 'התקנת האפליקציה' }).getByRole('button', { name: 'לא עכשיו' }).click()
    await expect(page.getByRole('region', { name: 'התקנת האפליקציה' })).toHaveCount(0)
    await page.reload()
    await page.evaluate(fakeInstallEvent('dismissed'))
    await expect(page.getByRole('region', { name: 'התקנת האפליקציה' })).toHaveCount(0)
    await page.getByRole('button', { name: 'הגדרות' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'התקן את האפליקציה' })).toBeVisible()
  })

  test('appinstalled → no install button anywhere', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(fakeInstallEvent('dismissed'))
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(page.getByRole('region', { name: 'התקנת האפליקציה' })).toHaveCount(0)
    await page.getByRole('button', { name: 'הגדרות' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'התקן את האפליקציה' })).toHaveCount(0)
  })

  test('running as the installed app (standalone) → nothing to install', async ({ page }) => {
    await page.addInitScript(() => {
      const orig = window.matchMedia.bind(window)
      window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} } as unknown as MediaQueryList) : orig(q))
    })
    await page.goto('/')
    await page.evaluate(fakeInstallEvent('dismissed'))
    await expect(page.getByRole('region', { name: 'התקנת האפליקציה' })).toHaveCount(0)
    await page.getByRole('button', { name: 'הגדרות' }).click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'התקן את האפליקציה' })).toHaveCount(0)
  })
})

test.describe('install as an app — Android browser without an install dialog', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36' })

  test('shows the button and, on tap, simple menu instructions', async ({ page }) => {
    await seedProfile(page)
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    const banner = page.getByRole('region', { name: 'התקנת האפליקציה' })
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: 'התקן את האפליקציה' }).click()
    const help = page.getByRole('dialog', { name: 'התקנת האפליקציה' })
    await expect(help).toContainText('התקנת אפליקציה')
    await expect(help).toContainText('הוספה למסך הבית')
    await help.getByRole('button', { name: 'הבנתי' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
})
