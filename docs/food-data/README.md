# Food database

How מאזן knows what food contains, where every number comes from, and how to update it.

## Sources (researched October 2026)

| Source | What it is | Used? | Licence / terms | Access & limits |
|---|---|---|---|---|
| **Israeli Ministry of Health — national nutrition database ("צמרת")** · [data.gov.il/dataset/nutrition-database](https://data.gov.il/dataset/nutrition-database) | 4,624 foods and recipes with 74 nutrients per 100 g, Hebrew + English names, 19k household servings (כף, פרוסה, גביע…), Israeli brands (Tnuva, Strauss, Osem, Angel…), each row tagged with its origin (USDA, manufacturer label, MoH recipe) | **Yes — primary source for Israeli foods** | data.gov.il open licence ("Other (Open)") | Free CKAN API / bulk download, no key. Updated "quarterly" per metadata; the food table was last modified 2022-10 |
| **USDA FoodData Central** · [fdc.nal.usda.gov](https://fdc.nal.usda.gov/) | Foundation Foods (lab-analysed) + SR Legacy (7,793 foods) | **Yes — generic/raw/cooked ingredients** | CC0 (public domain); citation requested | Bulk download (no key) — used for the import. Live API: free key, 1,000 req/h (DEMO_KEY: 30/h, 50/day) — kept as a fallback |
| **Open Food Facts** · [world.openfoodfacts.org](https://world.openfoodfacts.org/country/israel) | Crowd-sourced packaged products with barcodes; ~8,600 tagged as sold in Israel, but only ~1,100 have complete nutrition | **Yes — Israeli packaged products only, strictly filtered, marked "לא מאומת"** | ODbL 1.0 (database), DbCL (contents) — attribution required, share-alike on the derived database | Bulk export (CSV) — the API allows 10 searches/min, so it is *not* used for search-as-you-type |
| MyFitnessPal | Very large, mostly user-submitted entries | No | No public API; terms forbid scraping | A 2020 study found user entries under-report nutrients versus a research database (e.g. sodium, fibre) — [JMIR mHealth 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7641788/) |
| Cronometer | Curated from NCCDB, USDA, national tables (Canada, NEVO, CoFID…) | No (reference for the approach) | No public API | Its approach — prefer lab/official data, label data for branded foods, show the source — is what this design follows |
| FatSecret Platform API | Commercial food API | No | Free "Basic" tier: 5,000 calls/day, US data in English only; Premier priced on request | No Hebrew/Israeli coverage on the free tier — no benefit over the open sources |

Decision: **official open data first** (MoH for Israel, USDA for generic foods), **product labels**
for branded items, **community data last and labelled**, **AI only to understand the text and the
portion** — never as the source of a nutrient value when a record exists. No paid API is needed.

## How it works

```
"150 גרם חזה עוף ברוטב עם 8 גרם שמן"
   │
   ▼  AI (Gemini…) — only interprets: items, grams, raw/cooked, brand, whether the amount
   │   was stated / counted / estimated. Returns a key from the curated table when one fits.
   ▼
   1. curated core table   ~205 everyday foods, bundled in the app (works offline)
   2. food database        ~13,300 rows in Supabase (mz_foods): curated + MoH + USDA + Israeli products
   3. USDA live API        only if the database has nothing that fits
   4. AI estimate          last resort, flagged "הערכה" everywhere
   │
   ▼  numbers computed in code from the record × grams; totals summed deterministically
```

* **Curated core** (`supabase/functions/_shared/foodDb.generated.ts`) — every entry names its
  source record (`moh:1946`, `fdc:171077`, `off:7290…`) or a documented recipe of such records.
  The numbers are *copied by a script* (`scripts/foods/build_curated.py`), never typed by hand,
  and CI fails if any number drifts from its source. Full list with before/after values and
  discrepancies: [curated-report.md](curated-report.md).
* **Full database** (`public.mz_foods`) — built by `scripts/foods/build.py`, loaded by
  `scripts/foods/import_foods.py`. Searched with `public.mz_search_foods` (trigram index,
  Hebrew/English, typo-tolerant). Members only (checked inside the function); anonymous users get nothing.
* **Raw vs cooked** — separate records (rice raw 365 / cooked 130; chicken breast raw 120 /
  roasted 160; couscous dry 376 / cooked 175). Records know their counterpart; when the user gives
  grams without saying raw or cooked and the difference is large, the app asks.
* **Oil** — records know whether they include cooking fat (`fat_added`) and their no-oil
  variant. A stated oil amount switches the dish to its no-oil record; an oil the AI merely
  assumed is dropped when the dish already includes frying oil. Oil is never counted twice.
* **Carbohydrates** are *available* carbs (without fibre), as on Israeli labels. USDA totals
  are converted by subtracting fibre. Missing nutrients stay empty — never shown as 0.

### Ranking

Relevance (trigram similarity + share of words found + exact-name/alias bonus) plus a reliability
bonus: curated > MoH > USDA > product label > community. A community entry can only win on
clearly better relevance (e.g. the user typed its exact brand), never on a tie. Rows that fail a
plausibility check are ranked lower and shown with a warning.

### Validation (`build.py`, CI job "food-data")

| check | official rows (MoH/USDA) | community rows (Open Food Facts) |
|---|---|---|
| missing kcal/protein/fat/carbs | excluded | excluded |
| negative values, >900 kcal/100 g (kJ entered as kcal), macros > 100 g, sugar > carbs, sat. fat > fat | excluded | excluded |
| kcal vs macros (4/9/4, fibre 2 kcal/g) off by > 20 % | kept, flagged, ranked lower | excluded |
| MoH questionnaire aggregates (not real foods) | excluded | — |
| exact duplicates | merged | merged |

Latest numbers: [import-report.md](import-report.md). The SQL test `supabase/tests/food_search.sql`
checks search quality (Hebrew, English, typos, raw/cooked, brands, ranking) and access rules on a
real Postgres in CI.

## Updating the data

1. **Actions → Fetch food sources → Run workflow** (also runs quarterly). Downloads the three
   datasets to the `data/sources` branch. Writes nothing to Supabase.
2. **Actions → Install food database (manual) → Run workflow.** Validates, builds and loads the
   rows into Supabase (needs the `SUPABASE_ACCESS_TOKEN` secret). Safe to re-run: it only
   touches the `mz_foods` reference table.
3. To change a curated food: edit `scripts/foods/curated_spec.py` (point it at a different
   record), run `python3 scripts/foods/build_curated.py <data-dir>`, commit the regenerated files.

## Attribution

* Israeli Ministry of Health, national nutrition database (data.gov.il).
* U.S. Department of Agriculture, Agricultural Research Service. FoodData Central.
* Product data © Open Food Facts contributors, [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
  The Open Food Facts rows are kept as a separate, identifiable part of the database (`source = 'off'`).

## Known limitations

* The MoH table was last refreshed in 2022; products reformulated since then may differ from
  their current label. Brand rows show the source record so a user can compare with the package.
* Open Food Facts covers only ~1,000 Israeli products with complete, consistent data; many
  supermarket products are not in any open dataset. Those fall back to a similar generic record
  (the item says so) or to the AI estimate.
* Restaurant dishes (shawarma, kebab, sabich…) vary a lot by place; the values are standard MoH
  recipes and are shown as "מתכון מחושב".
* Search needs the network for the full database; offline it searches the ~205 curated foods.
