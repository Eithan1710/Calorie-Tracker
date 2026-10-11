/**
 * Daily energy expenditure — combines Apple Health measurements with the
 * estimate model (energy.ts) without ever counting the same energy twice.
 *
 * Vocabulary (what the UI shows):
 *   resting  — energy the body uses at rest (Apple "Resting Energy" / BMR)
 *   active   — energy above rest from all movement (Apple "Active Energy")
 *   workouts — energy of individual workouts (imported or estimated)
 *   total    — resting + active  (+ manual workouts Apple did not measure)
 *
 * Rules
 * 1. Apple Health mode (the day has Active and/or Resting Energy):
 *      total = resting + active (+ "outside Apple Health" manual workouts)
 *    • Apple's Active Energy already contains every workout recorded by the
 *      watch/phone or written by Strava/Hevy, so workouts are shown but NOT added.
 *      The only exception is a manual workout the user marked as not measured
 *      by Apple Health — its estimate is added (and nothing else).
 *    • No BMR estimate is added on top of Apple's Resting Energy, and no
 *      thermic-effect-of-food add-on: Apple's two numbers are the whole total.
 *    • A component Apple didn't send is filled from the estimate model and
 *      labelled "estimate" (resting → Mifflin-St Jeor BMR; active → daily
 *      movement from steps + workouts).
 *
 * 2. Estimate mode (no Apple energy for the day): the original model —
 *      (BMR + baseline movement + steps + workouts) × 1.10 (TEF) — with imported
 *    workouts counted once, using the workout's own Apple energy when present.
 *
 * 3. Partial days. Apple totals grow during the day. Resting energy accrues at a
 *    near-constant rate, so for an unfinished snapshot the full-day resting value
 *    is projected linearly from the minutes covered (blended with BMR during the
 *    first 4 hours, when the projection is noisy). Active energy is never
 *    projected — future movement is unknown — so "total" for an unfinished day
 *    = projected resting + active so far. That is the same convention the
 *    estimate model already uses (full-day BMR + activity so far), so the goal
 *    logic ("room to eat") behaves the same in both modes. "soFar" is what was
 *    actually measured until the snapshot.
 *
 * 4. Duplicates. The same workout can reach Apple Health twice (watch + Strava)
 *    and the user may also log it by hand. Overlapping workouts of the same kind
 *    are collapsed (the one with measured energy / distance wins); a manual
 *    workout matching an imported one on the same day is marked duplicate.
 *    Steps recorded during runs/walks are removed from the step-based estimate.
 */
import {
  bmrMifflinStJeor, BASELINE_NEAT_FRACTION, estimateWorkoutSteps, stepsNetKcal, TEF_FRACTION, workoutDisplay, workoutEstimate,
  type DailyBurnBreakdown, type ExerciseInput, type ExerciseType, type Profile,
} from './energy'

export interface HealthEnergyDay {
  active_kcal?: number | null
  resting_kcal?: number | null
  /** when the Apple Health snapshot was read (ISO) */
  health_as_of?: string | null
  updated_at?: string
}

export interface DayWorkout {
  id: string
  input: ExerciseInput
  origin: 'manual' | 'apple_health'
  startedAt?: string | null
  endedAt?: string | null
  /** Apple Health workout active energy (kcal above rest) */
  reportedKcal?: number | null
  /** manual workout the user marked as NOT measured by Apple Health */
  outsideHealth?: boolean
  sourceApp?: string | null
}

export interface WorkoutEnergy {
  id: string
  /** kcal above rest; null when there is not enough information */
  kcal: number | null
  low?: number
  high?: number
  kcalSource: 'imported' | 'estimated' | 'none'
  counting: 'included_in_active' | 'added' | 'duplicate'
  duplicateOf?: string
}

export type ComponentSource = 'apple' | 'estimate'

export interface DayEnergy {
  mode: 'health' | 'estimate'
  /** resting energy so far, and projected for the full day */
  resting: { kcal: number; fullDay: number; source: ComponentSource }
  active: { kcal: number; source: ComponentSource }
  /** manual workouts Apple Health did not measure (added on top of Apple's active energy) */
  extra: number
  /** thermic effect of food (estimate mode only) */
  tef: number
  workouts: WorkoutEnergy[]
  /** Σ kcal of the day's distinct workouts where known (informational in Apple mode) */
  workoutKcal: number | null
  /** burned until the snapshot (Apple mode) / the model total (estimate mode) */
  soFar: number
  /** full-day burn used for the balance and goal */
  total: number
  /** the Apple snapshot doesn't cover the whole day yet */
  partial: boolean
  /** minutes of the day covered by the Apple snapshot (null in estimate mode) */
  coverageMinutes: number | null
  asOf: string | null
  /** the estimate model's breakdown (always computed; settings & comparisons) */
  estimate: DailyBurnBreakdown
}

