import { describe, expect, it } from 'vitest'
import { classifyFood, CURATED_CLASSES } from './foodQuality'
import { FOODS } from '../../supabase/functions/_shared/foodDb.ts'

const P = (kcal: number, protein_g: number, fat_g: number, carbs_g: number, extra: { sugar_g?: number } = {}) => ({ kcal, protein_g, fat_g, carbs_g, ...extra })
const food = (name: string, per100: ReturnType<typeof P>, db_key: string | null = null, ref?: string) => ({ name, per100, db_key, ref })

describe('every food of the in-app table has an explicit class', () => {
  it('no curated key is left unclassified', () => {
    const keys = FOODS.map((f) => f.key)
    expect(keys.length).toBeGreaterThan(150)
    expect(keys.filter((k) => !(k in CURATED_CLASSES))).toEqual([])
  })
})

// the foods actually in the account's log (audited October 2026), as they are stored
describe('the real log: junk is out, nutritious food is in', () => {
  const OUT: [string, ReturnType<typeof P>, string | null, string?][] = [
    ['סוכר', P(387, 0, 0, 100), 'sugar', 'cur:sugar'],
    ['מי סוכר', P(387, 0, 0, 100), 'sugar'],
    ["צ'יפס", P(312, 3.4, 14.7, 37.6), 'fries', 'cur:fries'],
    ['קטשופ', P(112, 1.3, 0.2, 25.9), 'ketchup'],
    ['פסטו', P(460, 5, 47, 6), 'pesto'],
    ['וופל', P(480, 6, 22, 65), 'cookies'],
    ['עוגייה', P(480, 6, 22, 65), 'cookies'],
    ["עוגיית שוקולד צ'יפס", P(480, 6, 22, 65), 'cookies'],
    ['עוגת שוקולד', P(370, 5, 17, 50), 'cake'],
    ['במבה', P(534, 15, 33, 40), 'bamba'],
    ['דוריטוס גריל', P(519, 7.4, 27.4, 60.8), null],
    ['פופקורן', P(387, 12.9, 4.5, 77.8), null],
    ['פופקורן למיקרוגל הוטפופ', P(535, 8.4, 30.2, 57.3), null],
    ['שוקולד מריר, 70-85% מוצקי קקאו', P(598, 7.8, 42.6, 45.9), null, 'moh:8810'],
    ['שוקולית', P(400, 4.5, 2.5, 90), null, 'moh:241'],
    ['כדור שוקולד עם קוקוס', P(380, 5, 18, 50), null],
    ['לימונדה', P(40, 0.1, 0.1, 10), null],
    ["ג'ין", P(295, 0, 0, 0), null],
    ['בירה טובורג', P(43, 0.5, 0, 3.6), 'beer'],
    ['יין', P(83, 0.1, 0, 2.6), 'wine'],
    ['שמן זית (לטיגון/הברשה)', P(884, 0, 100, 0), 'olive_oil'],
    ['שמן קנולה', P(884, 0, 100, 0), 'oil'],
    ['פירורי לחם', P(378, 3.5, 3.6, 86), null, 'moh:9642'],
    ['מאפה זעתר ושמן זית (מנקיש)', P(350, 7, 15, 45), null],
    ['שניצל עם שומשום', P(260, 19, 14, 15), 'schnitzel'],
    ['שניצל עוף, חזה מטוגן בשמן קנולה עם שומשום', P(284, 25.6, 13.2, 13.2), null, 'moh:9094'],
    ['סלט כרוב במיונז', P(147, 1.1, 11.8, 9.1), 'coleslaw'],
    ['פריכית אורז', P(378, 8.3, 2.8, 80), 'rice_cake'],
    ['באגט לבן', P(272, 10.8, 2.4, 51.9), 'baguette'],
    ['גבינת פרמזן', P(392, 35.8, 25.8, 3.2), 'parmesan'],
  ]
  const IN: [string, ReturnType<typeof P>, string | null, string?][] = [
    ['חזה עוף מבושל', P(165, 31, 3.6, 0), 'chicken_breast_cooked'],
    ['חזה עוף (לא מבושל)', P(120, 22.5, 2.6, 0), 'chicken_breast_raw'],
    ['פרגית מבושלת', P(190, 25, 9.8, 0), 'chicken_thigh_cooked'],
    ['טונה במים', P(86, 19.4, 1, 0), 'tuna_water'],
    ['טונה בשמן', P(198, 29.1, 8.2, 0), 'tuna_oil'],
    ['סלמון אפוי', P(206, 22.1, 12.4, 0), 'salmon_cooked'],
    ['קציצות ברוטב עגבניות', P(135, 10, 6.1, 9.3), 'meatballs'],
    ['אבקת חלבון מי גבינה', P(393, 75, 4.5, 14.6), 'whey'],
    ['משקה חלבון', P(63, 7.2, 1.5, 5.1), null, 'off:7290107954976'],
    ['חלב 3%', P(60, 3.3, 3, 4.6), 'milk_3'],
    ['תפוח', P(52, 0.3, 0.2, 13.8), 'apple'],
    ['בננה', P(89, 1.1, 0.3, 22.8), 'banana'],
    ['תותים', P(32, 0.7, 0.3, 7.7), 'strawberries'],
    ['סלט ירקות (מלפפון, עגבנייה, חסה)', P(17, 0.8, 0.2, 2.9), 'salad_veg'],
    ['מלפפון', P(15, 0.7, 0.1, 3.6), 'cucumber'],
    ['אורז לבן מבושל', P(130, 2.7, 0.3, 27.8), 'rice_white_cooked'],
    ['תפוח אדמה אפוי', P(87, 1.9, 0.1, 20.1), 'potato_boiled'],
    ['קוסקוס ביתי (עם שמן)', P(185, 5.4, 3.9, 31.2), 'couscous_home'],
    ['גרעיני חמנייה / שומשום', P(584, 20.8, 51.5, 11.4), 'seeds'],
  ]
  it.each(OUT)('excluded: %s', (name, per100, db_key, ref) => {
    expect(classifyFood(food(name, per100, db_key, ref)).eligible).toBe(false)
  })
  it.each(IN)('eligible: %s', (name, per100, db_key, ref) => {
    expect(classifyFood(food(name, per100, db_key, ref)).eligible).toBe(true)
  })
})

