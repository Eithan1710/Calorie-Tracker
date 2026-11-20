-- מאזן — let the owner turn off the routine estimate (additive, safe to re-run).
--
-- mz_profiles.routine_off  true = nothing is added for the everyday movement an iPhone can't see:
--   the day's burn is Apple's measured resting + active energy, logged workouts and digestion only.
--   Default false (the routine stays on for everyone else).
-- Row-level security on mz_profiles is unchanged (own row only).
alter table public.mz_profiles add column if not exists routine_off boolean not null default false;
