-- מאזן — daily step goal, per account (additive, safe to re-run).
--   step_goal  the user's daily step target; null = the app's default (8,000)
-- Steps themselves keep coming from mz_health_data (Apple Health / Shortcuts or manual).
-- Row-level security on mz_profiles is unchanged (own row only).
alter table public.mz_profiles add column if not exists step_goal integer;
alter table public.mz_profiles drop constraint if exists mz_profiles_step_goal_check;
alter table public.mz_profiles add constraint mz_profiles_step_goal_check
  check (step_goal is null or step_goal between 1000 and 50000);
