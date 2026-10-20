-- מאזן — custom daily calorie range next to the fitness phase (additive, safe to re-run).
--
-- The phase (recomp / cut / maintain / lean bulk) keeps setting the automatic deficit band
-- (deficit_min / deficit_max, unchanged). New, per account:
--   goal_phase    the chosen phase, stored explicitly (older rows: null → derived from the band)
--   calorie_mode  'auto' = the band against the day's burn (default, today's behaviour)
--                 'custom' = the fixed intake range below
--   kcal_min/max  the user's own daily intake range, kept when the phase or mode changes
-- Row-level security on mz_profiles is unchanged (own row only).
alter table public.mz_profiles add column if not exists goal_phase text;
alter table public.mz_profiles add column if not exists calorie_mode text not null default 'auto';
alter table public.mz_profiles add column if not exists kcal_min smallint;
alter table public.mz_profiles add column if not exists kcal_max smallint;

alter table public.mz_profiles drop constraint if exists mz_profiles_goal_phase_check;
alter table public.mz_profiles add constraint mz_profiles_goal_phase_check
  check (goal_phase is null or goal_phase in ('recomp', 'cut', 'maintain', 'gain'));
alter table public.mz_profiles drop constraint if exists mz_profiles_calorie_mode_check;
alter table public.mz_profiles add constraint mz_profiles_calorie_mode_check
  check (calorie_mode in ('auto', 'custom'));
alter table public.mz_profiles drop constraint if exists mz_profiles_kcal_range_check;
alter table public.mz_profiles add constraint mz_profiles_kcal_range_check
  check ((kcal_min is null and kcal_max is null)
      or (kcal_min between 500 and 8000 and kcal_max between 500 and 8000 and kcal_max > kcal_min));
-- custom mode needs a range
alter table public.mz_profiles drop constraint if exists mz_profiles_custom_needs_range_check;
alter table public.mz_profiles add constraint mz_profiles_custom_needs_range_check
  check (calorie_mode = 'auto' or kcal_min is not null);
