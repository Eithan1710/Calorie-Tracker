import { describe, expect, it } from 'vitest'
import { entryFromFavorite, favoriteFromEntry, favoritesOf, findFavorite, MAX_FAVORITES, toggleFavorite, type Favorite } from './favorites'
import type { FoodEntry } from '../data/types'

const coffee = {
  title: 'קפה עם סוכר ',
  emoji: '☕',
  items: [
    { id: 'i1', name: 'קפה הפוך', grams: 55, calories: 29, protein_g: 1.5, fat_g: 1.6, carbs_g: 2.4 },
    { id: 'i2', name: 'סוכר', grams: 5, calories: 19, protein_g: 0, fat_g: 0, carbs_g: 5 },
  ],
  totals: { calories: 48, protein_g: 1.5, fat_g: 1.6, carbs_g: 7.4 },
  confidence: 0.9,
  provider: 'gemini',
} as unknown as FoodEntry

describe('favourite meals', () => {
  it('a favourite is the meal without its per-entry ids; logging it makes a fresh entry', () => {
    const fav = favoriteFromEntry(coffee, 'f1')
    expect(fav.title).toBe('קפה עם סוכר')
    expect(fav.items.every((i) => !('id' in i))).toBe(true)
    let n = 0
    const e = entryFromFavorite(fav, { id: 'e1', itemId: () => `x${++n}`, date: '2026-11-10', meal: 'snack', now: '2026-11-10T11:00:00.000Z' })
    expect(e).toMatchObject({ id: 'e1', date: '2026-11-10', meal: 'snack', title: 'קפה עם סוכר', status: 'ok', dirty: true, deleted: false })
    expect(e.totals.calories).toBe(48)
    expect(e.items.map((i) => i.id)).toEqual(['x1', 'x2'])
    expect(e.items[1].grams).toBe(5)
  })

  it('toggle adds newest first and removes by title', () => {
    const a = favoriteFromEntry(coffee, 'f1')
    const b = { ...a, id: 'f2', title: 'תה' }
    let list = toggleFavorite(undefined, a)
    list = toggleFavorite(list, b)
    expect(list.map((f) => f.title)).toEqual(['תה', 'קפה עם סוכר'])
    expect(findFavorite(list, ' קפה עם סוכר')?.id).toBe('f1')
    list = toggleFavorite(list, { ...a, id: 'other' })
    expect(list.map((f) => f.title)).toEqual(['תה'])
  })

  it('keeps at most the limit and drops invalid stored entries', () => {
    const a = favoriteFromEntry(coffee, 'f')
    let list: Favorite[] = []
    for (let i = 0; i < MAX_FAVORITES + 3; i++) list = toggleFavorite(list, { ...a, id: `f${i}`, title: `מנה ${i}` })
    expect(list).toHaveLength(MAX_FAVORITES)
    expect(list[0].title).toBe(`מנה ${MAX_FAVORITES + 2}`)
    expect(favoritesOf([a, { id: 'x' }, null, { ...a, items: [] }, 'no'])).toEqual([a])
    expect(favoritesOf(null)).toEqual([])
    expect(favoritesOf({ a: 1 })).toEqual([])
  })
})
