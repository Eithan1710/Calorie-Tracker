-- מאזן — the custom daily target is a band of deficit or surplus, not an intake range
-- (replaces kcal_min/kcal_max from 20261020000000; safe to re-run).
--
--   custom_deficit_min/max  the user's own band, kcal of deficit (burned − eaten):
--                           positive = deficit (e.g. 200–300), negative = surplus
--                           (a surplus of 200–400 is stored as −400…−200).
--                           Same bounds as deficit_min/max: −500…1000, max > min.
--   calorie_mode            'auto' = the phase band (deficit_min/max) · 'custom' = this band
-- goal_phase and the phase band are unchanged; RLS on mz_profiles is unchanged (own row only).
alter table public.mz_profiles drop constraint if exists mz_profiles_custom_needs_range_check;
alter table public.mz_profiles drop constraint if exists mz_profiles_kcal_range_check;
-- no account used the intake range in custom mode; the columns go away
alter table public.mz_profiles drop column if exists kcal_min;
alter table public.mz_profiles drop column if exists kcal_max;

alter table public.mz_profiles add column if not exists custom_deficit_min smallint;
alter table public.mz_profiles add column if not exists custom_deficit_max smallint;

alter table public.mz_profiles drop constraint if exists mz_profiles_custom_deficit_check;
alter table public.mz_profiles add constraint mz_profiles_custom_deficit_check
  check ((custom_deficit_min is null and custom_deficit_max is null)
      or (custom_deficit_min is not null and custom_deficit_max is not null
          and custom_deficit_min between -500 and 1000 and custom_deficit_max between -500 and 1000
          and custom_deficit_max > custom_deficit_min));
-- custom mode needs a band
alter table public.mz_profiles drop constraint if exists mz_profiles_custom_needs_band_check;
alter table public.mz_profiles add constraint mz_profiles_custom_needs_band_check
  check (calorie_mode = 'auto' or custom_deficit_min is not null);
