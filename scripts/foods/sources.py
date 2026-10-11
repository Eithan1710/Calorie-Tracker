"""
Readers for the three open datasets (stdlib only, so it runs anywhere).

Every reader returns records in one normalised shape, per 100 g of the food:

  {id, source, ref_url, name_he, name_en, brand, kcal, protein_g, fat_g,
   carbs_g (AVAILABLE carbohydrate, i.e. without fibre — the Israeli/EU label
   convention), fiber_g, sugar_g, sat_fat_g, sodium_mg, servings [[label, g]],
   verification, source_updated, flags []}

A nutrient the source does not report is None — never 0.

Data folder layout (written by .github/workflows/fetch-food-sources.yml):
  tzameret/<resource-id>.json     data.gov.il CKAN datastore dumps
  usda/foods.jsonl.gz             compact FDC Foundation + SR Legacy extract
  off/israel_products.jsonl.gz    Open Food Facts rows sold in Israel
"""
import gzip
import json
import os
from datetime import datetime, timezone

TZ_FOODS = 'c3cb0630-0650-46c1-a068-82d575c094b2'
TZ_UNITS = '98fb46fe-e8de-4067-94d2-b0a8ea4269da'
TZ_SERVINGS = '755d28c0-75f7-40e1-9c8c-ecdd106f9b2d'
TZ_PACKAGE = 'https://data.gov.il/dataset/nutrition-database'

# makor (source) codes from the dataset's field documentation
MAKOR = {
    1: ('official', 'USDA (NDB/FNDDS) via MoH'),
    2: ('label', 'manufacturer label'),
    3: ('label', 'manufacturer label + MoH calculation'),
    4: ('recipe', 'MoH standard recipe'),
    5: ('official', 'other published source'),
    6: ('official', 'USDA with MoH calculation'),
    7: ('official', 'combined sources'),
}


def num(v):
    if v is None or v == '':
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None  # NaN → None


def r1(v):
    return None if v is None else round(v, 1)


def load_tzameret(root):
    d = os.path.join(root, 'tzameret')
    rec = lambda rid: json.load(open(os.path.join(d, f'{rid}.json'), encoding='utf-8'))['result']['records']
    units = {int(float(u['smlmida'])): u['shmmida'] for u in rec(TZ_UNITS)}
    servings = {}
    for s in rec(TZ_SERVINGS):
        code = int(float(s['mmitzrach']))
        g = num(s['mishkal'])
        label = units.get(int(float(s['mida'])))
        if g is None or not label:
            continue
        servings.setdefault(code, []).append([label.strip(), round(g, 1)])
    out = []
    for r in rec(TZ_FOODS):
        code = r['Code']
        makor = r.get('makor')
        verification, makor_text = MAKOR.get(int(makor), (None, None)) if makor is not None else (None, None)
        updated = None
        if r.get('tarich_idkun'):
            try:
                updated = datetime.strptime(r['tarich_idkun'].strip()[:10], '%d/%m/%Y').date().isoformat()
            except ValueError:
                updated = None
        out.append({
            'id': f'moh:{code}',
            'source': 'moh',
            'ref_url': f'{TZ_PACKAGE} (resource {TZ_FOODS}, Code {code})',
            'name_he': (r.get('shmmitzrach') or '').strip(),
            'name_en': (r.get('english_name') or '').strip(),
            'brand': None,
            'kcal': num(r.get('food_energy')),
            'protein_g': num(r.get('protein')),
            'fat_g': num(r.get('total_fat')),
            'carbs_g': num(r.get('carbohydrates')),
            'fiber_g': num(r.get('total_dietary_fiber')),
            'sugar_g': num(r.get('total_sugars')),
            'sat_fat_g': num(r.get('saturated_fat')),
            'sodium_mg': num(r.get('sodium')),
            'servings': servings.get(code, []),
            'verification': verification,
            'makor': makor,
            'fndds': str(int(float(r['smlmitzrach']))) if num(r.get('smlmitzrach')) is not None else None,
            'makor_text': makor_text,
            'source_updated': updated,
            'flags': [],
        })
    return out


