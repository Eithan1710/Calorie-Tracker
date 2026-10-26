-- מאזן — weekly work schedule, activity types and a per-day energy breakdown (additive, safe to re-run).
--
-- mz_profiles.routine_schedule  the user's weekly work hours with the phone left aside, e.g.
--   {"days":[0,1,2,3,4],"start":"09:30","end":"18:00","phoneBreaks":[["12:00","13:00"]]}
--   (null = none). The app estimates those hours (src/domain/routine.ts); Apple Health covers the rest.
-- mz_exercises.type             + 'dance' (salsa…) and 'climbing' (bouldering…), for the daily check.
-- mz_daily_summaries.energy_breakdown  what each day's burn was made of: Apple Health parts vs
--   estimated parts, minutes estimated because the phone was away, ± and confidence — stored so
--   similar days can be compared later. Derived data; the app rewrites it.
-- Row-level security is unchanged on all three tables (own rows only).
alter table public.mz_profiles add column if not exists routine_schedule jsonb;
alter table public.mz_profiles drop constraint if exists mz_profiles_routine_schedule_check;
alter table public.mz_profiles add constraint mz_profiles_routine_schedule_check
  check (routine_schedule is null or coalesce(jsonb_typeof(routine_schedule) = 'object'
         and jsonb_typeof(routine_schedule -> 'days') = 'array'
         and jsonb_typeof(routine_schedule -> 'start') = 'string'
         and jsonb_typeof(routine_schedule -> 'end') = 'string'
         and jsonb_typeof(routine_schedule -> 'phoneBreaks') = 'array', false));

alter table public.mz_exercises drop constraint if exists mz_exercises_type_check;
alter table public.mz_exercises add constraint mz_exercises_type_check
  check (type in ('run', 'walk', 'strength', 'cycling', 'swimming', 'dance', 'climbing', 'other'));

alter table public.mz_daily_summaries add column if not exists energy_breakdown jsonb;
