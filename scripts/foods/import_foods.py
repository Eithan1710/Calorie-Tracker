"""
Loads the built food rows (build.py output) into Supabase — or prints SQL.

  # print SQL batches (local Postgres / psql / SQL editor):
  python3 scripts/foods/import_foods.py build/foods.ndjson --sql > foods.sql

  # write to the Supabase project through the Management API
  # (needs SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF in the environment;
  #  used by .github/workflows/import-food-db.yml, started by hand):
  python3 scripts/foods/import_foods.py build/foods.ndjson --api

Safe by design: it only upserts rows of the reference table mz_foods, then
removes reference rows of the same source that are no longer in the build
(e.g. a product removed upstream). User tables are never touched.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

COLUMNS = [
    ('id', 'text'), ('source', 'text'), ('source_ref', 'text'), ('source_url', 'text'), ('verification', 'text'),
    ('name_he', 'text'), ('name_en', 'text'), ('brand', 'text'), ('barcode', 'text'), ('category', 'text'),
    ('state', 'text'), ('fat_added', 'boolean'), ('kcal', 'numeric'), ('protein_g', 'numeric'), ('fat_g', 'numeric'),
    ('carbs_g', 'numeric'), ('fiber_g', 'numeric'), ('sugar_g', 'numeric'), ('sat_fat_g', 'numeric'), ('sodium_mg', 'numeric'),
    ('servings', 'jsonb'), ('aliases', 'text'), ('curated_key', 'text'), ('quality_flags', 'text[]'), ('rank_boost', 'real'),
    ('source_updated', 'date'),
]
BATCH = 400
TAG = '$mzfoods$'

SOURCES = {
    'curated': ('מאגר מאזן (טבלת ליבה)', 'https://github.com/Eithan1710/Calorie-Tracker/blob/main/docs/food-data/curated-report.md',
                'Derived from the sources below', 'Values copied from the referenced MoH / USDA / Open Food Facts records'),
    'moh': ('מאגר התזונה הלאומי — משרד הבריאות (צמרת)', 'https://data.gov.il/dataset/nutrition-database',
            'data.gov.il open licence ("Other (Open)")', 'מקור: משרד הבריאות, מאגר התזונה הלאומי (data.gov.il)'),
    'usda': ('USDA FoodData Central (Foundation + SR Legacy)', 'https://fdc.nal.usda.gov/',
             'CC0 1.0 (public domain)', 'U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.'),
    'off': ('Open Food Facts — מוצרים הנמכרים בישראל', 'https://world.openfoodfacts.org/country/israel',
            'Open Database License (ODbL) 1.0; contents: Database Contents License', '© Open Food Facts contributors, ODbL'),
}


def sql_batches(rows, run_id):
    cols = ', '.join(c for c, _ in COLUMNS)
    decl = ', '.join(f'{c} {"jsonb" if t == "jsonb" else ("text[]" if t == "text[]" else t)}' for c, t in COLUMNS)
    updates = ', '.join(f'{c} = excluded.{c}' for c, _ in COLUMNS if c != 'id')
    for i in range(0, len(rows), BATCH):
        payload = json.dumps(rows[i:i + BATCH], ensure_ascii=False)
        if TAG in payload:
            raise SystemExit('payload contains the dollar-quote tag')
        yield (f'insert into public.mz_foods ({cols}, imported_at)\n'
               f'select {cols}, \'{run_id}\'::timestamptz from jsonb_to_recordset({TAG}{payload}{TAG}::jsonb) as x({decl})\n'
               f'on conflict (id) do update set {updates}, imported_at = excluded.imported_at;')


def finish_sql(counts, excluded, run_id):
    out = []
    for src, n in counts.items():
        name, url, lic, attr = SOURCES[src]
        out.append(f"delete from public.mz_foods where source = '{src}' and imported_at < '{run_id}'::timestamptz;")
        exc = json.dumps(excluded.get(src, {}), ensure_ascii=False).replace("'", "''")
        out.append(
            'insert into public.mz_food_sources (source, name, url, license, attribution, version, row_count, excluded, imported_at) values ('
            + ', '.join("'" + str(v).replace("'", "''") + "'" for v in (src, name, url, lic, attr, run_id[:10])) + f", {n}, '{exc}'::jsonb, now())"
            ' on conflict (source) do update set name = excluded.name, url = excluded.url, license = excluded.license,'
            ' attribution = excluded.attribution, version = excluded.version, row_count = excluded.row_count,'
            ' excluded = excluded.excluded, imported_at = excluded.imported_at;')
    return out


def api_query(sql):
    ref = os.environ['SUPABASE_PROJECT_REF']
    token = os.environ['SUPABASE_ACCESS_TOKEN']
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{ref}/database/query',
        data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json', 'User-Agent': 'maazan-food-import'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return json.loads(res.read() or b'null')
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors='replace')[:500]
            if e.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise SystemExit(f'Supabase API error {e.code}: {body}')
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(3 * (attempt + 1))
                continue
            raise SystemExit(f'Supabase API unreachable: {e}')


def main():
    path = sys.argv[1]
    mode = '--api' if '--api' in sys.argv else '--sql'
    rows = [json.loads(line) for line in open(path, encoding='utf-8') if line.strip()]
    summary = json.load(open(path + '.summary.json')) if os.path.exists(path + '.summary.json') else {}
    counts = {}
    for r in rows:
        counts[r['source']] = counts.get(r['source'], 0) + 1
    run_id = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    statements = list(sql_batches(rows, run_id)) + finish_sql(counts, summary.get('excluded', {}), run_id)
    if mode == '--sql':
        print('begin;')
        for s in statements:
            print(s)
        print('commit;')
        return
    for i, s in enumerate(statements, 1):
        api_query(s)
        if i % 5 == 0 or i == len(statements):
            print(f'{i}/{len(statements)} statements', flush=True)
    check = api_query('select source, count(*) as n from public.mz_foods group by 1 order by 1;')
    print('rows now in mz_foods:', json.dumps(check, ensure_ascii=False))


if __name__ == '__main__':
    main()
