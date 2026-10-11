"""
Builds the curated core table from curated_spec.py and the open datasets.

  python3 scripts/foods/build_curated.py <data-dir> [--check]

Writes
  supabase/functions/_shared/foodDb.generated.ts   (bundled in the app + edge function)
  docs/food-data/curated-report.md                  (sources, before/after, discrepancies)

--check  regenerates in memory and fails if the committed file differs
         (CI uses this to prove every number still matches its source record).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)

from sources import atwater, load_off, load_tzameret, load_usda, quality_flags, r1  # noqa: E402
from curated_spec import FOODS  # noqa: E402

OUT_TS = os.path.join(ROOT, 'supabase', 'functions', '_shared', 'foodDb.generated.ts')
OUT_MD = os.path.join(ROOT, 'docs', 'food-data', 'curated-report.md')
NUTRIENTS = ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'sugar_g', 'sat_fat_g', 'sodium_mg']
SHORT = {'kcal': 'kcal', 'protein_g': 'p', 'fat_g': 'f', 'carbs_g': 'c', 'fiber_g': 'fib', 'sugar_g': 'sug', 'sat_fat_g': 'sat', 'sodium_mg': 'na'}
ALCOHOL = {'beer', 'wine'}


def rounded(rec):
    out = {}
    for n in NUTRIENTS:
        v = rec.get(n)
        if v is None:
            continue
        out[SHORT[n]] = round(v) if n in ('kcal', 'sodium_mg') else r1(v)
    return out


def recipe(parts, idx):
    total = sum(g for _, g in parts)
    acc = {}
    for n in NUTRIENTS:
        vals = []
        for ref, g in parts:
            v = idx[ref].get(n)
            if v is None:
                vals = None
                break
            vals.append(v * g / 100)
        acc[n] = None if vals is None else sum(vals) * 100 / total
    return acc, total


def main():
    data_dir = sys.argv[1]
    check = '--check' in sys.argv
    recs = load_tzameret(data_dir) + load_usda(data_dir) + load_off(data_dir)
    idx = {r['id']: r for r in recs}
    old = {}
    old_path = os.environ.get('OLD_FOODS_JSON')
    if old_path and os.path.exists(old_path):
        old = {o['key']: o for o in json.load(open(old_path))}

    out, report, problems = [], [], []
    keys = set()
    for spec in FOODS:
        key = spec['key']
        if key in keys:
            problems.append(f'duplicate key {key}')
        keys.add(key)
        ref = spec['ref']
        entry = {
            'key': key, 'he': spec['he'], 'en': spec['en'], 'emoji': spec['emoji'],
            'aliases': spec['aliases'], 'state': spec['state'],
        }
        if isinstance(ref, str):
            if ref not in idx:
                problems.append(f'{key}: missing record {ref}')
                continue
            src = idx[ref]
            values = {n: src.get(n) for n in NUTRIENTS}
            entry.update(rounded(values))
            entry['source'] = src['source']
            entry['ref'] = ref
            entry['ref_name'] = src['name_he'] or src['name_en']
            entry['verification'] = 'label' if src['source'] == 'off' else (src['verification'] or 'official')
            if src.get('source_updated'):
                entry['updated'] = src['source_updated']
            ref_desc = f"`{ref}` {entry['ref_name']}"
        elif 'recipe' in ref:
            missing = [r for r, _ in ref['recipe'] if r not in idx]
            if missing:
                problems.append(f'{key}: recipe refs missing {missing}')
                continue
            values, total = recipe(ref['recipe'], idx)
            entry.update(rounded(values))
            entry['source'] = 'recipe'
            entry['ref'] = '+'.join(f'{r}×{g}' for r, g in ref['recipe'])
            entry['ref_name'] = ref['note']
            entry['verification'] = 'recipe'
            ref_desc = f"מתכון: {ref['note']} ({' + '.join(f'`{r}`' for r, _ in ref['recipe'])})"
        else:
            k, p, f, c = ref['estimate']
            values = {'kcal': k, 'protein_g': p, 'fat_g': f, 'carbs_g': c}
            entry.update(rounded(values))
            entry['source'] = 'estimate'
            entry['verification'] = 'estimate'
            entry['ref_name'] = ref['note']
            ref_desc = f"הערכה: {ref['note']}"

        entry['units'] = spec['units']
        for opt in ('includes', 'pair', 'no_oil', 'fat_added', 'note'):
            if spec.get(opt):
                entry[opt] = spec[opt]

        flags = quality_flags({**values}, alcohol=key in ALCOHOL)
        if flags:
            entry['flags'] = flags
        # alternative records: discrepancy report
        alts = []
        for a in spec.get('alt', []):
            if a not in idx:
                alts.append(f'`{a}` (לא נמצא)')
                continue
            ak = idx[a].get('kcal')
            if ak is None or not values.get('kcal'):
                continue
            diff = (ak - values['kcal']) / values['kcal'] * 100
            mark = ' ⚠️' if abs(diff) > 15 else ''
            alts.append(f"`{a}` {round(ak)} ({diff:+.0f}%){mark}")
        o = old.get(key)
        before = f"{o['kcal']}" if o else 'חדש'
        delta = ''
        if o and values.get('kcal'):
            d = (values['kcal'] - o['kcal']) / o['kcal'] * 100
            delta = f'{d:+.0f}%'
        report.append(f"| `{key}` | {spec['he']} | {before} | {round(values['kcal']) if values.get('kcal') is not None else '?'} | {delta} | "
                      f"{entry['verification']} | {ref_desc} | {', '.join(alts)} | {', '.join(flags)} |")
        out.append(entry)

    if problems:
        print('\n'.join(problems), file=sys.stderr)
        sys.exit(1)

    ts = ('// AUTO-GENERATED by scripts/foods/build_curated.py from scripts/foods/curated_spec.py\n'
          '// and the open datasets (Israeli MoH Tzameret, USDA FoodData Central, Open Food Facts).\n'
          '// Do not edit numbers here — change the spec (its source reference) and rebuild.\n'
          "import type { CuratedFood } from './foodDb.ts'\n\n"
          'export const CURATED: CuratedFood[] = [\n' + ',\n'.join(' ' + json.dumps(e, ensure_ascii=False) for e in out) + ',\n]\n')

    removed = sorted(set(old) - keys)
    md = ['# Curated food table — sources and changes', '',
          'Generated by `scripts/foods/build_curated.py`. Values per 100 g of the food in the stated state.',
          'kcal: old value → new value from the referenced record. "alt" = other records for the same food',
          '(⚠️ = differs by more than 15 %, see the note in the spec). Carbohydrates are *available* carbs',
          '(without fibre), as on Israeli labels; USDA totals were converted by subtracting fibre.', '',
          f'Entries: {len(out)} (previous table: {len(old) or "?"}).' + (f' Keys no longer present: {", ".join(removed)}.' if removed else ''), '',
          '| key | שם | kcal לפני | kcal עכשיו | שינוי | אימות | מקור | השוואה | דגלים |',
          '|---|---|---|---|---|---|---|---|---|', *report, '']

    if check:
        cur = open(OUT_TS, encoding='utf-8').read() if os.path.exists(OUT_TS) else ''
        if cur != ts:
            print('foodDb.generated.ts is out of date with its sources — run scripts/foods/build_curated.py', file=sys.stderr)
            sys.exit(1)
        print(f'curated table OK: {len(out)} entries match their source records')
        return
    open(OUT_TS, 'w', encoding='utf-8').write(ts)
    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    open(OUT_MD, 'w', encoding='utf-8').write('\n'.join(md))
    print(f'wrote {len(out)} curated foods')


if __name__ == '__main__':
    main()