/** a snapshot read at/after 23:00 counts as the full day */
export const COMPLETE_DAY_MINUTES = 23 * 60
/** blend the resting projection with BMR during the first 4 hours */
export const PROJECTION_BLEND_MINUTES = 240

const family = (t: ExerciseType): string => (t === 'run' || t === 'walk' ? 'foot' : t)

function interval(w: DayWorkout): [number, number] | null {
  if (!w.startedAt) return null
  const s = Date.parse(w.startedAt)
  if (Number.isNaN(s)) return null
  const e = w.endedAt ? Date.parse(w.endedAt) : s + (w.input.durationMin ?? 0) * 60_000
  return [s, Math.max(e, s + 60_000)]
}

function richness(w: DayWorkout): number {
  return (w.reportedKcal ? 4 : 0) + (w.input.distanceKm ? 2 : 0) + (w.sourceApp === 'Apple Watch' ? 1 : 0) + (w.input.durationMin ? 1 : 0)
}

/** id → id of the workout it duplicates */
export function findDuplicates(workouts: DayWorkout[]): Map<string, string> {
  const dup = new Map<string, string>()
  const imported = workouts.filter((w) => w.origin === 'apple_health')
  // imported vs imported: overlapping in time, same kind of activity
  for (let i = 0; i < imported.length; i++) {
    for (let j = i + 1; j < imported.length; j++) {
      const a = imported[i], b = imported[j]
      if (dup.has(a.id) || dup.has(b.id) || family(a.input.type) !== family(b.input.type)) continue
      const ia = interval(a), ib = interval(b)
      if (!ia || !ib) continue
      const overlap = Math.min(ia[1], ib[1]) - Math.max(ia[0], ib[0])
      const shorter = Math.min(ia[1] - ia[0], ib[1] - ib[0])
      if (overlap > 0 && overlap >= 0.5 * shorter) {
        const [keep, drop] = richness(a) >= richness(b) ? [a, b] : [b, a]
        dup.set(drop.id, keep.id)
      }
    }
  }
  // manual vs imported, same day: same type and similar duration (or no duration given)
  const takenImports = new Set<string>()
  for (const m of workouts.filter((w) => w.origin === 'manual')) {
    const match = imported.find((w) => {
      if (dup.has(w.id) || takenImports.has(w.id) || w.input.type !== m.input.type) return false
      const dm = m.input.durationMin, di = w.input.durationMin
      if (!dm || !di) return true
      return Math.abs(dm - di) <= 0.35 * Math.max(dm, di)
    })
    if (match) {
      dup.set(m.id, match.id)
      takenImports.add(match.id)
    }
  }
  return dup
}


/** One workout's energy above rest: Apple's own number when present, otherwise the estimate. */
export function workoutEnergy(w: DayWorkout, p: Profile): Pick<WorkoutEnergy, 'kcal' | 'low' | 'high' | 'kcalSource'> & { net: number } {
  if (w.reportedKcal != null && w.reportedKcal > 0) return { kcal: Math.round(w.reportedKcal), net: w.reportedKcal, kcalSource: 'imported' }
  const est = workoutEstimate(w.input, p)
  if (est.net <= 0) return { kcal: null, net: 0, kcalSource: 'none' }
  const d = workoutDisplay(w.input, p)
  return { kcal: d.kcal, low: d.low, high: d.high, net: est.net, kcalSource: 'estimated' }
}

function minutesCovered(date: string, asOf: string | null, now: Date, todayKey: string): number {
  const at = asOf ? new Date(asOf) : null
  if (date < todayKey && (!at || Number.isNaN(at.getTime()))) return 1440
  const ref = at && !Number.isNaN(at.getTime()) ? at : now
  const key = localKey(ref)
  if (key > date) return 1440
  if (key < date) return 0
  return ref.getHours() * 60 + ref.getMinutes()
}

function localKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Full-day resting energy from a partial snapshot. */
export function projectResting(soFar: number, minutes: number, bmr: number): number {
  if (minutes >= COMPLETE_DAY_MINUTES) return soFar
  if (minutes <= 0) return bmr
  const linear = (soFar * 1440) / minutes
  if (minutes >= PROJECTION_BLEND_MINUTES) return linear
  const w = minutes / PROJECTION_BLEND_MINUTES
  return w * linear + (1 - w) * bmr
}

