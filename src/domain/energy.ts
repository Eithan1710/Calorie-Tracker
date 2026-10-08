/**
 * Energy expenditure engine — the single source of truth for every calorie
 * *burned* number in the app (BMR, daily activity, workouts, daily total).
 * Deterministic, no AI. UI components only call into this module.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TOTAL = (BMR + BASELINE_NEAT + STEPS_NET + EXERCISE_NET) × (1 + TEF)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. BMR — Mifflin-St Jeor (1990), the equation the Academy of Nutrition and
 *    Dietetics recommends for healthy adults (uses sex, age, height, weight):
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
 *    Double-counting guard: steps a phone/watch records *during* a logged run
 *    or walk are subtracted first, because that workout is costed separately.
 *
 * 4. EXERCISE_NET — each logged workout (see `workoutEstimate`):
 *
 *      gross kcal/min = MET × 3.5 × kg / 200          (standard MET equation:
 *                                                      1 MET = 3.5 ml O₂/kg/min,
 *                                                      ≈5 kcal per litre O₂)
 *      resting kcal/min = BMR / 1440                   (this person's own rest,
 *                                                      from age/sex/height/weight)
 *      net = (gross − resting) × minutes
 *
 *    Subtracting the person's *own* resting rate (instead of a generic 1 MET)
 *    is the correction recommended with the Compendium for people whose RMR
 *    differs from the 3.5 ml/kg/min reference (older, female or larger
 *    adults usually have a lower RMR per kg).
 *
 *    MET values come from the 2024 Adult Compendium of Physical Activities
 *    (Herrmann et al., J Sport Health Sci 2024; codes noted next to each value).
 *
 *    Strength training is costed per *session*, not per minute of lifting:
 *    the Compendium resistance-training codes are session averages that
 *    already include rest between sets, so "75 minutes in the gym" is never
 *    treated as 75 minutes of continuous vigorous work. Training density is
 *    taken into account through the rest style:
 *       standard rests (1–3 min):  light 3.5 (02054) · moderate 5.0 (02052) · vigorous 6.0 (02050)
 *       short rests / supersets / circuit:
 *                                  light 3.5 (02034) · moderate 5.8 (02055) · vigorous 7.5 (02040)
 *
 *    Two optional strength inputs refine this, each deliberately bounded so
 *    neither can dominate the time-based estimate:
 *    • Muscle groups worked → active-muscle-mass factor on the MET.
 *      Oxygen uptake in resistance exercise scales with the muscle mass
 *      involved (lower-body / multi-joint work costs markedly more than
 *      arm or core work at the same effort):
 *        legs or full body → ×1.10 · back or chest → ×1.00
 *        only shoulders / arms / core → ×0.90 · not given → ×1.00
 *    • Total volume lifted (Σ kg × reps) → the external mechanical work:
 *        work = volume × g × 0.5 m (average vertical travel per rep)
 *        metabolic cost = work ÷ 0.20 (gross muscular efficiency) ÷ 4184 J/kcal
 *        ≈ 0.0059 kcal per kg lifted  → 8,000 kg ≈ +47 kcal
 *      Load on its own is a poor predictor of energy cost (heavier sets mean
 *      fewer reps and longer rests), which is why it is an add-on to the
 *      session estimate and not its basis.
 *
 *    Running with a distance: gross ≈ 1.0 kcal/kg/km, roughly independent of
 *    speed (Margaria 1963; ACSM). Net = gross − resting × minutes.
 *
 * 5. TEF — thermic effect of food ≈ 10% of intake. At a near-maintenance
 *    intake intake ≈ expenditure, so TEF is modelled as +10% of the
 *    activity-inclusive total. This keeps "burned" independent of what you've
 *    eaten so the number doesn't rise just because you logged more food.
 *
 * Uncertainty: MET-based predictions for an individual are typically off by
 * 20–30% (Kozey et al. 2010; Compendium guidance). Every workout estimate
 * therefore carries a range, and display values are rounded to 10 kcal so the
 * UI never implies more precision than the method has.
 */

export type Sex = 'male' | 'female'

export interface Profile {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
}

export type ExerciseType = 'run' | 'walk' | 'strength' | 'cycling' | 'swimming' | 'other'
export type Intensity = 'low' | 'moderate' | 'high'
/** Training density for strength sessions. */
export type RestStyle = 'standard' | 'short'

/** Muscle groups for a strength session. */
export type MuscleGroup = 'legs' | 'back' | 'chest' | 'shoulders' | 'arms' | 'core' | 'full_body'

