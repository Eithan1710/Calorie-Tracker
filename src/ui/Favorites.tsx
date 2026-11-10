import { Star } from 'lucide-react'
import { deleteFood, getState, updateSettings, upsertFood, useStore } from '../data/store'
import { mealForTime, type FoodEntry, type Meal } from '../data/types'
import { entryFromFavorite, favoriteFromEntry, findFavorite, toggleFavorite, type Favorite } from '../domain/favorites'
import { toDateKey } from '../domain/goal'
import { pushProfile } from '../services/sync'
import { newId } from '../../supabase/functions/_shared/nutrition.ts'
import { showToast } from './toast'
import { fmt, haptic, KCAL } from './format'

/** Logs a copy of a favourite on that day (today: the meal of the current hour; another day: a snack). */
export function logFavorite(fav: Favorite, date: string, meal?: Meal) {
  const now = new Date()
  const entry = entryFromFavorite(fav, {
    id: newId(),
    itemId: newId,
    date,
    meal: meal ?? (date === toDateKey(now) ? mealForTime(now) : 'snack'),
    now: now.toISOString(),
  })
  upsertFood(entry)
  haptic(18)
  showToast(`${entry.title} · ${fmt(entry.totals.calories)} ${KCAL}`, { label: 'ביטול', run: () => deleteFood(entry.id) })
  return entry
}

/** Adds the meal to the favourites, or removes it (matched by title). */
export function toggleFavoriteEntry(entry: Pick<FoodEntry, 'title' | 'emoji' | 'items' | 'totals' | 'confidence' | 'provider'>) {
  const list = getState().settings.favorites
  const was = Boolean(findFavorite(list, entry.title))
  updateSettings({ favorites: toggleFavorite(list, favoriteFromEntry(entry, newId())) })
  void pushProfile()
  haptic()
  showToast(was ? 'הוסר מהמועדפים' : 'נוסף למועדפים — נגיעה אחת במסך היום')
}

export function useFavorites(): Favorite[] {
  return useStore((s) => s.settings.favorites) ?? []
}

/** One-tap chips of the favourite meals. Nothing when there are none. */
export function FavoritesBar({ date, meal, onLogged, className = '' }: { date: string; meal?: Meal; onLogged?: () => void; className?: string }) {
  const favorites = useFavorites()
  if (!favorites.length) return null
  return (
    <div className={className} data-testid="favorites">
      <p className="mb-2 flex items-center gap-1 text-sm font-medium text-ink-3">
        <Star className="size-3.5 fill-current text-warn" aria-hidden /> מועדפים · נגיעה אחת
      </p>
      <div className="flex flex-wrap gap-2">
        {favorites.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              logFavorite(f, date, meal)
              onLogged?.()
            }}
            aria-label={`הוסף ${f.title}`}
            className="pressable flex min-h-11 max-w-full items-center gap-1.5 rounded-full bg-surface-2 px-3.5 text-[15px]"
          >
            <span aria-hidden>{f.emoji}</span>
            <span className="truncate">{f.title}</span>
            <span className="num shrink-0 text-ink-3">{fmt(f.totals.calories)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