describe('packaged and other-source foods', () => {
  it('protein-rich packaged dairy and canned fish are not excluded for being packaged', () => {
    expect(classifyFood(food('יוגורט יווני 0% (טרה)', P(55, 10, 0, 4, { sugar_g: 4 }), null, 'off:7290000000001')).cls).toBe('dairy')
    expect(classifyFood(food('קוטג׳ 3% (תנובה)', P(77, 11, 3, 1.5), null, 'off:7290000000002')).cls).toBe('dairy')
    expect(classifyFood(food('סקייר וניל', P(62, 10, 0.2, 4.5, { sugar_g: 4.5 }), null, 'off:7290000000003')).eligible).toBe(true)
    expect(classifyFood(food('טונה בהירה בשמן זית (סטארקיסט)', P(190, 25, 10, 0), null, 'off:7290000000004')).cls).toBe('protein')
    expect(classifyFood(food('שקדים טבעיים', P(579, 21, 50, 9), null, 'moh:1')).cls).toBe('nuts')
    expect(classifyFood(food('שיבולת שועל', P(379, 13, 6.5, 58), null, 'moh:2')).cls).toBe('grain')
    expect(classifyFood(food('עדשים כתומות מבושלות', P(116, 9, 0.4, 20), null, 'usda:3')).cls).toBe('legume')
  })

  it('a flavoured protein yogurt is protein, a chocolate bar is not', () => {
    expect(classifyFood(food('יוגורט חלבון בטעם שוקולד', P(70, 10, 1, 5, { sugar_g: 5 }), null)).eligible).toBe(true)
    expect(classifyFood(food('שוקולד חלב', P(535, 7.7, 29.7, 56), null)).eligible).toBe(false)
    expect(classifyFood(food('מעדן שוקולד', P(120, 3, 3, 20, { sugar_g: 17 }), null)).eligible).toBe(false)
  })

  it('unknown foods are not assumed healthy', () => {
    for (const name of ['עלי גפן ממולאים', 'מנה מיוחדת מהשף', 'Mystery bowl', 'שום כבוש']) {
      const q = classifyFood(food(name, P(150, 3, 6, 18), null))
      expect(q).toMatchObject({ eligible: false })
    }
  })

  it('nutrient red flags catch junk with an innocent name', () => {
    expect(classifyFood(food('חטיפי תירס בטעם גבינה', P(520, 6, 28, 60), null)).eligible).toBe(false)
    expect(classifyFood(food('Fruit gummies', P(330, 1, 0, 80, { sugar_g: 55 }), null)).eligible).toBe(false)
    expect(classifyFood(food('Granola bar honey', P(450, 7, 18, 64, { sugar_g: 28 }), null)).eligible).toBe(false)
    expect(classifyFood(food('Breakfast bowl', P(260, 4, 2, 55, { sugar_g: 30 }), null)).eligible).toBe(false)
  })

  it('sugary drinks and fast food by name, also from other sources', () => {
    for (const name of ['קוקה קולה', 'מיץ ענבים', 'משקה אנרגיה XL', 'שוקו בשקית', 'המבורגר', 'פיצה משפחתית', 'נאגטס עוף', 'בורקס גבינה', 'Red Bull', 'French fries']) {
      expect(classifyFood(food(name, P(100, 3, 3, 15), null)).eligible).toBe(false)
    }
    expect(classifyFood(food('קולה זירו', P(1, 0, 0, 0), null)).eligible).toBe(false) // a drink isn't a food suggestion
  })

  it('a pan-fried egg stays an egg; deep-fried other things are out', () => {
    expect(classifyFood(food('ביצה מטוגנת', P(193, 13.5, 14.7, 0.8), null)).eligible).toBe(true)
    expect(classifyFood(food('חציל מטוגן', P(94, 1.1, 7.6, 3.3), null)).eligible).toBe(false)
  })
})
