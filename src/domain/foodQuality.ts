/**
 * Is a logged food something worth SUGGESTING? Deterministic and conservative:
 * a food is eligible only when it is positively recognised as nutritious; sweets, salty
 * snacks, sugary drinks, alcohol, fast food, deep-fried and refined bakery, condiments
 * and anything not recognised are excluded. Nothing here changes stored food data.
 *
 * Order of evidence:
 *  1. Name says junk (sweets / snacks / sugary drinks / alcohol / fast food / pastry) → excluded,
 *     whatever else the item says (catches "וופל" mapped to a cookie, "עוגת גבינה", …).
 *  2. The in-app food table key (db_key / ref "cur:…") → its explicit class below.
 *  3. Other sources (MoH, USDA, packaged products, AI): nutrient red flags (very sugary,
 *     energy-dense with little protein) → excluded; then a recognised nutritious name → eligible.
 *  4. Otherwise "unknown" → excluded (never assumed healthy).
 *
 * quality (0–1) feeds the ranking: lean protein > legumes / vegetables > dairy > whole grains /
 * fruit > nuts > richer home dishes.
 */
import type { FoodItem } from '../data/types'

export type FoodClass =
  // eligible
  | 'protein' | 'dairy' | 'legume' | 'vegetable' | 'fruit' | 'grain' | 'nuts' | 'meal'
  // excluded
  | 'sweets' | 'snack' | 'sugary_drink' | 'drink' | 'alcohol' | 'fast_food' | 'fried' | 'pastry' | 'refined_bread' | 'condiment' | 'unknown'

export const ELIGIBLE: ReadonlySet<FoodClass> = new Set(['protein', 'dairy', 'legume', 'vegetable', 'fruit', 'grain', 'nuts', 'meal'])

const BASE_QUALITY: Record<string, number> = { protein: 1, legume: 0.95, vegetable: 0.9, dairy: 0.9, grain: 0.75, fruit: 0.8, nuts: 0.7, meal: 0.75 }