def load_usda(root):
    out = []
    with gzip.open(os.path.join(root, 'usda', 'foods.jsonl.gz'), 'rt', encoding='utf-8') as fh:
        for line in fh:
            r = json.loads(line)
            x = r.get('nutrients') or {}
            kcal = x.get('kcal') or x.get('kcal_atw_spec') or x.get('kcal_atw_gen')
            carbs_total = x.get('carbs')
            fiber = x.get('fiber')
            avail = None if carbs_total is None else max(0.0, carbs_total - (fiber or 0.0))
            sugar = x.get('sugar') if x.get('sugar') is not None else x.get('sugar_nlea')
            servings = []
            for p in r.get('portions') or []:
                label = (p.get('desc') or p.get('unit') or '').strip()
                if label and p.get('g'):
                    servings.append([label, round(float(p['g']), 1)])
            out.append({
                'id': f"fdc:{r['fdcId']}",
                'source': 'usda',
                'ref_url': f"https://fdc.nal.usda.gov/food-details/{r['fdcId']}/nutrients",
                'name_he': None,
                'name_en': r['description'],
                'brand': None,
                'category': r.get('category'),
                'dataset': r.get('dataset'),
                'kcal': kcal,
                'protein_g': x.get('protein'),
                'fat_g': x.get('fat'),
                'carbs_g': avail,
                'carbs_total_g': carbs_total,
                'fiber_g': fiber,
                'sugar_g': sugar,
                'sat_fat_g': x.get('sat_fat'),
                'sodium_mg': x.get('sodium'),
                'servings': servings,
                'verification': 'official',
                'source_updated': (r.get('published') or '')[:10] or None,
                'flags': [],
            })
    return out


def load_off(root):
    out = []
    with gzip.open(os.path.join(root, 'off', 'israel_products.jsonl.gz'), 'rt', encoding='utf-8') as fh:
        for line in fh:
            r = json.loads(line)
            code = (r.get('code') or '').strip()
            if not code:
                continue
            name = (r.get('product_name') or '').strip()
            sodium = num(r.get('sodium_100g'))
            if sodium is None and num(r.get('salt_100g')) is not None:
                sodium = num(r.get('salt_100g')) / 2.5
            servings = []
            sq = num(r.get('serving_quantity'))
            if sq and 0 < sq <= 2000:
                servings.append([(r.get('serving_size') or 'מנה').strip()[:40], round(sq, 1)])
            updated = None
            if r.get('last_modified_t'):
                try:
                    updated = datetime.fromtimestamp(int(r['last_modified_t']), tz=timezone.utc).date().isoformat()
                except (TypeError, ValueError, OverflowError):
                    pass
            has_he = any('֐' <= ch <= '׿' for ch in name)
            out.append({
                'id': f'off:{code}',
                'source': 'off',
                'ref_url': f'https://world.openfoodfacts.org/product/{code}',
                'name_he': name if has_he else None,
                'name_en': None if has_he else name,
                'brand': (r.get('brands') or '').split(',')[0].strip() or None,
                'barcode': code,
                'quantity': (r.get('quantity') or '').strip() or None,
                'kcal': num(r.get('energy-kcal_100g')) if num(r.get('energy-kcal_100g')) is not None
                else (None if num(r.get('energy_100g')) is None else num(r.get('energy_100g')) / 4.184),
                'protein_g': num(r.get('proteins_100g')),
                'fat_g': num(r.get('fat_100g')),
                'carbs_g': num(r.get('carbohydrates_100g')),
                'fiber_g': num(r.get('fiber_100g')),
                'sugar_g': num(r.get('sugars_100g')),
                'sat_fat_g': num(r.get('saturated-fat_100g')),
                'sodium_mg': None if sodium is None else sodium * 1000,
                'servings': servings,
                'verification': 'community',
                'source_updated': updated,
                'flags': [],
            })
    return out


def atwater(r):
    """kcal implied by macros (fibre at 2 kcal/g). None if a macro is missing."""
    if any(r.get(k) is None for k in ('protein_g', 'fat_g', 'carbs_g')):
        return None
    return 4 * r['protein_g'] + 9 * r['fat_g'] + 4 * r['carbs_g'] + 2 * (r.get('fiber_g') or 0)


def quality_flags(r, alcohol=False):
    """Plausibility checks. Returns a list of flag codes (empty = clean)."""
    flags = []
    k, p, f, c = r.get('kcal'), r.get('protein_g'), r.get('fat_g'), r.get('carbs_g')
    if None in (k, p, f, c):
        flags.append('missing_macros')
        return flags
    if k < 0 or p < 0 or f < 0 or c < 0:
        flags.append('negative')
    if k > 902:
        flags.append('kcal_over_900')  # pure fat is ~900 kcal/100 g; more = kJ entered as kcal
    if p + f + c > 101:
        flags.append('macros_over_100g')
    for key in ('fiber_g', 'sugar_g', 'sat_fat_g'):
        v = r.get(key)
        if v is not None and v < 0:
            flags.append('negative')
    if r.get('sugar_g') is not None and c is not None and r['sugar_g'] > c + 1.5:
        flags.append('sugar_over_carbs')
    if r.get('sat_fat_g') is not None and r['sat_fat_g'] > f + 0.6:
        flags.append('satfat_over_fat')
    a = atwater(r)
    if a is not None and not alcohol and (k > 15 or a > 15):
        if abs(a - k) > max(20, 0.2 * max(k, a)):
            flags.append('atwater_mismatch')
    return sorted(set(flags))
