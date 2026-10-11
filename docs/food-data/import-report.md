# Food database build report

Total rows: **13327**

| source | rows imported |
|---|---|
| curated | 205 |
| moh | 4502 |
| usda | 7567 |
| off | 1053 |

## Excluded rows

| source | reason | rows |
|---|---|---|
| moh | questionnaire aggregate (not a food) | 114 |
| moh | missing_macros | 4 |
| moh | macros_over_100g | 2 |
| moh | satfat_over_fat | 2 |
| usda | category: Baby Foods | 345 |
| usda | category: American Indian/Alaska Native Foods | 165 |
| usda | missing_macros | 78 |
| usda | sugar_over_carbs | 1 |
| off | missing_macros | 6360 |
| off | no product name | 29 |
| off | atwater_mismatch | 21 |
| off | atwater_mismatch, kcal_over_900 | 3 |
| off | atwater_mismatch, satfat_over_fat | 1 |
| off | duplicate product (same name, brand, values) | 1 |
| off | atwater_mismatch, sugar_over_carbs | 1 |
| off | macros_over_100g | 1 |

## Kept but flagged (official data, shown with a warning and ranked lower)

| source | flag | rows |
|---|---|---|
| moh | atwater_mismatch | 91 |
| usda | atwater_mismatch | 30 |