/** Every food of the in-app table, by key: [class, quality override?] */
const CURATED: Record<string, [FoodClass, number?]> = {
  // eggs
  egg: ['protein'], egg_white: ['protein'], egg_fried_no_oil: ['protein'], egg_fried: ['protein', 0.85], omelet: ['protein', 0.85],
  shakshuka: ['meal', 0.85], shakshuka_no_oil: ['meal', 0.9],
  // bread & bakery
  bread_whole: ['grain', 0.75], bread_light: ['grain', 0.75], pita_whole: ['grain', 0.7],
  bread_white: ['refined_bread'], pita: ['refined_bread'], laffa: ['refined_bread'], tortilla: ['refined_bread'], roll: ['refined_bread'],
  baguette: ['refined_bread'], challah: ['refined_bread'], bagel: ['refined_bread'],
  croissant: ['pastry'], burekas: ['pastry'], burekas_potato: ['pastry'], malawach: ['pastry'], jachnun: ['pastry'], rugelach: ['pastry'],
  rice_cake: ['snack'], crackers: ['snack'],
  // street / fast food
  toast_cheese: ['fast_food'], pizza: ['fast_food'], sabich: ['fast_food'], falafel_pita: ['fast_food'], shawarma_pita: ['fast_food'],
  hot_dog: ['fast_food'], schnitzel_frozen: ['fast_food'],
  hummus_plate: ['meal', 0.6], cholent: ['meal', 0.6],
  // dairy
  cottage_5: ['dairy'], cottage_3: ['dairy'], cottage_1: ['dairy'], white_cheese_5: ['dairy'], white_cheese_3: ['dairy'],
  labane: ['dairy', 0.85], labane_9: ['dairy', 0.75], yellow_cheese_light: ['dairy', 0.8], yellow_cheese_28: ['dairy', 0.6],
  feta: ['dairy'], feta_full: ['dairy', 0.7], tsfatit: ['dairy', 0.8], mozzarella: ['dairy', 0.7], cream_cheese_5: ['dairy', 0.8],
  yogurt_plain: ['dairy'], yogurt_greek: ['dairy'], protein_yogurt: ['dairy'], yoplait_go: ['dairy'], milk_3: ['dairy', 0.8], milk_1: ['dairy', 0.8],
  parmesan: ['condiment'], cream_cheese: ['condiment'], cooking_cream: ['condiment'], sour_cream: ['condiment'], butter: ['condiment'],
  chocolate_milk: ['sugary_drink'], milky: ['sweets'],
  whey: ['protein', 0.8], protein_bar: ['snack'],
  // meat & fish
  chicken_breast_cooked: ['protein'], chicken_breast_raw: ['protein'], chicken_thigh_cooked: ['protein', 0.9], chicken_drumstick: ['protein', 0.85],
  turkey_breast_cooked: ['protein'], sinta: ['protein', 0.9], steak: ['protein', 0.75], ground_beef_raw: ['protein', 0.75], ground_beef_cooked: ['protein', 0.75],
  kebab: ['protein', 0.75], shawarma: ['protein', 0.75], meatballs: ['meal', 0.8], turkey_deli: ['protein', 0.6],
  tuna_water: ['protein'], tuna_oil: ['protein', 0.85], salmon_cooked: ['protein'], white_fish_cooked: ['protein'], sushi: ['meal', 0.6],
  schnitzel: ['fried'], falafel: ['fried'], fries: ['fried'], eggplant_fried: ['fried'],
  // grains, potatoes
  rice_white_cooked: ['grain', 0.65], rice_home: ['grain', 0.6], rice_white_raw: ['grain', 0.65], rice_brown_cooked: ['grain', 0.8],
  pasta_cooked: ['grain', 0.65], pasta_dry: ['grain', 0.65], pasta_bolognese: ['meal', 0.7], pasta_cream: ['meal', 0.5],
  couscous_cooked: ['grain', 0.65], couscous_home: ['grain', 0.6], couscous_dry: ['grain', 0.65],
  ptitim_cooked: ['grain', 0.6], ptitim_home: ['grain', 0.55], ptitim_dry: ['grain', 0.6],
  quinoa_cooked: ['grain', 0.85], bulgur_cooked: ['grain', 0.85], majadra: ['meal', 0.75], oats: ['grain', 0.9], oatmeal: ['grain', 0.9],
  granola: ['snack'], cornflakes: ['snack'],
  potato_boiled: ['grain', 0.75], potato_roasted: ['grain', 0.65], mashed_potato: ['grain', 0.6], sweet_potato: ['grain', 0.85], corn: ['vegetable', 0.75],
  // legumes, plant protein
  hummus: ['legume', 0.7], chickpeas_cooked: ['legume'], lentils_cooked: ['legume'], beans_cooked: ['legume'], beans_tomato: ['legume', 0.85],
  tofu: ['protein', 0.95], edamame: ['legume'],
  // fats, spreads, sauces, sugar
  olive_oil: ['condiment'], oil: ['condiment'], tahini_raw: ['condiment'], tahini: ['condiment'], mayonnaise: ['condiment'], mayonnaise_light: ['condiment'],
  ketchup: ['condiment'], pesto: ['condiment'], amba: ['condiment'], schug: ['condiment'], matbucha: ['condiment'],
  honey: ['condiment'], silan: ['condiment'], sugar: ['condiment'], jam: ['condiment'], coleslaw: ['condiment'],
  chocolate_spread: ['sweets'], nutella: ['sweets'], halva: ['sweets'],
  avocado: ['vegetable', 0.85],
  // nuts & seeds
  almonds: ['nuts'], walnuts: ['nuts'], peanuts: ['nuts', 0.65], cashew: ['nuts'], pistachio: ['nuts'], mixed_nuts: ['nuts'],
  seeds: ['nuts'], seeds_shell: ['nuts', 0.6], peanut_butter: ['nuts', 0.6],
  // vegetables, soups
  salad_veg: ['vegetable'], salad_oil: ['vegetable', 0.85], cucumber: ['vegetable'], tomato: ['vegetable'], pepper: ['vegetable'], carrot: ['vegetable'],
  lettuce: ['vegetable'], broccoli: ['vegetable'], cauliflower: ['vegetable'], zucchini: ['vegetable'], cabbage: ['vegetable'], onion: ['vegetable', 0.6],
  mushrooms: ['vegetable'], veg_soup: ['vegetable', 0.85], chicken_soup: ['meal', 0.85],
  // fruit
  banana: ['fruit'], apple: ['fruit'], orange: ['fruit'], clementine: ['fruit'], dates: ['fruit', 0.6], grapes: ['fruit', 0.7], watermelon: ['fruit'],
  melon: ['fruit'], strawberries: ['fruit'], mango: ['fruit'], peach: ['fruit'], pear: ['fruit'], plum: ['fruit'], kiwi: ['fruit'],
  persimmon: ['fruit'], pomegranate: ['fruit'], berries: ['fruit'], fruit: ['fruit'],
  // snacks & sweets
  bamba: ['snack'], bissli: ['snack'], chips: ['snack'], pretzels: ['snack'], popcorn: ['snack'],
  dark_chocolate: ['sweets'], milk_chocolate: ['sweets'], ice_cream: ['sweets'], popsicle: ['sweets'], cookies: ['sweets'], biscuits: ['sweets'],
  wafers: ['sweets'], krembo: ['sweets'], cake: ['sweets'], cheesecake: ['sweets'], sufganiya: ['sweets'],
  // drinks
  cafe_hafuch: ['drink'], black_coffee: ['drink'], cola_zero: ['drink'], cola: ['sugary_drink'], orange_juice: ['sugary_drink'], tea_sugar: ['sugary_drink'],
  beer: ['alcohol'], wine: ['alcohol'],
}
export const CURATED_CLASSES: Readonly<Record<string, [FoodClass, number?]>> = CURATED

