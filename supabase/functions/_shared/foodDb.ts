/**
 * Curated nutrition reference table — per 100 g of the food *in the stated
 * state* (raw / cooked / as-sold).
 *
 * Sources:
 *  - 'usda'   USDA FoodData Central, SR Legacy / Foundation entries
 *  - 'il'     Average of Israeli product labels (Tnuva, Strauss, Osem, Angel…)
 *             for foods with no good USDA equivalent
 *  - 'recipe' Standard-recipe composite computed from 'usda'/'il' ingredients
 *             (documented next to the entry)
 *
 * This table is the "structured data" step of the pipeline: the AI maps each
 * food it recognises to a `key` here and supplies only the gram amount. The
 * calories/macros are then calculated from this table, not invented by the
 * model. Foods not in the table fall back to USDA FDC search, then to the
 * AI's own per-100 g estimate (flagged as such).
 */

export type FoodState = 'raw' | 'cooked' | 'as_sold'
export type UnitKey =
  | 'unit' | 'slice' | 'tbsp' | 'tsp' | 'cup' | 'handful' | 'serving'
  | 'can' | 'container' | 'scoop' | 'bag' | 'piece'

export interface FoodRef {
  key: string
  he: string
  en: string
  emoji: string
  /** Hebrew aliases for the offline parser (without prefixes ה/ו/ב). */
  aliases: string[]
  state: FoodState
  kcal: number
  p: number
  f: number
  c: number
  source: 'usda' | 'il' | 'recipe'
  /** grams per unit word; `serving` is the default portion when no amount is given */
  units: Partial<Record<UnitKey, number>> & { serving: number }
  /** composite dishes: ingredient keys already inside (prevents double counting "טוסט עם גבינה") */
  includes?: string[]
}

const F = (
  key: string, he: string, en: string, emoji: string, aliases: string[], state: FoodState,
  [kcal, p, f, c]: [number, number, number, number], source: FoodRef['source'],
  units: FoodRef['units'],
  includes?: string[],
): FoodRef => ({ key, he, en, emoji, aliases, state, kcal, p, f, c, source, units, ...(includes ? { includes } : {}) })

