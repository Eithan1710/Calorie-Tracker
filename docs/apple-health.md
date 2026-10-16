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
| Food digestion | from the macros eaten: 25% of protein kcal + 7.5% of carbs + 2% of fat (Apple doesn't count it) | 10% of the day's burn |
| Total | resting + active + digestion | (resting + active) × 1.10 |

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

## Sync guarantees (`mz_ingest_health`, `mz_ingest_health_samples`, `_shared/healthIngest.ts`)

* **Calendar days are Asia/Jerusalem days** (DST-aware; override with the `MZ_DAY_TZ` function secret).
  `date` accepts `YYYY-MM-DD`, `today` or `yesterday`.
* **Aggregate totals** (`steps`, `active_kcal`, `resting_kcal`) are **snapshots of one day** (`date`,
  default today): a newer snapshot replaces an older one; an older one arriving late is ignored
  (`health_as_of`). Fields not sent are left unchanged. Re-running is harmless. Limitation: an
  aggregate carries no timestamps, so the server cannot split it between days — the last
  "since midnight" snapshot before 00:00 is all it will ever know about that day unless the
  Shortcut re-sends that day explicitly (`date: "yesterday"`) or sends samples.
* **Timestamped samples** (`active_samples`, `resting_samples`: raw Health samples or Shortcuts'
  Group-by-Day/Hour buckets, each `{start, end, kcal, source?, id?}`) are filed under the local day
  of their **start**, so one request can carry yesterday and today. Each sample has a stable key —
  its own `id` if sent, else `sha256(kind|start|end|source)` (never the calorie value). Re-sending
  updates the row; a stored sample of the **same source** that overlaps a new one under another key
  (the current bucket grew and its end moved) is replaced. Day totals are **recomputed** from the
  stored samples after every request, never incremented. A day that has samples ignores aggregate
  `active_kcal` / `resting_kcal` for that kind (steps and the other kind still apply). Samples older
  than 35 days are purged.
* Validation: future dates, days older than 14 days, snapshots read before the day they describe,
  samples with missing/invalid/reversed timestamps, spans > 25 h, or invalid energy are rejected and
  **counted** in the response (`samples.active.invalid_timestamp`, …) and in the function logs.
* Workouts get a stable id from (account, type, start minute, source app): re-sending updates,
  never duplicates; a workout the user deleted is not brought back; user edits are kept. A workout
  crossing midnight belongs to the day it started.
* Personal token (only its SHA-256 is stored), members only, service-role functions not callable by
  users. Structured JSON logs per request in the function logs.

## Shortcut (one automation, every 15 minutes)

Recommended — yesterday + today as day buckets (accurate across midnight):

1. **Current Date** → **Adjust Date**: Subtract 1 day → **Adjust Date**: Get Start of Day → (Adjusted Date)
2. **Find Health Samples** where Type is **Active Energy**, Start Date **is after** Adjusted Date,
   Source is *your watch/phone* · Group by **Day** · Fill Missing off · Unit cal
3. **Repeat with Each** → **Dictionary** `start` = Repeat Item › Start Date (format ISO 8601),
   `end` = Repeat Item › End Date (ISO 8601), `kcal` = Repeat Item › Value (Number) → **Add to Variable** `ActiveDays`
4. Steps / Resting Energy as before (Start Date is today, Group by Day, Sum)
5. **Get Contents of URL** — POST `…/functions/v1/health-ingest`, header `Authorization: Bearer <token>`,
   JSON: `steps` (Number), `resting_kcal` (Number), `active_samples` (Array → `ActiveDays`)

Still supported: `{"steps", "active_kcal", "resting_kcal", "as_of", "date"}` aggregates and `workouts`.

### Per-day totals as text (the most accurate — overwrites those days)

For each kind (Active Energy, Resting Energy, Steps): **Find Health Samples** where Start Date is in the last
N days · **Group by Day** · then for each group a **Dictionary** `{"date": <group date>, "active_kcal" |
"resting_kcal" | "steps": <Sum>}` → **Add to Variable** `Days`. Then **Text** with `Days` and **Get Contents of
URL** — POST, header `Authorization: Bearer <token>`, Request Body **File** = that Text.

```
{ "date" : "15 Oct 2026 at 0:06", "active_kcal" : "421.9529999999997" }
{ "date" : "13 Oct 2026 at 0:41", "resting_kcal" : "1557.049" }
{ "date" : "2026-10-16", "steps" : 18 }
```

- Each object is the full total of that kind for that calendar day and **replaces** what was stored for it
  (snapshots, sample sums, older totals). Kinds that aren't sent are left alone.
- Only the day of `date` counts (the time is the first sample of the group). Shortcuts' English and Hebrew
  formats, `YYYY-MM-DD`, ISO 8601, `today` / `yesterday` all work; numbers may be strings.
- Objects may be back to back, one per line, comma-separated, a JSON array, or `{"days": [...]}`.
- A total read after its day ended is **final**: later snapshots and sample sums never replace it, only another
  day total. Today's total is partial, so a newer reading of today may still update it.
- Up to 90 days back, 500 objects per request; future days and unreadable dates are skipped and listed in
  `warnings` in the response (`{"ok": true, "mode": "daily", "days": {...}}`).
