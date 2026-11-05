-- מאזן — creatine on the profile (additive, safe to re-run).
--
-- mz_profiles.creatine  {"start":"2026-10-25","loading":false,"stop":"…"} or null. Creatine draws water into
--   the muscles (~1–2% of body weight over ~4 weeks); the app shows it on the weight chart and takes it into
--   account when comparing the calorie balance with the scale (src/domain/creatine.ts).
-- Row-level security on mz_profiles is unchanged (own row only).
alter table public.mz_profiles add column if not exists creatine jsonb;
alter table public.mz_profiles drop constraint if exists mz_profiles_creatine_check;
alter table public.mz_profiles add constraint mz_profiles_creatine_check
  check (creatine is null or coalesce(jsonb_typeof(creatine) = 'object'
         and jsonb_typeof(creatine -> 'start') = 'string'
         and (creatine -> 'loading' is null or jsonb_typeof(creatine -> 'loading') = 'boolean')
         and (creatine -> 'stop' is null or jsonb_typeof(creatine -> 'stop') = 'string'), false));