// ── names (Hebrew + English) ────────────────────────────────────────────────

const JUNK_NAME: [RegExp, FoodClass][] = [
  [/שוקול|ממתק|סוכרי|עוג(ה|ת|י|ות)|וופל|ופלים|קרמבו|גלידה|ארטיק|שלגון|ריבה|נוטלה|חלבה|מרשמלו|סופגני|דונאט|רוגלך|בראוני|מאפין|פחזני|טופי|מסטיק|קינוח|פודינג|מלבי|בקלאווה|כנאפה|קרם ברולה|טירמיסו|חטיף שוקולד|ממרח (שוקולד|לוטוס)|גומי|ג'לי|לקריץ|candy|gumm|jelly bean|licorice|chocolate|cookie|cake|brownie|muffin|donut|doughnut|wafer|ice cream|dessert|pudding|marshmallow|caramel|nutella/i, 'sweets'],
  [/צ'?יפס|ציפס|תפוצ|במבה|ביסלי|דוריטוס|צ'?יטוס|פופקורן|בייגלה|קרקר|פריכי|חטיף|גרנולה|קורנפלקס|nachos|granola|cornflakes|chips|crisps|popcorn|pretzel|doritos|cheetos|snack bar|cracker/i, 'snack'],
  [/(^|\s)קולה(?!\s*(זירו|דיאט))|ספרייט|פאנטה|לימונד|מיץ|נקטר|משקה אנרגיה|משקה ממותק|משקה מוגז|רד בול|סירופ|פטל|(^|\s)שוקו(\s|$)|אייס קפה|תה קר|פראפה|ברד|מילקשייק|שייק|סמוטי|soda|soft drink|energy drink|red bull|lemonade|juice|syrup|milkshake|frappe|slushy|smoothie|iced tea/i, 'sugary_drink'],
  [/בירה|(^|\s)יין|וודקה|ויסקי|(^|\s)ג'?ין(\s|$)|(^|\s)ערק|טקילה|(^|\s)רום(\s|$)|קוקטייל|ליקר|שמפניה|beer|wine|vodka|whisk|(^|\s)gin(\s|$)|tequila|cocktail|liqueur|champagne/i, 'alcohol'],
  [/פיצה|המבורגר|בורגר|נקניק|נאגטס|שניצלונים|מקדונלד|בורגראנץ'|שווארמה בפיתה|פלאפל|שניצל|burger|pizza|nuggets|hot dog|sausage|french fries|\bkfc\b|schnitzel|falafel/i, 'fast_food'],
  [/בורקס|קרואסון|מלוואח|ג'?חנון|מאפה|פירורי לחם|בצק עלים|croissant|pastry|puff|danish|breadcrumbs/i, 'pastry'],
]

/** protein-rich dairy may be flavoured ("יוגורט חלבון בטעם שוקולד") — not a dessert when it is really protein */
const PROTEIN_DAIRY = /יוגורט|סקייר|skyr|משקה חלבון|שייק חלבון|protein shake|מעדן חלבון|פודינג חלבון|protein (yog|drink|pudding)|\bpro\b|קוטג/i

const CONDIMENT_NAME = /^(מי )?(סוכר|דבש|סילאן|שמן|חמאה(?!\s*בוטנים)|מיונז|קטשופ|רוטב|פסטו|טחינה|עמבה|סחוג|מטבוחה|שמנת|ממרח|חרדל|ויניגרט|(גבינת )?פרמזן)|^(sugar|honey|syrup|oil|olive oil|butter|mayo|mayonnaise|ketchup|sauce|dressing|pesto|cream|mustard|parmesan)\b/i
const FRIED_NAME = /מטוגן|בטיגון|טיגון עמוק|deep[- ]fried|fried/i
const EGG_NAME = /ביצ|חביתה|\beggs?\b|omelet/i
const REFINED_BREAD_NAME = /לחם לבן|באגט|ג'?בטה|לחמני|(^|\s)חלה(\s|$)|לאפה|טורטי|בייגל|white bread|baguette|ciabatta|tortilla|bagel|(^|\s)פית(ה|ות)(?!.*מלא)|(^|\s)pita(?!.*whole)/i

const GOOD_NAME: [RegExp, FoodClass][] = [
  [/חזה|עוף|פרגית|הודו|בקר|סינטה|סטייק|אנטריקוט|פילה|כבד|(^|\s)דג|סלמון|טונה|אמנון|דניס|לברק|בורי|מושט|קוד|שרימפ|סרדין|ביצ|חביתה|טופו|סייטן|chicken|turkey|beef|steak|fillet|fish|salmon|tuna|(^|\s)cod(\s|$)|shrimp|sardine|\beggs?\b|omelet|tofu|seitan|whey|אבקת חלבון/i, 'protein'],
  [/קוטג|גבינה לבנה|גבינה בולגרית|(^|\s)לבנה|יוגורט|סקייר|קוורק|קפיר|(^|\s)חלב(\s|$)|ריקוטה|גבינת עזים|גבינה צהובה|מוצרלה|צפתית|פטה|cottage|greek yog|yog(h)?urt|skyr|quark|kefir|ricotta|mozzarella|feta|(^|\s)milk(\s|$)|משקה חלבון/i, 'dairy'],
  [/עדשים|גרגרי חומוס|(^|\s)חומוס|שעועית|אפונה|אדממה|(^|\s)פול(\s|$)|לוביה|lentil|bean|chickpea|hummus|(^|\s)peas?(\s|$)|edamame/i, 'legume'],
  [/סלט|ירקות|מלפפון|עגבני|פלפל|גזר|חסה|ברוקולי|כרובית|קישוא|חציל|כרוב|פטרי|תרד|בצל|סלק|דלעת|אבוקדו|שעועית ירוקה|salad|vegetable|broccoli|cauliflower|spinach|cucumber|tomato|carrot|zucchini|mushroom|avocado|kale|lettuce/i, 'vegetable'],
  [/תפוח(?! אדמה)|תפוחים|בננה|תפוז|קלמנטינ|אשכולית|אגס|שזיף|אפרסק|נקטרינ|ענבים|אבטיח|מלון|תות|מנגו|קיווי|אפרסמון|רימון|פירות|(^|\s)פרי|דובדבנ|משמש|תאנ|תמר|apple|banana|orange|pear|plum|peach|grape|melon|berr|mango|kiwi|fruit|cherr|apricot|fig/i, 'fruit'],
  [/אורז|קינואה|בורגול|כוסמת|שיבולת|דייס|קוסקוס|פתיתים|פסטה|ספגטי|נודלס|בטטה|תפוח(י)? אדמה|לחם מלא|לחם קל|כוסמין|rice|quinoa|bulgur|buckwheat|oat|couscous|pasta|spaghetti|noodle|potato|wholemeal|whole wheat/i, 'grain'],
  [/שקד|אגוז|קשיו|פיסטוק|בוטנים|גרעינ|זרעי|almond|walnut|(^|\s)nuts?(\s|$)|cashew|pistachio|peanuts|seeds/i, 'nuts'],
  [/מרק|קציצ|תבשיל|מג'?דרה|שקשוקה|soup|stew|meatball/i, 'meal'],
]

export interface FoodQuality {
  cls: FoodClass
  eligible: boolean
  /** 0–1 nutritional quality (0 when not eligible) */
  quality: number
  /** which rule decided — for tests and debugging */
  by: 'name' | 'table' | 'nutrients' | 'unknown'
}

const curatedKey = (i: FoodItem): string | null => {
  if (i.db_key) return i.db_key
  if (i.ref?.startsWith('cur:')) return i.ref.slice(4)
  return null
}

export function classifyFood(item: Pick<FoodItem, 'name' | 'db_key' | 'ref' | 'per100'> & { ref_name?: string; brand?: string }): FoodQuality {
  const text = [item.name, item.ref_name, item.brand].filter(Boolean).join(' ').normalize('NFKC')
  const p = item.per100
  const no = (cls: FoodClass, by: FoodQuality['by']): FoodQuality => ({ cls, eligible: false, quality: 0, by })
  const yes = (cls: FoodClass, by: FoodQuality['by'], q?: number): FoodQuality => ({ cls, eligible: true, quality: q ?? BASE_QUALITY[cls] ?? 0.6, by })

  // 1. junk by name, always (a protein-dense dairy is not a dessert because of its flavour)
  const proteinDairy = PROTEIN_DAIRY.test(text) && (p?.protein_g ?? 0) >= 7 && (p?.sugar_g == null || p.sugar_g <= 10)
  for (const [re, cls] of JUNK_NAME) {
    if (cls === 'sweets' && proteinDairy) continue
    if (cls === 'sugary_drink' && proteinDairy) continue
    if (re.test(text)) return no(cls, 'name')
  }

  // 2. the in-app table's explicit class
  const key = curatedKey(item as FoodItem)
  const known = key ? CURATED[key] : undefined
  if (known) {
    const [cls, q] = known
    return ELIGIBLE.has(cls) ? yes(cls, 'table', q) : no(cls, 'table')
  }

  // 3. everything else: names that are never a suggestion, then nutrient red flags
  if (CONDIMENT_NAME.test(text)) return no('condiment', 'name')
  if (REFINED_BREAD_NAME.test(text)) return no('refined_bread', 'name')
  if (FRIED_NAME.test(text) && !EGG_NAME.test(text)) return no('fried', 'name')
  if (p) {
    const kcal = Math.max(1, p.kcal)
    const proteinShare = (p.protein_g * 4) / kcal
    const isFruit = GOOD_NAME.find(([, c]) => c === 'fruit')![0].test(text)
    const isNuts = GOOD_NAME.find(([, c]) => c === 'nuts')![0].test(text)
    // dry whole grains are energy-dense too (oats ≈ 380 kcal) — not a snack unless sugary
    const isPlainGrain = GOOD_NAME.find(([, c]) => c === 'grain')![0].test(text) && (p.sugar_g == null || p.sugar_g < 15)
    if (p.sugar_g != null && p.sugar_g >= 22 && p.protein_g < 8 && !isFruit) return no('sweets', 'nutrients')
    if (p.kcal >= 400 && proteinShare < 0.15 && !isNuts && !isPlainGrain) return no('snack', 'nutrients')
    // almost pure fat or sugar (oils, sauces, syrups) without a name we recognise
    if (p.fat_g >= 70 || (p.carbs_g >= 85 && p.protein_g < 3)) return no('condiment', 'nutrients')
  }
  for (const [re, cls] of GOOD_NAME) if (re.test(text)) return yes(cls, 'name', cls === 'meal' ? 0.7 : undefined)

  // 4. not recognised → not suggested
  return no('unknown', 'unknown')
}
