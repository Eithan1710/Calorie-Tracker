-- מאזן — what measures the user's Active Energy (additive, safe to re-run).
--   health_device  'phone' = iPhone alone → the app adds the daily-routine movement the phone
--                  can't see (getting up, shower, dressing — see src/domain/routine.ts);
--                  'watch' = Apple Watch, which measures it; null = not chosen (the app infers it).
-- Row-level security on mz_profiles is unchanged (own row only).
alter table public.mz_profiles add column if not exists health_device text;
alter table public.mz_profiles drop constraint if exists mz_profiles_health_device_check;
alter table public.mz_profiles add constraint mz_profiles_health_device_check
  check (health_device is null or health_device in ('phone', 'watch'));
