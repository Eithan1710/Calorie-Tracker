"""
Builds the full food database (mz_foods rows) from the open datasets.

  python3 scripts/foods/build.py <data-dir> <out.ndjson> [report.md]

Sources (see docs/food-data/README.md for licences and links):
  curated   the in-app core table (supabase/functions/_shared/foodDb.generated.ts)
  moh       Israeli Ministry of Health national nutrition DB (Tzameret)
  usda      USDA FoodData Central — Foundation + SR Legacy
  off       Open Food Facts — products sold in Israel with complete macros

Validation (each excluded/flagged row is counted in the report):
  - missing kcal/protein/fat/carbs                    → excluded
  - impossible values (negative, >900 kcal, macros > 100 g, sugar > carbs,
    sat fat > fat)                                     → excluded
  - kcal vs macros (Atwater, ±20 %)                    → official rows kept + flagged;
                                                         community rows excluded
  - MoH questionnaire aggregates (no source code)      → excluded (not foods)
  - exact duplicates (same name and values)            → merged, lowest id kept
  - missing optional nutrients stay NULL (never 0)
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
from sources import load_off, load_tzameret, load_usda, quality_flags, r1  # noqa: E402

GENERATED = os.path.join(ROOT, 'supabase', 'functions', '_shared', 'foodDb.generated.ts')
USDA_EXCLUDED_CATEGORIES = {'Baby Foods', 'American Indian/Alaska Native Foods'}
HARD_FLAGS = {'missing_macros', 'negative', 'kcal_over_900', 'macros_over_100g', 'sugar_over_carbs', 'satfat_over_fat'}

# Israeli brands that appear inside MoH names ("…, תנובה")
BRANDS = ['תנובה', 'שטראוס', 'טרה', 'יטבתה', 'גד', 'אסם', 'עלית', 'תלמה', "אנג'ל", 'אנגל', 'ברמן', 'דוידוביץ', 'ודש',
          'ויליגר', 'זוגלובק', 'עוף טוב', 'טיבון ויל', 'יחיעם', 'מאמא עוף', 'טבעול', 'צבר', 'שמיר', 'אחלה', 'מעדנות', 'יונה',
          'סטארקיסט', 'שופרסל', 'מקדונלדס', 'דנונה', 'יופלה', 'אקטיביה', 'פרילי', 'הרדוף', 'השחר העולה', 'ורד הגליל', 'נסטלה',
          'קנור', 'מיקי', 'יכין', 'בית השיטה', 'פריניב', 'פריגת', 'טמפו', 'קוקה קולה', 'שקדיה', 'גת', 'ששון', 'שקרצי', 'פרומין',
          'הגביע', 'אפיפית', 'מאיר בייגל', 'בייגל בייגל', 'בונז\'ור', 'עינת', 'שמש', 'לחם חי', 'B&D', 'פלדמן', 'נוגה', 'מולר',
          'עוף העמק', 'טירת צבי', 'מעדני מזרע', 'הוד חפר', 'בלדי', 'זנזיבר', 'סלטי צבר', 'מילוטל', 'אלפרו', 'תפוגן', 'סנפרוסט']

CATEGORY_BY_FNDDS = {'1': 'dairy', '2': 'meat_fish', '3': 'eggs', '4': 'legumes_nuts', '5': 'grains', '6': 'fruit',
                     '7': 'vegetables', '8': 'fats_sauces', '9': 'sweets_snacks'}
CATEGORY_BY_USDA = {
    'Dairy and Egg Products': 'dairy', 'Beef Products': 'meat_fish', 'Poultry Products': 'meat_fish', 'Pork Products': 'meat_fish',
    'Lamb, Veal, and Game Products': 'meat_fish', 'Finfish and Shellfish Products': 'meat_fish', 'Sausages and Luncheon Meats': 'meat_fish',
    'Legumes and Legume Products': 'legumes_nuts', 'Nut and Seed Products': 'legumes_nuts', 'Cereal Grains and Pasta': 'grains',
    'Baked Products': 'grains', 'Breakfast Cereals': 'grains', 'Fruits and Fruit Juices': 'fruit', 'Vegetables and Vegetable Products': 'vegetables',
    'Fats and Oils': 'fats_sauces', 'Soups, Sauces, and Gravies': 'fats_sauces', 'Spices and Herbs': 'fats_sauces', 'Sweets': 'sweets_snacks',
    'Snacks': 'sweets_snacks', 'Beverages': 'drinks', 'Fast Foods': 'meals', 'Restaurant Foods': 'meals', 'Meals, Entrees, and Side Dishes': 'meals',
}
DRINK_WORDS = re.compile(r'משקה|מיץ|קפה|תה,|תה |בירה|יין|סודה|קולה|נקטר|שייק|beverage|juice|coffee|tea|soda|wine|beer', re.I)

RAW_HE = re.compile(r'לא מבושל|לפני בישול|\bחי\b|, חי|טרי|נא\b|יבש|לא אפוי')
COOKED_HE = re.compile(r'מבושל|אפוי|צלוי|מטוגנ|בגריל|על האש|קלוי|מאודה|מוקפץ|מוכן|ממולא|ברוטב|בתנור|מעושן')
RAW_EN = re.compile(r'\braw\b|\bdry\b|uncooked|unprepared', re.I)
COOKED_EN = re.compile(r'cooked|boiled|roasted|fried|baked|broiled|grilled|braised|stewed|steamed|microwaved|pan-|toasted|prepared', re.I)
FAT_HE = re.compile(r'שמן|מטוגנ|חמאה|מרגרינה|בבלילה')
NO_FAT_HE = re.compile(r'ללא (תוספת )?(שמן|שומן)|בלי שמן|ללא שמן')
FAT_EN = re.compile(r'fried|with (oil|butter|margarine)|oil-roasted|in (vegetable )?oil', re.I)


def infer_state(name_he, name_en):
    he, en = name_he or '', name_en or ''
    if he:
        if COOKED_HE.search(he) and 'לא מבושל' not in he:
            return 'cooked'
        if RAW_HE.search(he):
            return 'raw'
    if en:
        if RAW_EN.search(en):
            return 'raw'
        if COOKED_EN.search(en):
            return 'cooked'
    return 'as_sold'


def infer_fat_added(name_he, name_en):
    he, en = name_he or '', name_en or ''
    if he and FAT_HE.search(he) and not NO_FAT_HE.search(he):
        return True
    return bool(en and FAT_EN.search(en) and 'without' not in en.lower())


def moh_brand(name):
    for b in BRANDS:
        if re.search(r'(^|[ ,/(])' + re.escape(b) + r'($|[ ,/)])', name):
            return b
    return None


def clean_servings(servings):
    out, seen = [], set()
    for label, g in servings:
        if label in ('גרמים', 'קילוגרם', 'gram', 'grams', 'g') or g is None:
            continue
        if not (1 < g <= 2000):
            continue  # e.g. "יחידה = 1 g" rows in the source are unit-less placeholders
        key = (label, g)
        if key in seen:
            continue
        seen.add(key)
        out.append([label[:40], g])
    return out[:8]


def row(rec, **extra):
    r = {
        'id': rec['id'], 'source': rec['source'], 'source_ref': rec['id'], 'source_url': rec.get('ref_url'),
        'verification': rec['verification'], 'name_he': rec.get('name_he') or None, 'name_en': rec.get('name_en') or None,
        'brand': rec.get('brand'), 'barcode': rec.get('barcode'), 'category': None,
        'state': infer_state(rec.get('name_he'), rec.get('name_en')),
        'fat_added': infer_fat_added(rec.get('name_he'), rec.get('name_en')),
        'kcal': r1(rec['kcal']), 'protein_g': r1(rec['protein_g']), 'fat_g': r1(rec['fat_g']), 'carbs_g': r1(rec['carbs_g']),
        'fiber_g': r1(rec.get('fiber_g')), 'sugar_g': r1(rec.get('sugar_g')), 'sat_fat_g': r1(rec.get('sat_fat_g')),
        'sodium_mg': r1(rec.get('sodium_mg')), 'servings': clean_servings(rec.get('servings') or []),
        'aliases': '', 'curated_key': None, 'quality_flags': [], 'rank_boost': 0, 'source_updated': rec.get('source_updated'),
    }
    r.update(extra)
    return r


def load_curated():
    text = open(GENERATED, encoding='utf-8').read()
    body = text[text.index('= [') + 2:].rstrip().rstrip(']').rstrip().rstrip(',') + ']'
    return json.loads(body)


def norm(s):
    s = re.sub(r'[֑-ׇ\'"`׳״]', '', (s or '').lower())
    s = s.translate(str.maketrans('ךםןףץ', 'כמנפצ'))
    return re.sub(r'[^0-9a-zא-ת%.]+', ' ', s).strip()


def main():
    data_dir, out_path = sys.argv[1], sys.argv[2]
    report_path = sys.argv[3] if len(sys.argv) > 3 else None
    rows, excluded, flagged = [], defaultdict(Counter), defaultdict(Counter)

    # curated core
    for c in load_curated():
        rows.append({
            'id': f"cur:{c['key']}", 'source': 'curated', 'source_ref': c.get('ref'),
            'source_url': None, 'verification': c['verification'], 'name_he': c['he'], 'name_en': c['en'], 'brand': None,
            'barcode': c['ref'][4:] if (c.get('ref') or '').startswith('off:') else None, 'category': None,
            'state': c['state'], 'fat_added': bool(c.get('fat_added')),
            'kcal': c['kcal'], 'protein_g': c['p'], 'fat_g': c['f'], 'carbs_g': c['c'],
            'fiber_g': c.get('fib'), 'sugar_g': c.get('sug'), 'sat_fat_g': c.get('sat'), 'sodium_mg': c.get('na'),
            'servings': [[k, v] for k, v in c['units'].items()], 'aliases': '|'.join(c['aliases']), 'curated_key': c['key'],
            'quality_flags': c.get('flags', []), 'rank_boost': 0, 'source_updated': c.get('updated'),
        })
    counts = Counter(curated=len(rows))

    # Israeli MoH
    seen = {}
    for rec in load_tzameret(data_dir):
        if rec['makor'] is None:
            excluded['moh']['questionnaire aggregate (not a food)'] += 1
            continue
        flags = quality_flags(rec)
        hard = HARD_FLAGS.intersection(flags)
        if hard:
            excluded['moh'][', '.join(sorted(hard))] += 1
            continue
        key = (norm(rec['name_he']), rec['kcal'], rec['protein_g'], rec['fat_g'], rec['carbs_g'])
        if key in seen:
            excluded['moh']['exact duplicate (merged)'] += 1
            continue
        seen[key] = rec['id']
        r = row(rec, brand=moh_brand(rec['name_he']), quality_flags=flags)
        smcode = str(rec.get('fndds') or '')
        r['category'] = CATEGORY_BY_FNDDS.get(smcode[:1]) if smcode else None
        if r['category'] == 'sweets_snacks' and DRINK_WORDS.search(rec['name_he']):
            r['category'] = 'drinks'
        for f in flags:
            flagged['moh'][f] += 1
        rows.append(r)
        counts['moh'] += 1

    # USDA
    for rec in load_usda(data_dir):
        if rec.get('category') in USDA_EXCLUDED_CATEGORIES:
            excluded['usda'][f"category: {rec['category']}"] += 1
            continue
        flags = quality_flags(rec, alcohol=bool(re.search(r'alcoholic|wine|beer|liqueur|spirits', rec['name_en'], re.I)))
        hard = HARD_FLAGS.intersection(flags)
        if hard:
            excluded['usda'][', '.join(sorted(hard))] += 1
            continue
        r = row(rec, quality_flags=flags, category=CATEGORY_BY_USDA.get(rec.get('category')))
        for f in flags:
            flagged['usda'][f] += 1
        rows.append(r)
        counts['usda'] += 1

    # Open Food Facts (community-entered labels): strict — any inconsistency excludes the row
    seen_off = set()
    for rec in load_off(data_dir):
        flags = quality_flags(rec)
        if flags:
            excluded['off'][', '.join(flags)] += 1
            continue
        if not (rec.get('name_he') or rec.get('name_en')):
            excluded['off']['no product name'] += 1
            continue
        key = (norm(rec.get('name_he') or rec.get('name_en')), norm(rec.get('brand')), rec['kcal'], rec['protein_g'])
        if key in seen_off:
            excluded['off']['duplicate product (same name, brand, values)'] += 1
            continue
        seen_off.add(key)
        rows.append(row(rec))
        counts['off'] += 1

    with open(out_path, 'w', encoding='utf-8') as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')

    summary = {'counts': dict(counts), 'excluded': {k: dict(v) for k, v in excluded.items()},
               'flagged': {k: dict(v) for k, v in flagged.items()}, 'total': len(rows)}
    print(json.dumps(summary, ensure_ascii=False, indent=1))
    if report_path:
        lines = ['# Food database build report', '', f"Total rows: **{len(rows)}**", '',
                 '| source | rows imported |', '|---|---|', *[f'| {k} | {v} |' for k, v in counts.items()], '',
                 '## Excluded rows', '', '| source | reason | rows |', '|---|---|---|',
                 *[f'| {s} | {reason} | {n} |' for s, c in excluded.items() for reason, n in c.most_common()], '',
                 '## Kept but flagged (official data, shown with a warning and ranked lower)', '', '| source | flag | rows |', '|---|---|---|',
                 *[f'| {s} | {f} | {n} |' for s, c in flagged.items() for f, n in c.most_common()], '']
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        open(report_path, 'w', encoding='utf-8').write('\n'.join(lines))
    with open(out_path + '.summary.json', 'w') as fh:
        json.dump(summary, fh, ensure_ascii=False)


if __name__ == '__main__':
    main()
