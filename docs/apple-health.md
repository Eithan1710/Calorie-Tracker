# Apple Health: energy and workouts

## What is technically possible (checked October 2026)

* **A website / PWA cannot read HealthKit.** Apple gives HealthKit only to native apps; Safari and
  home-screen web apps have no API for it. Everything below goes through Apple's **Shortcuts** app,
  which runs on the phone, reads Health, and posts the numbers to the `health-ingest` function.
* **Shortcuts → Find Health Samples** reads quantity types including **Steps**, **Active Energy** and
  **Resting Energy**; grouped/summed per day they give the same daily totals the Health app shows
  ([example](https://medium.com/@katie.reagan.patton/ios-shortcut-energy-balance-336fcc61d5eb)).
* **Workouts:** Apple's documentation doesn't list which types *Find Health Samples* can read, and
  reports conflict on whether "Workouts" is one of them (it was missing in older iOS versions —
  [MPU forum](https://talk.macpowerusers.com/t/struggling-to-extract-workout-data-from-watch-via-shortcuts/39152)).
  The backend accepts workouts when the phone can send them; nothing depends on it, because:
* **Apple's Active Energy already contains the workouts.** Strava writes its activities to Health as
  workouts with distance, duration and calories ([Strava → Apple Health](https://www.sonarhealth.co/blog/sync-strava-to-apple-health/));
  Hevy writes strength workouts with an active-calorie estimate when "Active Calories" write access is
  on ([Hevy help](https://help.hevyapp.com/hc/en-us/articles/34462684813079-How-to-see-the-calories-burned-in-a-workout-Apple-iOS-Android));
  the watch records its own. Adding workout calories on top of Active Energy double-counts — the
  same bug Cronometer users report ([forum](https://forums.cronometer.com/discussion/3366/apple-calorie-duplication)).

## How the numbers are combined (`src/domain/expenditure.ts`)

| | Apple Health data for the day | No Apple data |
|---|---|---|
| Resting | Apple Resting Energy | BMR (Mifflin-St Jeor) |
| Active | Apple Active Energy (includes workouts) | baseline movement + steps + workouts (MET) |
| Workouts | shown, **not added** (inside Active) — except a manual one marked "not measured by Apple Health" | added once (Apple workout energy if imported, else MET estimate) |
| Total | resting + active | (resting + active) × 1.10 (food digestion) |

* **Partial day.** Apple totals grow during the day. The card shows what was burned *so far*;
  the balance uses resting projected to 24 h (linear from the minutes covered by the snapshot,
  blended with BMR in the first 4 hours) + active so far — the same convention as the estimate model.
  A past day whose last snapshot was before 23:00 is marked partial.
* **A component Apple didn't send** is filled from the estimate model and labelled "הערכה".
* **Duplicates.** Overlapping workouts of the same kind (watch + Strava) count once (the record with
  measured energy/distance wins); a manual entry matching an imported workout is marked duplicate.
* **Workout estimates** (fallback): MET × 3.5 × kg ÷ 200 per minute minus the person's own resting
  rate (2024 Adult Compendium values); running with a distance ≈ 1 kcal/kg/km; strength by session
  MET × duration (volume lifted only adds the small mechanical work, ~0.006 kcal/kg). Shown with a
  range and "≈"; without a duration there is no number ("אין מספיק נתונים").

## Sync guarantees (`mz_ingest_health`, `_shared/healthIngest.ts`)

* Daily totals are **snapshots**: a newer snapshot replaces an older one; an older one arriving late
  is ignored (`health_as_of`). Fields not sent are left unchanged. Re-running is harmless.
* "Today" is the user's own day (profile time zone). Future dates, days older than 14 days, and
  snapshots read before the day they describe are rejected. Out-of-range values are ignored.
* Workouts get a stable id from (account, type, start minute, source app): re-sending updates,
  never duplicates; a workout the user deleted is not brought back; user edits are kept. A workout
  crossing midnight belongs to the day it started.
* Personal token (only its SHA-256 is stored), members only, service-role function not callable by
  users. Structured logs per request in the function logs.

## Shortcut (one automation, a few times a day + 23:50)

1. Find Health Samples — Steps — Start Date is Today → Calculate Statistics → Sum
2. Same with **Active Energy** → Sum
3. Same with **Resting Energy** → Sum
4. Current Date → Format Date → ISO 8601 (with time)
5. Get Contents of URL — POST `…/functions/v1/health-ingest`, header
   `Authorization: Bearer <token>`, JSON: `steps`, `active_kcal`, `resting_kcal` (Numbers), `as_of` (Text)
6. *(optional)* Find Health Samples — Workouts — today → Repeat with Each → Dictionary
   (`type`, `start`, `end`, `duration_min`, `distance_km`, `kcal`, `source`) → Add to Variable →
   JSON field `workouts` (Array).

Numbers may arrive as "7,842", "512.3 kcal", "5.1 km", "00:32:10"; kJ is converted.
