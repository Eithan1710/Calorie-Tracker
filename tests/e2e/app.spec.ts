import { expect, test } from '@playwright/test'
import { addText, analysis, at, BURN_NO_STEPS, item, mockAnalyze, seedProfile } from './helpers'

const hero = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'מאזן קלורי' })
// a tiny valid PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const shot = (name: string, project: string) => `docs/screenshots/${project}-${name}.png`

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
    // 215 + 160 + 120 + 30
    await expect(dialog.getByTestId('analysis-total')).toHaveText(/525/)
    await page.screenshot({ path: shot('review', info.project.name) })
    await dialog.getByRole('button', { name: 'אישור' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(hero(page)).toContainText('525')
    // protein 18.9 + 4.6 + 13.8 + 1.2 = 38.5 → 39
    await expect(page.getByRole('region', { name: 'חלבון' })).toContainText('39')
    await expect(page.getByText('נוסף · 525')).toBeVisible()
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
    await expect(hero(page)).toContainText('160')
    await expect(page.getByRole('region', { name: 'מה אכלתי' }).locator('img')).toHaveCount(0)
  })

  test('delete food, then undo', async ({ page }) => {
    await page.goto('/')
    await addText(page, '2 טוסטים עם גבינה צהובה')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('604')
    await page.getByRole('region', { name: 'מה אכלתי' }).getByRole('button', { name: /טוסט/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'מחיקה' }).click()
    await expect(page.getByText('עוד לא נרשם כלום.')).toBeVisible()
    await page.getByRole('button', { name: 'ביטול' }).click()
    await expect(hero(page)).toContainText('604')
  })

  test('one-tap re-log of a recent meal', async ({ page }) => {
    await page.goto('/')
    await addText(page, 'יוגורט חלבון')
    await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click()
    await expect(hero(page)).toContainText('124')
    await page.getByRole('button', { name: 'הוסף אוכל' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: /יוגורט חלבון/ }).click()
    await expect(hero(page)).toContainText('248')
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

  test('strength: optional per-exercise weights are saved but do not change calories', async ({ page }) => {
    await at(page, '2026-10-06T13:00:00')
    await page.goto('/')
    await page.getByRole('button', { name: /אימון/ }).click()
    const d = page.getByRole('dialog')
    await d.getByRole('button', { name: '60' }).click()
    const est = d.getByTestId('exercise-estimate')
    const before = await est.textContent()
    await d.getByRole('button', { name: /משקלים/ }).click()
    await d.getByLabel('שם תרגיל 1').fill('לחיצת חזה')
    await d.getByLabel('משקל בתרגיל 1').fill('68')
    await d.getByLabel('סטים בתרגיל 1').fill('4')
    await d.getByLabel('חזרות בתרגיל 1').fill('8')
    await d.getByRole('button', { name: 'תרגיל נוסף' }).click()
    await d.getByLabel('שם תרגיל 2').fill('סקוואט')
    await d.getByLabel('משקל בתרגיל 2').fill('140')
    await expect(est).toHaveText(before!)
    await d.getByLabel('משקל בתרגיל 2').fill('40')
    await expect(est).toHaveText(before!)
    await d.getByRole('button', { name: /הוסף/ }).click()
    await page.getByRole('button', { name: /אימון/ }).click()
    const list = page.getByRole('dialog').getByRole('list', { name: 'אימונים היום' })
    await expect(list).toContainText('לחיצת חזה 68 ק״ג · 4×8')
    await expect(list).toContainText('סקוואט 40 ק״ג')
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
    await expect(page.getByRole('dialog').getByTestId('analysis-total')).toHaveText(/160/)
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

  test('layout: one column on mobile, two on desktop', async ({ page }, info) => {
    await page.goto('/')
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