export const FOODS: FoodRef[] = [
  // ── Eggs ────────────────────────────────────────────────────────────────
  F('egg', 'ביצה', 'Egg, whole (boiled/raw)', '🥚', ['ביצה', 'ביצים', 'ביצה קשה', 'ביצים קשות', 'ביצה רכה'], 'as_sold', [143, 12.6, 9.5, 0.7], 'usda', { unit: 50, serving: 100 }),
  F('egg_fried', 'ביצה מטוגנת / עין', 'Egg, fried in oil', '🍳', ['ביצה מטוגנת', 'ביצים מטוגנות', 'ביצת עין', 'ביצי עין', 'עין', 'עיניים'], 'cooked', [196, 13.6, 14.8, 0.8], 'usda', { unit: 46, serving: 92 }),
  F('omelet', 'חביתה', 'Omelet (with oil)', '🍳', ['חביתה', 'חביתות', 'אומלט'], 'cooked', [154, 10.6, 11.7, 0.6], 'usda', { unit: 120, serving: 120 }),
  F('egg_white', 'חלבון ביצה', 'Egg white', '🥚', ['חלבון ביצה', 'חלבוני ביצה', 'חלבונים'], 'as_sold', [52, 10.9, 0.2, 0.7], 'usda', { unit: 33, serving: 100 }),
  F('shakshuka', 'שקשוקה', 'Shakshuka (eggs in tomato sauce)', '🍳', ['שקשוקה'], 'cooked', [118, 6.2, 8.4, 5.2], 'recipe', { serving: 300 }, ['egg', 'tomato']),

  // ── Bread & bakery ──────────────────────────────────────────────────────
  F('bread_white', 'לחם לבן', 'Bread, white', '🍞', ['לחם לבן', 'לחם', 'לחם אחיד'], 'as_sold', [266, 7.6, 3.3, 50.6], 'usda', { slice: 30, unit: 30, serving: 60 }),
  F('bread_whole', 'לחם מלא', 'Bread, whole wheat', '🍞', ['לחם מלא', 'לחם חיטה מלאה', 'לחם כוסמין', 'לחם שיפון', 'לחם דגנים'], 'as_sold', [252, 12.4, 3.5, 42.7], 'usda', { slice: 32, unit: 32, serving: 64 }),
  F('bread_light', 'לחם קל', 'Bread, light (Israeli)', '🍞', ['לחם קל', 'לחם דל', 'לחם לייט'], 'as_sold', [215, 11, 2.5, 37], 'il', { slice: 22, unit: 22, serving: 44 }),
  F('pita', 'פיתה', 'Pita, white', '🫓', ['פיתה', 'פיתות', 'פיתה לבנה'], 'as_sold', [275, 9.1, 1.2, 55.7], 'usda', { unit: 90, serving: 90 }),
  F('pita_whole', 'פיתה מלאה', 'Pita, whole wheat', '🫓', ['פיתה מלאה', 'פיתות מלאות'], 'as_sold', [266, 9.8, 2.6, 55], 'usda', { unit: 85, serving: 85 }),
  F('laffa', 'לאפה', 'Laffa flatbread', '🫓', ['לאפה', 'לאפות', 'טורטיה', 'טורטיות'], 'as_sold', [285, 8.5, 4, 54], 'il', { unit: 120, serving: 120 }),
  F('roll', 'לחמנייה', 'Bread roll / bun', '🍞', ['לחמנייה', 'לחמניה', 'לחמניות', 'לחמניית המבורגר', 'באן'], 'as_sold', [279, 9.5, 3.8, 49.2], 'usda', { unit: 70, serving: 70 }),
  F('baguette', 'באגט', 'Baguette', '🥖', ['באגט', 'בגט', 'ג\'בטה', 'ציאבטה'], 'as_sold', [272, 10.8, 2.4, 51.9], 'usda', { unit: 120, serving: 120 }),
  F('challah', 'חלה', 'Challah', '🍞', ['חלה', 'חלות'], 'as_sold', [286, 8.8, 7, 47], 'usda', { slice: 40, unit: 40, serving: 80 }),
  F('bagel', 'בייגל', 'Bagel, plain', '🥯', ['בייגל', 'בייגלים'], 'as_sold', [257, 10, 1.6, 50.5], 'usda', { unit: 100, serving: 100 }),
  F('croissant', 'קרואסון', 'Croissant, butter', '🥐', ['קרואסון', 'קרואסונים'], 'as_sold', [406, 8.2, 21, 45.8], 'usda', { unit: 65, serving: 65 }),
  F('burekas', 'בורקס', 'Burekas (cheese/potato)', '🥟', ['בורקס', 'בורקסים', 'בורקס גבינה', 'בורקס תפוח אדמה'], 'as_sold', [345, 8, 21, 31], 'il', { unit: 110, serving: 110 }),
  F('malawach', 'מלוואח', 'Malawach', '🫓', ['מלוואח', 'מלאווח', "ג'חנון", 'גחנון'], 'cooked', [330, 6.5, 18, 36], 'il', { unit: 130, serving: 130 }),
  F('rice_cake', 'פריכית', 'Rice cake', '🍘', ['פריכית', 'פריכיות', 'פריכיות אורז'], 'as_sold', [387, 8.2, 2.8, 81.5], 'usda', { unit: 9, serving: 18 }),
  F('crackers', 'קרקרים', 'Crackers', '🍘', ['קרקר', 'קרקרים', 'קרקר מלוח'], 'as_sold', [430, 9, 12, 70], 'usda', { unit: 5, serving: 30 }),

  // ── Composite sandwiches ────────────────────────────────────────────────
  // Recipe: 2 slices white bread (60 g) + 40 g 28% yellow cheese, pressed → 100 g
  F('toast_cheese', 'טוסט גבינה צהובה', 'Grilled cheese toast', '🥪', ['טוסט', 'טוסטים', 'טוסט גבינה', 'טוסט גבינה צהובה', 'טוסטים עם גבינה צהובה'], 'cooked', [302, 15, 13.2, 30.6], 'recipe', { unit: 100, serving: 100 }, ['yellow_cheese_28', 'yellow_cheese_light', 'bread_white']),
  F('pizza', 'פיצה', 'Pizza, cheese (slice)', '🍕', ['פיצה'], 'cooked', [266, 11.4, 10.4, 33], 'usda', { slice: 120, unit: 120, piece: 120, serving: 240 }, ['yellow_cheese_28', 'mozzarella']),

  // ── Dairy ───────────────────────────────────────────────────────────────
  F('cottage_5', "קוטג' 5%", 'Cottage cheese 5%', '🥛', ["קוטג'", 'קוטג', "קוטג' 5%", 'קוטג׳'], 'as_sold', [96, 11, 5, 1.5], 'il', { container: 250, tbsp: 30, serving: 125 }),
  F('cottage_3', "קוטג' 3%", 'Cottage cheese 3%', '🥛', ["קוטג' 3%", 'קוטג 3%', "קוטג' לייט"], 'as_sold', [80, 11.5, 3, 1.8], 'il', { container: 250, tbsp: 30, serving: 125 }),
  F('white_cheese_5', 'גבינה לבנה 5%', 'Quark / white cheese 5%', '🥛', ['גבינה לבנה', 'גבינה לבנה 5%', 'גבינה רכה'], 'as_sold', [98, 9, 5, 4], 'il', { container: 250, tbsp: 30, serving: 60 }),
  F('labane', 'לבנה', 'Labneh', '🥛', ['לבנה', 'לאבנה'], 'as_sold', [125, 6, 9, 4.5], 'il', { tbsp: 30, container: 250, serving: 60 }),
  F('yellow_cheese_28', 'גבינה צהובה 28%', 'Yellow cheese 28% (Gouda-type)', '🧀', ['גבינה צהובה', 'גבינה צהובה 28%', 'גאודה', 'עמק'], 'as_sold', [355, 26, 28, 0.5], 'il', { slice: 20, unit: 20, serving: 40 }),
  F('yellow_cheese_light', 'גבינה צהובה 9%', 'Yellow cheese, light 9%', '🧀', ['גבינה צהובה 9%', 'גבינה צהובה לייט', 'גבינה צהובה דלה'], 'as_sold', [235, 31, 9, 1], 'il', { slice: 20, unit: 20, serving: 40 }),
  F('feta', 'גבינה בולגרית', 'Feta / Bulgarian cheese', '🧀', ['בולגרית', 'גבינה בולגרית', 'פטה', 'גבינת פטה', 'צפתית', 'גבינה מלוחה'], 'as_sold', [264, 14.2, 21.3, 4.1], 'usda', { tbsp: 20, slice: 30, serving: 50 }),
  F('mozzarella', 'מוצרלה', 'Mozzarella', '🧀', ['מוצרלה', 'מוצרלה טרייה'], 'as_sold', [280, 27.5, 17, 3.1], 'usda', { slice: 25, serving: 50 }),
  F('parmesan', 'פרמזן', 'Parmesan', '🧀', ['פרמזן', 'פרמג\'יאנו'], 'as_sold', [392, 35.8, 25.8, 3.2], 'usda', { tbsp: 5, serving: 10 }),
  F('cream_cheese', 'גבינת שמנת', 'Cream cheese', '🧀', ['גבינת שמנת', 'פילדלפיה', 'שמנת לבישול'], 'as_sold', [342, 6, 34, 4], 'usda', { tbsp: 15, serving: 30 }),
  F('yogurt_plain', 'יוגורט 3%', 'Yogurt, plain 3%', '🥣', ['יוגורט', 'יוגורט טבעי', 'יוגורטים'], 'as_sold', [61, 3.5, 3.3, 4.7], 'usda', { container: 200, cup: 245, serving: 200 }),
  F('yogurt_greek', 'יוגורט יווני', 'Greek yogurt, low fat', '🥣', ['יוגורט יווני', 'יווני'], 'as_sold', [73, 9.9, 1.9, 3.9], 'usda', { container: 150, cup: 245, serving: 150 }),
  F('protein_yogurt', 'יוגורט חלבון', 'High-protein yogurt (e.g. Danone PRO)', '🥣', ['יוגורט חלבון', 'דנונה פרו', 'פרו', 'גו', 'יופלה גו', 'מעדן חלבון', 'מילקי חלבון'], 'as_sold', [62, 10, 0.3, 4.8], 'il', { container: 200, unit: 200, serving: 200 }),
  F('milk_3', 'חלב 3%', 'Milk 3%', '🥛', ['חלב', 'חלב 3%'], 'as_sold', [60, 3.3, 3, 4.7], 'il', { cup: 240, tbsp: 15, serving: 240 }),
  F('milk_1', 'חלב 1%', 'Milk 1%', '🥛', ['חלב 1%', 'חלב דל'], 'as_sold', [42, 3.4, 1, 5], 'il', { cup: 240, tbsp: 15, serving: 240 }),
  F('chocolate_milk', 'שוקו', 'Chocolate milk', '🥛', ['שוקו', 'שוקו בשקית', 'חלב שוקו'], 'as_sold', [83, 3.4, 2.3, 12], 'il', { cup: 240, unit: 250, serving: 250 }),
  F('milky', 'מילקי', 'Chocolate pudding with cream (Milky)', '🍮', ['מילקי', 'מעדן', 'מעדן שוקולד'], 'as_sold', [158, 3.3, 6.2, 22], 'il', { unit: 115, container: 115, serving: 115 }),
  F('butter', 'חמאה', 'Butter', '🧈', ['חמאה'], 'as_sold', [717, 0.9, 81, 0.1], 'usda', { tsp: 5, tbsp: 14, serving: 10 }),

  // ── Protein supplements ─────────────────────────────────────────────────
  F('whey', 'אבקת חלבון', 'Whey protein powder', '🥤', ['אבקת חלבון', 'חלבון', 'שייק חלבון', 'וויי'], 'as_sold', [380, 78, 5, 8], 'il', { scoop: 30, unit: 30, serving: 30 }),
  F('protein_bar', 'חטיף חלבון', 'Protein bar', '🍫', ['חטיף חלבון', 'חטיפי חלבון', 'פרוטאין בר'], 'as_sold', [355, 33, 11, 32], 'il', { unit: 60, serving: 60 }),

  // ── Poultry & meat ──────────────────────────────────────────────────────
  F('chicken_breast_cooked', 'חזה עוף (מבושל/צלוי)', 'Chicken breast, cooked, skinless', '🍗', ['חזה עוף', 'חזה', 'חזה עוף צלוי', 'חזה עוף בגריל', 'עוף'], 'cooked', [165, 31, 3.6, 0], 'usda', { unit: 150, serving: 150 }),
  F('chicken_breast_raw', 'חזה עוף (נא)', 'Chicken breast, raw, skinless', '🍗', ['חזה עוף נא', 'חזה עוף לא מבושל'], 'raw', [120, 22.5, 2.6, 0], 'usda', { unit: 200, serving: 200 }),
  F('chicken_thigh_cooked', 'פרגית', 'Chicken thigh, cooked, skinless', '🍗', ['פרגית', 'פרגיות', 'ירך עוף', 'שוק עוף', 'שוקיים'], 'cooked', [190, 25, 9.8, 0], 'usda', { unit: 100, serving: 150 }),
  F('schnitzel', 'שניצל', 'Chicken schnitzel, breaded & fried', '🍗', ['שניצל', 'שניצלים', 'שניצל עוף'], 'cooked', [260, 19, 14, 15], 'il', { unit: 130, serving: 130 }),
  F('shawarma', 'שווארמה (בשר)', 'Shawarma meat (chicken/turkey)', '🥙', ['שווארמה', 'שוורמה', 'שווארמה הודו', 'שווארמה עוף'], 'cooked', [230, 22, 15, 2], 'il', { serving: 150 }),
  F('ground_beef_raw', 'בשר טחון / המבורגר (משקל נא)', 'Ground beef 80/20, raw weight', '🍔', ['המבורגר', 'קציצת המבורגר', 'בשר טחון', 'טחון', 'המבורגרים'], 'raw', [254, 17.2, 20, 0], 'usda', { unit: 200, serving: 200 }),
  F('ground_beef_cooked', 'בשר טחון מבושל', 'Ground beef 80/20, cooked', '🥩', ['בשר טחון מבושל', 'טחון מטוגן'], 'cooked', [254, 25.8, 16.2, 0], 'usda', { serving: 120 }),
  F('steak', 'סטייק אנטריקוט', 'Beef ribeye/entrecote, cooked', '🥩', ['סטייק', 'אנטריקוט', 'סינטה', 'סטייקים'], 'cooked', [280, 25, 20, 0], 'usda', { unit: 250, serving: 250 }),
  F('kebab', 'קבב', 'Kebab (ground meat skewer)', '🍢', ['קבב', 'קבבים', 'קבב בשר'], 'cooked', [260, 18, 20, 3], 'il', { unit: 60, serving: 180 }),
  F('meatballs', 'קציצות ברוטב', 'Meatballs in tomato sauce', '🍝', ['קציצות', 'קציצה', 'קציצות ברוטב', 'קציצות בשר'], 'cooked', [195, 13, 13, 7], 'recipe', { unit: 50, serving: 200 }, ['tomato']),
  F('turkey_deli', 'פסטרמה הודו', 'Turkey breast deli slices', '🥓', ['פסטרמה', 'פסטרמה הודו', 'נקניק הודו', 'פרוסות הודו'], 'as_sold', [105, 18, 2, 3], 'il', { slice: 15, unit: 15, serving: 50 }),
  F('hot_dog', 'נקניקייה', 'Hot dog sausage', '🌭', ['נקניקייה', 'נקניקיה', 'נקניקיות', 'נקניקייה עוף'], 'as_sold', [250, 11, 21, 4], 'il', { unit: 50, serving: 100 }),

  // ── Fish ────────────────────────────────────────────────────────────────
  F('tuna_water', 'טונה במים', 'Tuna canned in water, drained', '🐟', ['טונה', 'טונה במים'], 'as_sold', [116, 25.5, 0.8, 0], 'usda', { can: 110, unit: 110, serving: 110 }),
  F('tuna_oil', 'טונה בשמן', 'Tuna canned in oil, drained', '🐟', ['טונה בשמן'], 'as_sold', [198, 29, 8.2, 0], 'usda', { can: 110, unit: 110, serving: 110 }),
  F('salmon_cooked', 'סלמון', 'Salmon, cooked', '🐟', ['סלמון', 'פילה סלמון'], 'cooked', [206, 22, 12.4, 0], 'usda', { unit: 180, serving: 180 }),
  F('white_fish_cooked', 'דג לבן (דניס/מוסר/אמנון)', 'White fish, cooked', '🐟', ['דג', 'דניס', 'לברק', 'מוסר', 'אמנון', 'פילה דג', 'פילה אמנון', 'בורי'], 'cooked', [128, 26, 2.7, 0], 'usda', { unit: 200, serving: 200 }),
  F('sushi', 'סושי', 'Sushi roll (maki)', '🍣', ['סושי', 'רול', 'רולים', 'אינסייד אאוט', 'מאקי'], 'as_sold', [145, 4.5, 3.8, 23], 'usda', { piece: 25, unit: 25, serving: 200 }),

  // ── Grains & starches ───────────────────────────────────────────────────
  F('rice_white_cooked', 'אורז לבן (מבושל)', 'White rice, cooked', '🍚', ['אורז', 'אורז לבן', 'אורז מבושל', 'אורז פרסי', 'אורז בסמטי'], 'cooked', [130, 2.7, 0.3, 28.2], 'usda', { cup: 160, tbsp: 15, serving: 180 }),
  F('rice_white_raw', 'אורז לבן (יבש)', 'White rice, raw/dry', '🍚', ['אורז יבש', 'אורז לא מבושל'], 'raw', [365, 7.1, 0.7, 80], 'usda', { cup: 185, serving: 75 }),
  F('rice_brown_cooked', 'אורז מלא (מבושל)', 'Brown rice, cooked', '🍚', ['אורז מלא'], 'cooked', [123, 2.7, 1, 25.6], 'usda', { cup: 195, tbsp: 15, serving: 180 }),
  F('pasta_cooked', 'פסטה (מבושלת)', 'Pasta, cooked', '🍝', ['פסטה', 'ספגטי', 'פנה', 'מקרוני', 'פוזילי', 'אטריות', 'נודלס'], 'cooked', [158, 5.8, 0.9, 30.9], 'usda', { cup: 140, serving: 220 }),
  F('pasta_dry', 'פסטה (יבשה)', 'Pasta, dry', '🍝', ['פסטה יבשה', 'פסטה לא מבושלת'], 'raw', [371, 13, 1.5, 75], 'usda', { serving: 80 }),
  // Recipe: 60% cooked pasta + 40% beef-tomato ragù
  F('pasta_bolognese', 'פסטה בולונז', 'Pasta bolognese', '🍝', ['פסטה בולונז', 'בולונז', 'ספגטי בולונז', 'פסטה ברוטב בשר'], 'cooked', [145, 7.5, 5, 18], 'recipe', { serving: 350 }, ['pasta_cooked', 'ground_beef_cooked', 'ground_beef_raw', 'meatballs']),
  F('pasta_cream', 'פסטה ברוטב שמנת', 'Pasta in cream sauce', '🍝', ['פסטה שמנת', 'פסטה ברוטב שמנת', 'פסטה רוזה', 'אלפרדו'], 'cooked', [190, 5.5, 9, 22], 'recipe', { serving: 350 }),
  F('couscous_cooked', 'קוסקוס (מבושל)', 'Couscous, cooked', '🍚', ['קוסקוס'], 'cooked', [112, 3.8, 0.2, 23.2], 'usda', { cup: 157, serving: 180 }),
  F('ptitim_cooked', 'פתיתים (מבושלים)', 'Israeli couscous (ptitim), cooked', '🍚', ['פתיתים'], 'cooked', [150, 5, 1.2, 30], 'il', { cup: 160, serving: 180 }),
  F('quinoa_cooked', 'קינואה (מבושלת)', 'Quinoa, cooked', '🍚', ['קינואה'], 'cooked', [120, 4.4, 1.9, 21.3], 'usda', { cup: 185, serving: 180 }),
  F('bulgur_cooked', 'בורגול (מבושל)', 'Bulgur, cooked', '🍚', ['בורגול', 'בורגל'], 'cooked', [83, 3.1, 0.2, 18.6], 'usda', { cup: 182, serving: 180 }),
  F('majadra', "מג'דרה", 'Majadra (rice & lentils)', '🍚', ["מג'דרה", 'מג׳דרה', 'מגדרה', 'מג׳דרה אורז'], 'cooked', [150, 5, 4, 24], 'recipe', { cup: 180, serving: 220 }, ['rice_white_cooked', 'lentils_cooked', 'onion']),
  F('oats', 'שיבולת שועל', 'Oats, dry', '🥣', ['שיבולת שועל', 'קוואקר', 'פתיתי שיבולת שועל', 'דייסה', 'דייסת שיבולת שועל'], 'raw', [379, 13.2, 6.5, 67.7], 'usda', { cup: 80, tbsp: 10, serving: 50 }),
  F('granola', 'גרנולה', 'Granola', '🥣', ['גרנולה'], 'as_sold', [471, 10, 20, 64], 'usda', { cup: 110, tbsp: 12, serving: 50 }),
  F('cornflakes', 'קורנפלקס', 'Corn flakes', '🥣', ['קורנפלקס', 'דגני בוקר', 'כריות'], 'as_sold', [357, 7.5, 0.4, 84], 'usda', { cup: 30, serving: 40 }),
  F('potato_boiled', 'תפוח אדמה (מבושל/אפוי)', 'Potato, boiled/baked', '🥔', ['תפוח אדמה', 'תפוחי אדמה', 'תפו"א', 'תפוא', 'פירה'], 'cooked', [87, 1.9, 0.1, 20.1], 'usda', { unit: 170, serving: 200 }),
  F('sweet_potato', 'בטטה', 'Sweet potato, baked', '🍠', ['בטטה', 'בטטות'], 'cooked', [90, 2, 0.2, 20.7], 'usda', { unit: 150, serving: 150 }),
  F('fries', "צ'יפס", 'French fries', '🍟', ["צ'יפס", 'ציפס', 'צ׳יפס', 'צ\'יפסים'], 'cooked', [312, 3.4, 15, 41], 'usda', { serving: 150 }),
  F('corn', 'תירס', 'Sweet corn', '🌽', ['תירס'], 'cooked', [96, 3.4, 1.5, 21], 'usda', { unit: 100, cup: 150, serving: 100 }),

  // ── Legumes & plant protein ─────────────────────────────────────────────
  F('hummus', 'חומוס (ממרח)', 'Hummus, Israeli-style', '🫘', ['חומוס', 'חומוס ממרח'], 'as_sold', [200, 8, 13, 14], 'il', { tbsp: 30, serving: 100 }),
  F('chickpeas_cooked', 'גרגרי חומוס (מבושלים)', 'Chickpeas, cooked', '🫘', ['גרגרי חומוס', 'חומוס מבושל', 'חומוס גרגרים'], 'cooked', [164, 8.9, 2.6, 27.4], 'usda', { cup: 165, serving: 100 }),
  F('lentils_cooked', 'עדשים (מבושלות)', 'Lentils, cooked', '🫘', ['עדשים', 'עדשים מבושלות', 'מרק עדשים'], 'cooked', [116, 9, 0.4, 20], 'usda', { cup: 198, serving: 150 }),
  F('beans_cooked', 'שעועית (מבושלת)', 'Beans, cooked', '🫘', ['שעועית', 'שעועית לבנה', 'שעועית אדומה', 'שעועית שחורה'], 'cooked', [127, 8.7, 0.5, 22.8], 'usda', { cup: 177, serving: 150 }),
  F('falafel', 'פלאפל', 'Falafel ball', '🧆', ['פלאפל'], 'cooked', [333, 13.3, 17.8, 31.8], 'usda', { unit: 17, piece: 17, serving: 85 }),
  F('tofu', 'טופו', 'Tofu, firm', '🧊', ['טופו'], 'as_sold', [144, 17.3, 8.7, 2.8], 'usda', { serving: 150 }),
  F('edamame', 'אדממה', 'Edamame', '🫛', ['אדממה'], 'cooked', [121, 11.9, 5.2, 8.9], 'usda', { cup: 155, serving: 100 }),

  // ── Fats, spreads & sauces ──────────────────────────────────────────────
  F('olive_oil', 'שמן זית', 'Olive oil', '🫒', ['שמן זית', 'שמן', 'שמן קנולה', 'שמן צמחי'], 'as_sold', [884, 0, 100, 0], 'usda', { tbsp: 13.5, tsp: 4.5, serving: 13.5 }),
  F('tahini_raw', 'טחינה גולמית', 'Tahini, raw paste', '🥣', ['טחינה גולמית', 'טחינה משומשום'], 'as_sold', [595, 17, 54, 21], 'usda', { tbsp: 15, tsp: 5, serving: 15 }),
  // Recipe: raw tahini diluted ~1:1 with water and lemon
  F('tahini', 'טחינה (מוכנה)', 'Tahini sauce, prepared', '🥣', ['טחינה', 'טחינה מוכנה', 'רוטב טחינה'], 'as_sold', [300, 8.5, 27, 10.5], 'recipe', { tbsp: 15, tsp: 5, serving: 30 }),
  F('peanut_butter', 'חמאת בוטנים', 'Peanut butter', '🥜', ['חמאת בוטנים', 'ממרח בוטנים'], 'as_sold', [588, 25, 50, 20], 'usda', { tbsp: 16, tsp: 5, serving: 16 }),
  F('chocolate_spread', 'ממרח שוקולד', 'Chocolate hazelnut spread', '🍫', ['ממרח שוקולד', 'נוטלה', 'השחר'], 'as_sold', [539, 6.3, 30.9, 57.5], 'usda', { tbsp: 20, tsp: 7, serving: 20 }),
  F('mayonnaise', 'מיונז', 'Mayonnaise', '🥣', ['מיונז', 'מיונית'], 'as_sold', [680, 1, 75, 0.6], 'usda', { tbsp: 14, tsp: 5, serving: 14 }),
  F('ketchup', "קטשופ", 'Ketchup', '🍅', ['קטשופ', 'קטשופ'], 'as_sold', [101, 1, 0.1, 27], 'usda', { tbsp: 17, tsp: 6, serving: 17 }),
  F('pesto', 'פסטו', 'Pesto', '🌿', ['פסטו'], 'as_sold', [460, 5, 47, 6], 'usda', { tbsp: 15, serving: 15 }),
  F('avocado', 'אבוקדו', 'Avocado', '🥑', ['אבוקדו', 'גוואקמולי'], 'as_sold', [160, 2, 14.7, 8.5], 'usda', { unit: 150, tbsp: 15, serving: 70 }),
  F('honey', 'דבש', 'Honey', '🍯', ['דבש', 'סילאן'], 'as_sold', [304, 0.3, 0, 82], 'usda', { tsp: 7, tbsp: 21, serving: 7 }),
  F('sugar', 'סוכר', 'Sugar', '🍬', ['סוכר'], 'as_sold', [387, 0, 0, 100], 'usda', { tsp: 4, tbsp: 12, serving: 4 }),
  F('jam', 'ריבה', 'Jam', '🍓', ['ריבה', 'קונפיטורה'], 'as_sold', [250, 0.4, 0.1, 64], 'usda', { tsp: 7, tbsp: 20, serving: 20 }),

  // ── Nuts & seeds ────────────────────────────────────────────────────────
  F('almonds', 'שקדים', 'Almonds', '🌰', ['שקדים', 'שקד'], 'as_sold', [579, 21, 50, 21.6], 'usda', { handful: 28, unit: 1.2, serving: 28 }),
  F('walnuts', 'אגוזי מלך', 'Walnuts', '🌰', ['אגוזי מלך', 'אגוז מלך', 'אגוזים'], 'as_sold', [654, 15.2, 65.2, 13.7], 'usda', { handful: 28, serving: 28 }),
  F('peanuts', 'בוטנים', 'Peanuts, roasted', '🥜', ['בוטנים', 'בוטן'], 'as_sold', [585, 23.7, 49.7, 21.5], 'usda', { handful: 30, serving: 30 }),
  F('cashew', 'קשיו', 'Cashews', '🌰', ['קשיו', 'אגוזי קשיו'], 'as_sold', [553, 18, 44, 30], 'usda', { handful: 28, serving: 28 }),
  F('mixed_nuts', 'אגוזים מעורבים', 'Mixed nuts', '🌰', ['אגוזים מעורבים', 'פיצוחים', 'מיקס אגוזים'], 'as_sold', [607, 20, 54, 21], 'usda', { handful: 30, serving: 30 }),
  F('seeds', 'גרעינים', 'Sunflower seeds, kernels', '🌻', ['גרעינים', 'גרעיני חמנייה', 'גרעינים לבנים'], 'as_sold', [584, 20.8, 51.5, 20], 'usda', { handful: 30, serving: 30 }),

  // ── Vegetables ──────────────────────────────────────────────────────────
  F('salad_veg', 'סלט ירקות (ללא שמן)', 'Israeli chopped salad, no dressing', '🥗', ['סלט', 'סלט ירקות', 'סלט ישראלי', 'סלט קצוץ', 'ירקות'], 'as_sold', [20, 0.8, 0.2, 3.9], 'recipe', { cup: 150, serving: 150 }),
  F('cucumber', 'מלפפון', 'Cucumber', '🥒', ['מלפפון', 'מלפפונים'], 'as_sold', [15, 0.7, 0.1, 3.6], 'usda', { unit: 120, serving: 120 }),
  F('tomato', 'עגבנייה', 'Tomato', '🍅', ['עגבנייה', 'עגבניה', 'עגבניות', 'עגבניות שרי', 'שרי'], 'as_sold', [18, 0.9, 0.2, 3.9], 'usda', { unit: 120, serving: 120 }),
  F('pepper', 'פלפל', 'Bell pepper', '🫑', ['פלפל', 'פלפלים', 'גמבה'], 'as_sold', [26, 1, 0.3, 6], 'usda', { unit: 150, serving: 150 }),
  F('carrot', 'גזר', 'Carrot', '🥕', ['גזר', 'גזרים'], 'as_sold', [41, 0.9, 0.2, 9.6], 'usda', { unit: 70, serving: 70 }),
  F('broccoli', 'ברוקולי', 'Broccoli, cooked', '🥦', ['ברוקולי', 'כרובית'], 'cooked', [35, 2.4, 0.4, 7.2], 'usda', { cup: 156, serving: 150 }),
  F('onion', 'בצל', 'Onion', '🧅', ['בצל', 'בצלים', 'בצל מטוגן'], 'as_sold', [40, 1.1, 0.1, 9.3], 'usda', { unit: 110, serving: 50 }),
  F('mushrooms', 'פטריות', 'Mushrooms, cooked', '🍄', ['פטריות', 'פטרייה'], 'cooked', [28, 2.2, 0.5, 5.3], 'usda', { cup: 156, serving: 100 }),
  F('veg_soup', 'מרק ירקות', 'Vegetable soup', '🍲', ['מרק', 'מרק ירקות', 'מרק עוף'], 'as_sold', [35, 1.5, 1, 5], 'usda', { cup: 250, serving: 300 }),

  // ── Fruit ───────────────────────────────────────────────────────────────
  F('banana', 'בננה', 'Banana', '🍌', ['בננה', 'בננות'], 'as_sold', [89, 1.1, 0.3, 22.8], 'usda', { unit: 118, serving: 118 }),
  F('apple', 'תפוח', 'Apple', '🍎', ['תפוח', 'תפוחים', 'תפוח עץ'], 'as_sold', [52, 0.3, 0.2, 13.8], 'usda', { unit: 180, serving: 180 }),
  F('orange', 'תפוז', 'Orange', '🍊', ['תפוז', 'תפוזים', 'קלמנטינה', 'קלמנטינות', 'מנדרינה'], 'as_sold', [47, 0.9, 0.1, 11.8], 'usda', { unit: 140, serving: 140 }),
  F('dates', 'תמרים', 'Dates, Medjool', '🌴', ['תמר', 'תמרים', 'מג\'הול'], 'as_sold', [277, 1.8, 0.2, 75], 'usda', { unit: 24, serving: 48 }),
  F('grapes', 'ענבים', 'Grapes', '🍇', ['ענבים', 'ענב'], 'as_sold', [69, 0.7, 0.2, 18.1], 'usda', { cup: 150, serving: 150 }),
  F('watermelon', 'אבטיח', 'Watermelon', '🍉', ['אבטיח', 'מלון'], 'as_sold', [30, 0.6, 0.2, 7.6], 'usda', { slice: 280, cup: 150, serving: 300 }),
  F('strawberries', 'תותים', 'Strawberries', '🍓', ['תותים', 'תות', 'פירות יער'], 'as_sold', [32, 0.7, 0.3, 7.7], 'usda', { cup: 150, serving: 150 }),
  F('mango', 'מנגו', 'Mango', '🥭', ['מנגו'], 'as_sold', [60, 0.8, 0.4, 15], 'usda', { unit: 200, serving: 200 }),
  F('fruit', 'פרי', 'Fruit, mixed', '🍑', ['פרי', 'פירות', 'אפרסק', 'נקטרינה', 'אגס', 'שזיף', 'קיווי'], 'as_sold', [50, 0.8, 0.3, 12], 'usda', { unit: 150, serving: 150 }),

  // ── Sweets & snacks ─────────────────────────────────────────────────────
  F('bamba', 'במבה', 'Bamba peanut snack', '🥜', ['במבה'], 'as_sold', [534, 15, 33, 40], 'il', { bag: 25, unit: 25, serving: 25 }),
  F('bissli', 'ביסלי', 'Bissli snack', '🥨', ['ביסלי'], 'as_sold', [490, 9, 22, 63], 'il', { bag: 70, unit: 70, serving: 35 }),
  F('chips', "צ'יפס שקית", 'Potato chips', '🥔', ['תפוצ\'יפס', 'תפוציפס', 'חטיף תפוח אדמה'], 'as_sold', [536, 7, 34.6, 52.9], 'usda', { bag: 50, serving: 30 }),
  F('dark_chocolate', 'שוקולד מריר', 'Dark chocolate 70%', '🍫', ['שוקולד מריר', 'מריר'], 'as_sold', [598, 7.8, 42.6, 45.9], 'usda', { piece: 5, unit: 5, serving: 20 }),
  F('milk_chocolate', 'שוקולד חלב', 'Milk chocolate', '🍫', ['שוקולד', 'שוקולד חלב', 'טבלת שוקולד'], 'as_sold', [535, 7.7, 29.7, 59.4], 'usda', { piece: 5, unit: 5, serving: 25 }),
  F('ice_cream', 'גלידה', 'Ice cream', '🍨', ['גלידה', 'ארטיק'], 'as_sold', [207, 3.5, 11, 23.6], 'usda', { unit: 70, scoop: 70, serving: 140 }),
  F('cookies', 'עוגיות', 'Cookies', '🍪', ['עוגייה', 'עוגיה', 'עוגיות', 'ביסקוויט', 'ביסקוויטים'], 'as_sold', [480, 6, 22, 65], 'usda', { unit: 15, serving: 45 }),
  F('cake', 'עוגה', 'Cake', '🍰', ['עוגה', 'עוגת שמרים', 'עוגת שוקולד', 'רוגלך', 'עוגת גבינה'], 'as_sold', [370, 5, 17, 50], 'usda', { slice: 80, unit: 80, serving: 80 }),
  F('sufganiya', 'סופגנייה', 'Jelly doughnut', '🍩', ['סופגנייה', 'סופגניה', 'סופגניות', 'דונאט'], 'as_sold', [370, 6, 18, 46], 'il', { unit: 90, serving: 90 }),

  // ── Drinks ──────────────────────────────────────────────────────────────
  // Recipe: 250 ml cup, ~180 ml 3% milk + espresso
  F('cafe_hafuch', 'קפה הפוך', 'Latte / café hafuch', '☕', ['הפוך', 'קפה הפוך', 'קפה', 'לאטה', 'קפוצ\'ינו', 'קפה עם חלב'], 'as_sold', [48, 2.6, 2.4, 3.6], 'recipe', { cup: 250, unit: 250, serving: 250 }, ['milk_3', 'milk_1']),
  F('cola', 'קולה', 'Cola / soft drink', '🥤', ['קולה', 'קוקה קולה', 'ספרייט', 'פאנטה', 'משקה מוגז', 'שתייה מתוקה'], 'as_sold', [42, 0, 0, 10.6], 'usda', { can: 330, cup: 240, serving: 330 }),
  F('orange_juice', 'מיץ תפוזים', 'Orange juice', '🧃', ['מיץ', 'מיץ תפוזים', 'מיץ טבעי'], 'as_sold', [45, 0.7, 0.2, 10.4], 'usda', { cup: 240, serving: 240 }),
  F('beer', 'בירה', 'Beer', '🍺', ['בירה', 'בירות'], 'as_sold', [43, 0.5, 0, 3.6], 'usda', { can: 330, cup: 330, serving: 500 }),
  F('wine', 'יין', 'Wine', '🍷', ['יין', 'יין אדום', 'יין לבן'], 'as_sold', [83, 0.1, 0, 2.6], 'usda', { cup: 150, serving: 150 }),
]

export const FOOD_BY_KEY: Record<string, FoodRef> = Object.fromEntries(FOODS.map((f) => [f.key, f]))

/** Compact catalogue passed to the AI so it can map items to our keys. */
export function foodCatalogForPrompt(): string {
  return FOODS.map((f) => `${f.key} | ${f.en} | ${f.he} | ${f.state}`).join('\n')
}
