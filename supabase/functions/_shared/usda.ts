import type { Per100 } from './schema.ts'

/**
 * USDA FoodData Central lookup for foods not in our curated table.
 * Searches only Foundation + SR Legacy (lab-analysed, per-100 g values) and
 * never branded entries, which are per-serving and noisy.
 *
 * Free API key: https://fdc.nal.usda.gov/api-key-signup (DEMO_KEY works for
 * light use but is IP-rate-limited).
 */

const cache = new Map<string, { per100: Per100; description: string } | null>()

interface FdcNutrient { nutrientId?: number; nutrientNumber?: string; nutrientName?: string; unitName?: string; value?: number }

function pick(nutrients: FdcNutrient[], ids: number[], numbers: string[]): number | undefined {
  for (const n of nutrients) {
    if ((n.nutrientId && ids.includes(n.nutrientId)) || (n.nutrientNumber && numbers.includes(n.nutrientNumber))) {
      if (typeof n.value === 'number' && (!n.unitName || n.unitName.toUpperCase() !== 'KJ')) return n.value
    }
  }
  return undefined
}

export function per100FromFdc(nutrients: FdcNutrient[]): Per100 | null {
  // 1008 = Energy (kcal, "208"); 2047/2048 = Atwater general/specific (Foundation foods)
  const kcal = pick(nutrients, [1008, 2048, 2047], ['208', '958', '957'])
  const protein = pick(nutrients, [1003], ['203'])
  const fat = pick(nutrients, [1004], ['204'])
  const carbs = pick(nutrients, [1005], ['205'])
  if (kcal === undefined || protein === undefined || fat === undefined) return null
  return { kcal: Math.round(kcal), protein_g: protein, fat_g: fat, carbs_g: carbs ?? 0 }
}

export async function lookupUsda(
  query: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 3000,
): Promise<{ per100: Per100; description: string } | null> {
  const q = query.trim().toLowerCase()
  if (!q) return null
  if (cache.has(q)) return cache.get(q)!
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(apiKey)}` +
    `&query=${encodeURIComponent(q)}&dataType=Foundation&dataType=SR%20Legacy&pageSize=3`
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const json = await res.json()
    for (const food of json?.foods ?? []) {
      const per100 = per100FromFdc(food.foodNutrients ?? [])
      if (per100) {
        const hit = { per100, description: String(food.description ?? q) }
        cache.set(q, hit)
        return hit
      }
    }
    cache.set(q, null)
    return null
  } catch {
    return null
  }
}
