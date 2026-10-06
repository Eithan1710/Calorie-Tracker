/**
 * Daily energy expenditure model — deterministic, no AI.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TOTAL = (BMR + BASELINE_NEAT + STEPS_NET + EXERCISE_NET) × (1 + TEF)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. BMR — Mifflin-St Jeor (1990), the equation the Academy of Nutrition and
 *    Dietetics recommends for healthy adults:
 *        men:   10·kg + 6.25·cm − 5·age + 5
 *        women: 10·kg + 6.25·cm − 5·age − 161
 *    BMR is energy for 24 h of complete rest. Everything below is *net* of
 *    rest so resting energy is never counted twice.
 *
 * 2. BASELINE_NEAT — non-ambulatory daily living that a step counter cannot
 *    see (standing, posture, fidgeting, chores, talking): 5% of BMR.
 *    Deliberately small: the classic "sedentary × 1.2" multiplier already
 *    implies ~2–4k steps, and here steps are counted explicitly instead.
 *
 * 3. STEPS_NET — net cost of walking:
 *        distance_km = steps × stride, stride = height × 0.415 (♂) / 0.413 (♀)
 *        kcal = distance_km × kg × 0.5
 *    Gross walking cost is ~0.75–0.8 kcal/kg/km at normal speeds; ~0.3 of
 *    that is resting metabolism already counted in BMR, leaving ≈0.5 net.
 *
 *    Double-counting guard: a watch/phone also counts the steps you take
 *    while running. Steps attributable to a logged run (cadence × minutes, or
 *    distance ÷ running stride) are subtracted before step energy is
 *    computed, because the run is costed separately and more accurately.
 *
 * 4. EXERCISE_NET — each logged workout, net of resting energy:
 *    • Running with a distance: net ≈ 0.95 kcal/kg/km. The gross cost of
 *      running (~1 kcal/kg/km) is roughly speed-independent; subtracting the
 *      resting share during the run leaves ~0.95.
 *      Without a distance: (MET − 1) × kg × hours, MET from pace/intensity.
 *    • Strength / cycling / swimming / other:
 *        (MET − 1) × kg × hours        (Compendium of Physical Activities)
 *      "−1" removes the 1 MET of rest that BMR already covers.
 *    • Walks are NOT a workout type here — walking is captured by steps.
 *
 * 5. TEF — thermic effect of food ≈ 10% of intake. At a near-maintenance
 *    intake (which is the whole goal: a 100–300 kcal deficit), intake ≈
 *    expenditure, so TEF is modelled as +10% of the activity-inclusive total.
 *    This keeps "burned" independent of what you've eaten so the number
 *    doesn't rise just because you logged more food.
 *
 * All outputs are estimates and are rounded to whole kcal.
 */

export type Sex = 'male' | 'female'

export interface Profile {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
}

export type ExerciseType = 'run' | 'strength' | 'cycling' | 'swimming' | 'other'
export type Intensity = 'low' | 'moderate' | 'high'

export interface ExerciseInput {
  type: ExerciseType
  durationMin?: number
  distanceKm?: number
  intensity?: Intensity
}

export const BASELINE_NEAT_FRACTION = 0.05
export const TEF_FRACTION = 0.1
export const WALK_NET_KCAL_PER_KG_KM = 0.5
export const RUN_NET_KCAL_PER_KG_KM = 0.95
export const RUN_CADENCE_SPM = 160

/**
 * Gross MET values, conservative end of the Compendium of Physical Activities
 * (Ainsworth et al., 2011; Herrmann et al., 2024 update). Strength values are
 * session averages — they already include rest between sets.
 */
export const METS: Record<Exclude<ExerciseType, 'run'>, Record<Intensity, number>> = {
  // 02054 multiple exercises 8–15 reps ≈ 3.5; 02052 squats/explosive ≈ 5.0
  strength: { low: 3.0, moderate: 3.5, high: 5.0 },
  // 01010 leisure <16 km/h ≈ 4.0; 01030 19–22 km/h ≈ 8.0
  cycling: { low: 4.0, moderate: 6.8, high: 8.0 },
  // 18310 leisurely ≈ 6.0; 18240 freestyle moderate ≈ 5.8; 18230 vigorous ≈ 9.8
  swimming: { low: 5.0, moderate: 6.0, high: 8.3 },
  // generic sport / HIIT / classes
  other: { low: 3.5, moderate: 5.0, high: 7.0 },
}

/** Running MET by speed (Compendium 12xxx codes), used only when no distance is given. */
export function runMetForSpeed(kmh: number): number {
  const table: [number, number][] = [
    [6.4, 6.0],
    [8.0, 8.3],
    [9.7, 9.8],
    [10.8, 10.5],
    [11.3, 11.0],
    [12.1, 11.8],
    [12.9, 11.8],
    [13.8, 12.3],
    [14.5, 12.8],
    [16.1, 14.5],
    [17.7, 16.0],
    [19.3, 19.0],
  ]
  if (kmh <= table[0][0]) return table[0][1]
  for (let i = 1; i < table.length; i++) {
    const [s1, m1] = table[i]
    const [s0, m0] = table[i - 1]
    if (kmh <= s1) return m0 + ((kmh - s0) / (s1 - s0)) * (m1 - m0)
  }
  return table[table.length - 1][1]
}