export function dayEnergy(opts: {
  date: string
  profile: Profile
  steps: number
  workouts: DayWorkout[]
  health?: HealthEnergyDay | null
  now?: Date
}): DayEnergy {
  const p = opts.profile
  const now = opts.now ?? new Date()
  const todayKey = localKey(now)
  const dup = findDuplicates(opts.workouts)
  const distinct = opts.workouts.filter((w) => !dup.has(w.id))
  const energies = new Map(opts.workouts.map((w) => [w.id, workoutEnergy(w, p)]))

  const bmr = bmrMifflinStJeor(p)
  const baseline = bmr * BASELINE_NEAT_FRACTION
  const workoutSteps = distinct.reduce((s, w) => s + estimateWorkoutSteps(w.input, p), 0)
  const stepsCounted = Math.max(0, (opts.steps || 0) - workoutSteps)
  const stepsKcal = stepsNetKcal(stepsCounted, p)
  const exerciseNet = distinct.reduce((s, w) => s + energies.get(w.id)!.net, 0)
  const subtotal = bmr + baseline + stepsKcal + exerciseNet
  const estimate: DailyBurnBreakdown = {
    bmr: Math.round(bmr),
    baseline: Math.round(baseline),
    steps: Math.round(stepsKcal),
    stepsCounted,
    exercise: Math.round(exerciseNet),
    tef: Math.round(subtotal * TEF_FRACTION),
    total: Math.round(subtotal * (1 + TEF_FRACTION)),
  }

  const known = distinct.map((w) => energies.get(w.id)!).filter((e) => e.kcal !== null)
  const workoutKcal = known.length ? known.reduce((s, e) => s + (e.kcal ?? 0), 0) : null

  const h = opts.health
  const hasActive = h?.active_kcal != null
  const hasResting = h?.resting_kcal != null

  if (!hasActive && !hasResting) {
    return {
      mode: 'estimate',
      resting: { kcal: estimate.bmr, fullDay: estimate.bmr, source: 'estimate' },
      active: { kcal: Math.round(baseline + stepsKcal + exerciseNet), source: 'estimate' },
      extra: 0,
      tef: estimate.tef,
      workouts: opts.workouts.map((w) => ({ id: w.id, ...pickW(energies.get(w.id)!), counting: dup.has(w.id) ? 'duplicate' : 'added', duplicateOf: dup.get(w.id) })),
      workoutKcal,
      soFar: estimate.total,
      total: estimate.total,
      partial: false,
      coverageMinutes: null,
      asOf: null,
      estimate,
    }
  }

  const asOf = h?.health_as_of ?? (opts.date === todayKey ? h?.updated_at ?? null : null)
  const minutes = minutesCovered(opts.date, asOf, now, todayKey)
  const complete = minutes >= COMPLETE_DAY_MINUTES

  const restingSoFar = hasResting ? h!.resting_kcal! : (bmr * Math.min(minutes, 1440)) / 1440
  const restingFull = hasResting ? projectResting(h!.resting_kcal!, minutes, bmr) : bmr

  let active: number
  let extra = 0
  const lines: WorkoutEnergy[] = []
  if (hasActive) {
    active = h!.active_kcal!
    for (const w of opts.workouts) {
      const e = energies.get(w.id)!
      if (dup.has(w.id)) lines.push({ id: w.id, ...pickW(e), counting: 'duplicate', duplicateOf: dup.get(w.id) })
      else if (w.origin === 'manual' && w.outsideHealth) {
        extra += e.net
        lines.push({ id: w.id, ...pickW(e), counting: 'added' })
      } else lines.push({ id: w.id, ...pickW(e), counting: 'included_in_active' })
    }
  } else {
    active = baseline + stepsKcal + exerciseNet
    for (const w of opts.workouts) {
      const e = energies.get(w.id)!
      lines.push({ id: w.id, ...pickW(e), counting: dup.has(w.id) ? 'duplicate' : 'added', duplicateOf: dup.get(w.id) })
    }
  }

  return {
    mode: 'health',
    resting: { kcal: Math.round(restingSoFar), fullDay: Math.round(restingFull), source: hasResting ? 'apple' : 'estimate' },
    active: { kcal: Math.round(active), source: hasActive ? 'apple' : 'estimate' },
    extra: Math.round(extra),
    tef: 0,
    workouts: lines,
    workoutKcal,
    soFar: Math.round(restingSoFar + active + extra),
    total: Math.round(restingFull + active + extra),
    partial: !complete,
    coverageMinutes: minutes,
    asOf,
    estimate,
  }
}

function pickW(e: ReturnType<typeof workoutEnergy>): Pick<WorkoutEnergy, 'kcal' | 'low' | 'high' | 'kcalSource'> {
  return { kcal: e.kcal, low: e.low, high: e.high, kcalSource: e.kcalSource }
}