/** One exercise inside a strength workout (older entries; tracking only). */
export interface Lift {
  id: string
  name: string
  weight_kg?: number
  sets?: number
  reps?: number
}

export interface ExerciseInput {
  type: ExerciseType
  durationMin?: number
  distanceKm?: number
  intensity?: Intensity
  rest?: RestStyle
  /** strength: muscle groups worked (active-muscle-mass factor) */
  muscles?: MuscleGroup[]
  /** strength: total volume lifted in the session, kg (Σ weight × reps) */
  volumeKg?: number
  /** older per-exercise entries; not used by the energy model */
  lifts?: Lift[]
}

/** Active-muscle-mass factor applied to the strength MET (see header). */
export function muscleMassFactor(muscles: MuscleGroup[] | undefined): number {
  if (!muscles?.length) return 1
  if (muscles.includes('legs') || muscles.includes('full_body')) return 1.1
  if (muscles.includes('back') || muscles.includes('chest')) return 1.0
  return 0.9
}

/** Mechanical work of lifting 1 kg once, as metabolic kcal: 9.81 × 0.5 m ÷ 0.20 efficiency ÷ 4184. */
export const KCAL_PER_KG_LIFTED = (9.81 * 0.5) / 0.2 / 4184
export const MAX_VOLUME_KG = 200_000

export function volumeKcal(volumeKg: number | undefined): number {
  if (!volumeKg || !Number.isFinite(volumeKg) || volumeKg <= 0) return 0
  return Math.min(volumeKg, MAX_VOLUME_KG) * KCAL_PER_KG_LIFTED
}

export const BASELINE_NEAT_FRACTION = 0.05
export const TEF_FRACTION = 0.1
export const WALK_NET_KCAL_PER_KG_KM = 0.5
export const RUN_GROSS_KCAL_PER_KG_KM = 1.0
export const RUN_CADENCE_SPM = 160
export const WALK_CADENCE_SPM = 110
/** assumed pace when a run has a distance but no time (only used to subtract resting energy) */
const ASSUMED_RUN_MIN_PER_KM = 6

/** Gross MET values — 2024 Adult Compendium of Physical Activities. */
export const STRENGTH_METS: Record<RestStyle, Record<Intensity, number>> = {
  // 02054 weight training, multiple exercises 8–15 reps · 02052 squats/deadlifts · 02050 vigorous lifting / bodybuilding
  standard: { low: 3.5, moderate: 5.0, high: 6.0 },
  // 02034 circuit training, light · 02055 circuit resistance training, reciprocal supersets · 02040 circuit (kettlebells), vigorous
  short: { low: 3.5, moderate: 5.8, high: 7.5 },
}

export const METS: Record<Exclude<ExerciseType, 'run' | 'strength'>, Record<Intensity, number>> = {
  // Compendium walking codes (17xxx): ~3.2 km/h slow · ~4.5–5 km/h moderate · ~6 km/h brisk
  walk: { low: 2.8, moderate: 3.5, high: 4.8 },
  // Compendium bicycling codes (01xxx): leisure <16 km/h ≈ 4.0 · 16–19 km/h ≈ 6.8 · 19–22 km/h ≈ 8.0
  cycling: { low: 4.0, moderate: 6.8, high: 8.0 },
  // 18310 leisurely ≈ 6.0; 18240 freestyle moderate ≈ 5.8; 18230 vigorous ≈ 9.8 (conservative)
  swimming: { low: 5.0, moderate: 6.0, high: 8.3 },
  // generic cardio / classes: 02048 elliptical moderate 5.0 · 02210 HIIT moderate 7.0
  other: { low: 3.5, moderate: 5.0, high: 7.0 },
}

/** Relative uncertainty (±) of each method, used for the displayed range. */
const UNCERTAINTY: Record<ExerciseType, number> = {
  run: 0.2, // only when costed from time; with a distance → RUN_DISTANCE_UNCERTAINTY
  walk: 0.2,
  strength: 0.3,
  cycling: 0.25,
  swimming: 0.25,
  other: 0.3,
}
const RUN_DISTANCE_UNCERTAINTY = 0.1

/** Running MET by speed (Compendium 12xxx codes). */
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

/** Running MET when only time is known, by perceived pace. */
const RUN_INTENSITY_MET: Record<Intensity, number> = { low: 8.0, moderate: 9.8, high: 11.5 }

export function bmrMifflinStJeor(p: Profile): number {
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age
  return base + (p.sex === 'male' ? 5 : -161)
}

/** This person's resting energy per minute. */
export function restingKcalPerMin(p: Profile): number {
  return bmrMifflinStJeor(p) / 1440
}