const RUN_INTENSITY_MET: Record<Intensity, number> = { low: 8.0, moderate: 9.8, high: 11.5 }

export function bmrMifflinStJeor(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age
  return base + (p.sex === 'male' ? 5 : -161)
}

export function strideMeters(p: Pick<Profile, 'heightCm' | 'sex'>): number {
  return (p.heightCm / 100) * (p.sex === 'male' ? 0.415 : 0.413)
}

/** Running stride is much longer than walking stride (~1.6× walking). */
function runStrideMeters(p: Pick<Profile, 'heightCm' | 'sex'>): number {
  return strideMeters(p) * 1.6
}

/** Estimated steps a step counter would register during this workout. */
export function estimateWorkoutSteps(ex: ExerciseInput, p: Profile): number {
  if (ex.type !== 'run') return 0
  if (ex.durationMin && ex.durationMin > 0) return Math.round(ex.durationMin * RUN_CADENCE_SPM)
  if (ex.distanceKm && ex.distanceKm > 0) return Math.round((ex.distanceKm * 1000) / runStrideMeters(p))
  return 0
}

export function stepsNetKcal(steps: number, p: Profile): number {
  if (!Number.isFinite(steps) || steps <= 0) return 0
  const km = (steps * strideMeters(p)) / 1000
  return km * p.weightKg * WALK_NET_KCAL_PER_KG_KM
}

export function paceSecPerKm(ex: ExerciseInput): number | null {
  if (!ex.distanceKm || !ex.durationMin || ex.distanceKm <= 0 || ex.durationMin <= 0) return null
  return (ex.durationMin * 60) / ex.distanceKm
}

/** Net (above-resting) kcal for a single workout. Returns 0 for incomplete input. */
export function exerciseNetKcal(ex: ExerciseInput, p: Profile): number {
  const kg = p.weightKg
  if (ex.type === 'run') {
    if (ex.distanceKm && ex.distanceKm > 0) {
      return ex.distanceKm * kg * RUN_NET_KCAL_PER_KG_KM
    }
    if (ex.durationMin && ex.durationMin > 0) {
      const met = RUN_INTENSITY_MET[ex.intensity ?? 'moderate']
      return Math.max(0, met - 1) * kg * (ex.durationMin / 60)
    }
    return 0
  }
  if (!ex.durationMin || ex.durationMin <= 0) return 0
  const met = METS[ex.type][ex.intensity ?? 'moderate']
  return Math.max(0, met - 1) * kg * (ex.durationMin / 60)
}

export interface DailyBurnBreakdown {
  bmr: number
  baseline: number
  steps: number
  /** steps actually costed after removing workout steps */
  stepsCounted: number
  exercise: number
  tef: number
  total: number
}

export function dailyBurn(p: Profile, steps: number, exercises: ExerciseInput[]): DailyBurnBreakdown {
  const bmr = bmrMifflinStJeor(p)
  const baseline = bmr * BASELINE_NEAT_FRACTION
  const workoutSteps = exercises.reduce((s, ex) => s + estimateWorkoutSteps(ex, p), 0)
  const stepsCounted = Math.max(0, (steps || 0) - workoutSteps)
  const stepsKcal = stepsNetKcal(stepsCounted, p)
  const exercise = exercises.reduce((s, ex) => s + exerciseNetKcal(ex, p), 0)
  const subtotal = bmr + baseline + stepsKcal + exercise
  const tef = subtotal * TEF_FRACTION
  return {
    bmr: Math.round(bmr),
    baseline: Math.round(baseline),
    steps: Math.round(stepsKcal),
    stepsCounted,
    exercise: Math.round(exercise),
    tef: Math.round(tef),
    total: Math.round(subtotal + tef),
  }
}

/** Calories shown on a single workout card: net estimate rounded to 5 (it's an estimate). */
export function workoutDisplayKcal(ex: ExerciseInput, p: Profile): number {
  return Math.round(exerciseNetKcal(ex, p) / 5) * 5
}

export function isValidProfile(p: Partial<Profile> | null | undefined): p is Profile {
  return (
    !!p &&
    (p.sex === 'male' || p.sex === 'female') &&
    typeof p.age === 'number' && p.age >= 14 && p.age <= 100 &&
    typeof p.heightCm === 'number' && p.heightCm >= 120 && p.heightCm <= 230 &&
    typeof p.weightKg === 'number' && p.weightKg >= 35 && p.weightKg <= 250
  )
}
