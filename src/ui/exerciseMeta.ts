import type { ExerciseType } from '../domain/energy'

/** Labels + emoji per workout type (shared by the Today screen and the workout sheet). */
export const EXERCISE_META: Record<ExerciseType, { label: string; emoji: string }> = {
  strength: { label: 'כוח', emoji: '🏋️' },
  run: { label: 'ריצה', emoji: '🏃' },
  walk: { label: 'הליכה', emoji: '🚶' },
  cycling: { label: 'אופניים', emoji: '🚴' },
  swimming: { label: 'שחייה', emoji: '🏊' },
  dance: { label: 'ריקוד / סלסה', emoji: '💃' },
  climbing: { label: 'טיפוס / בולדרינג', emoji: '🧗' },
  other: { label: 'קרדיו / אחר', emoji: '⚡' },
}