/** Standard MET equation: kcal/min = MET × 3.5 × kg / 200. */
export function metKcalPerMin(met: number, weightKg: number): number {
  return (met * 3.5 * weightKg) / 200
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
  if (ex.type === 'run') {
    if (ex.durationMin && ex.durationMin > 0) return Math.round(ex.durationMin * RUN_CADENCE_SPM)
    if (ex.distanceKm && ex.distanceKm > 0) return Math.round((ex.distanceKm * 1000) / runStrideMeters(p))
  }
  if (ex.type === 'walk') {
    if (ex.distanceKm && ex.distanceKm > 0) return Math.round((ex.distanceKm * 1000) / strideMeters(p))
    if (ex.durationMin && ex.durationMin > 0) return Math.round(ex.durationMin * WALK_CADENCE_SPM)
  }
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

/** The MET this workout is costed at (null when costed by distance or incomplete). */
export function workoutMet(ex: ExerciseInput): number | null {
  const intensity = ex.intensity ?? 'moderate'
  switch (ex.type) {
    case 'run':
      return RUN_INTENSITY_MET[intensity]
    case 'strength':
      return STRENGTH_METS[ex.rest ?? 'standard'][intensity] * muscleMassFactor(ex.muscles)
    default:
      return METS[ex.type][intensity]
  }
}

export interface WorkoutEstimate {
  /** kcal above rest — what the daily total adds */
  net: number
  /** total kcal during the workout, including resting energy */
  gross: number
  /** plausible range of `net` */
  low: number
  high: number
  met: number | null
  method: 'met' | 'run_distance'
  /** part of `net` that comes from the total volume lifted (strength only) */
  fromVolume: number
}

const EMPTY: WorkoutEstimate = { net: 0, gross: 0, low: 0, high: 0, met: null, method: 'met', fromVolume: 0 }

/** Full estimate for one workout. Returns zeros for incomplete input. */
export function workoutEstimate(ex: ExerciseInput, p: Profile): WorkoutEstimate {
  const kg = p.weightKg
  const restPerMin = restingKcalPerMin(p)
  const minutes = ex.durationMin && ex.durationMin > 0 ? ex.durationMin : 0

  let gross = 0
  let restDuring = 0
  let method: WorkoutEstimate['method'] = 'met'
  let met: number | null = null
  let uncertainty = UNCERTAINTY[ex.type]

  if (ex.type === 'run' && ex.distanceKm && ex.distanceKm > 0) {
    method = 'run_distance'
    gross = ex.distanceKm * kg * RUN_GROSS_KCAL_PER_KG_KM
    restDuring = restPerMin * (minutes || ex.distanceKm * ASSUMED_RUN_MIN_PER_KM)
    uncertainty = RUN_DISTANCE_UNCERTAINTY
  } else {
    if (!minutes) return EMPTY
    met = workoutMet(ex)!
    gross = metKcalPerMin(met, kg) * minutes
    restDuring = restPerMin * minutes
  }

  const fromVolume = ex.type === 'strength' ? volumeKcal(ex.volumeKg) : 0
  const net = Math.max(0, gross - restDuring) + fromVolume
  return {
    net,
    gross: gross + fromVolume,
    low: net * (1 - uncertainty),
    high: net * (1 + uncertainty),
    met,
    method,
    fromVolume,
  }
}

/** Net (above-resting) kcal for a single workout. */
export function exerciseNetKcal(ex: ExerciseInput, p: Profile): number {
  return workoutEstimate(ex, p).net
}

const round10 = (n: number) => Math.round(n / 10) * 10

/** What a workout card shows: net estimate and range, rounded to 10 kcal (it's an estimate). */
export function workoutDisplay(ex: ExerciseInput, p: Profile): { kcal: number; low: number; high: number; gross: number; fromVolume: number } {
  const e = workoutEstimate(ex, p)
  return { kcal: round10(e.net), low: round10(e.low), high: round10(e.high), gross: round10(e.gross), fromVolume: Math.round(e.fromVolume / 5) * 5 }
}

export function workoutDisplayKcal(ex: ExerciseInput, p: Profile): number {
  return workoutDisplay(ex, p).kcal
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

export function isValidProfile(p: Partial<Profile> | null | undefined): p is Profile {
  return (
    !!p &&
    (p.sex === 'male' || p.sex === 'female') &&
    typeof p.age === 'number' && p.age >= 14 && p.age <= 100 &&
    typeof p.heightCm === 'number' && p.heightCm >= 120 && p.heightCm <= 230 &&
    typeof p.weightKg === 'number' && p.weightKg >= 35 && p.weightKg <= 250
  )
}
