-- מאזן — Apple Health energy + workouts (additive, safe to re-run).
--
-- 1. mz_health_data gains Apple Health "Resting Energy" next to the existing
--    (so far unused) active_kcal column, plus the time the snapshot was read
--    (health_as_of) so an older snapshot can never overwrite a newer one.
-- 2. mz_exercises can now hold workouts imported from Apple Health (Strava, Hevy,
--    Apple Watch…) next to manually logged ones. Imported rows get a stable id
--    derived from (user, type, start minute, source app): sending the same
--    workout again updates it instead of adding a duplicate.
-- 3. mz_ingest_health(): the only write path used by the health-ingest edge
--    function (service role). Partial updates, newest snapshot wins, a workout
--    the user deleted stays deleted, user edits are kept.
-- Existing rows, steps sync and policies are unchanged.

-- ── 1. daily energy ─────────────────────────────────────────────────────────
alter table public.mz_health_data add column if not exists resting_kcal numeric(6, 1);
alter table public.mz_health_data add column if not exists health_as_of timestamptz;
alter table public.mz_health_data drop constraint if exists mz_health_data_energy_check;
alter table public.mz_health_data add constraint mz_health_data_energy_check
  check ((active_kcal is null or active_kcal between 0 and 8000) and (resting_kcal is null or resting_kcal between 0 and 5000));

-- ── 2. imported workouts ────────────────────────────────────────────────────
alter table public.mz_exercises add column if not exists origin text not null default 'manual';
alter table public.mz_exercises add column if not exists started_at timestamptz;
alter table public.mz_exercises add column if not exists ended_at timestamptz;
alter table public.mz_exercises add column if not exists source_app text;
alter table public.mz_exercises add column if not exists title text;
alter table public.mz_exercises add column if not exists reported_kcal numeric(6, 1);
-- manual workout that Apple Health did NOT measure (e.g. no watch) → its estimate is added
alter table public.mz_exercises add column if not exists outside_health boolean not null default false;
alter table public.mz_exercises drop constraint if exists mz_exercises_origin_check;
alter table public.mz_exercises add constraint mz_exercises_origin_check check (origin in ('manual', 'apple_health'));
alter table public.mz_exercises drop constraint if exists mz_exercises_reported_kcal_check;
alter table public.mz_exercises add constraint mz_exercises_reported_kcal_check check (reported_kcal is null or reported_kcal between 0 and 5000);
alter table public.mz_exercises drop constraint if exists mz_exercises_title_check;
alter table public.mz_exercises add constraint mz_exercises_title_check check (title is null or char_length(title) <= 80);
alter table public.mz_exercises drop constraint if exists mz_exercises_source_app_check;
alter table public.mz_exercises add constraint mz_exercises_source_app_check check (source_app is null or char_length(source_app) <= 40);

-- ── 3. ingest (service role only) ───────────────────────────────────────────
create or replace function public.mz_ingest_health(
  p_user uuid,
  p_date date,
  p_steps integer,
  p_active numeric,
  p_resting numeric,
  p_as_of timestamptz,
  p_workouts jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  day_applied boolean := false;
  w jsonb;
  inserted int := 0;
  updated int := 0;
  kept_deleted int := 0;
  existing record;
begin
  if p_user is null then raise exception 'user required'; end if;

  -- daily totals: partial update, and an older snapshot never replaces a newer one
  if p_steps is not null or p_active is not null or p_resting is not null then
    insert into public.mz_health_data as h (user_id, date, steps, active_kcal, resting_kcal, health_as_of, source, updated_at)
    values (p_user, p_date, coalesce(p_steps, 0), p_active, p_resting, p_as_of, 'shortcut', now())
    on conflict (user_id, date) do update set
      steps        = case when p_steps is not null then p_steps else h.steps end,
      active_kcal  = coalesce(p_active, h.active_kcal),
      resting_kcal = coalesce(p_resting, h.resting_kcal),
      health_as_of = greatest(coalesce(h.health_as_of, '-infinity'::timestamptz), p_as_of),
      source       = case when p_steps is not null then 'shortcut' else h.source end,
      updated_at   = now()
    where h.health_as_of is null or p_as_of >= h.health_as_of;
    get diagnostics inserted = row_count;
    day_applied := inserted > 0;
    inserted := 0;
  end if;

  -- workouts: stable ids → idempotent
  for w in select * from jsonb_array_elements(coalesce(p_workouts, '[]'::jsonb)) loop
    select id, user_id, deleted_at into existing from public.mz_exercises where id = (w ->> 'id')::uuid;
    if found then
      if existing.user_id <> p_user then continue; end if; -- never touch another account's row
      if existing.deleted_at is not null then kept_deleted := kept_deleted + 1; continue; end if;
      update public.mz_exercises set
        date = (w ->> 'date')::date,
        type = w ->> 'type',
        title = w ->> 'title',
        started_at = (w ->> 'started_at')::timestamptz,
        ended_at = nullif(w ->> 'ended_at', '')::timestamptz,
        duration_min = nullif(w ->> 'duration_min', '')::numeric,
        distance_km = nullif(w ->> 'distance_km', '')::numeric,
        reported_kcal = nullif(w ->> 'kcal', '')::numeric,
        source_app = w ->> 'source_app',
        updated_at = now()
      where id = existing.id
        and (date, type, title, started_at, ended_at, duration_min, distance_km, reported_kcal, source_app)
            is distinct from ((w ->> 'date')::date, w ->> 'type', w ->> 'title', (w ->> 'started_at')::timestamptz,
                              nullif(w ->> 'ended_at', '')::timestamptz, nullif(w ->> 'duration_min', '')::numeric,
                              nullif(w ->> 'distance_km', '')::numeric, nullif(w ->> 'kcal', '')::numeric, w ->> 'source_app');
      if found then updated := updated + 1; end if;
    else
      insert into public.mz_exercises (id, user_id, date, type, title, origin, started_at, ended_at, duration_min, distance_km,
                                       reported_kcal, source_app, created_at, updated_at)
      values ((w ->> 'id')::uuid, p_user, (w ->> 'date')::date, w ->> 'type', w ->> 'title', 'apple_health',
              (w ->> 'started_at')::timestamptz, nullif(w ->> 'ended_at', '')::timestamptz,
              nullif(w ->> 'duration_min', '')::numeric, nullif(w ->> 'distance_km', '')::numeric,
              nullif(w ->> 'kcal', '')::numeric, w ->> 'source_app', (w ->> 'started_at')::timestamptz, now());
      inserted := inserted + 1;
    end if;
  end loop;

  return jsonb_build_object('day_applied', day_applied, 'workouts_inserted', inserted, 'workouts_updated', updated, 'workouts_kept_deleted', kept_deleted);
end $$;

revoke all on function public.mz_ingest_health(uuid, date, integer, numeric, numeric, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mz_ingest_health(uuid, date, integer, numeric, numeric, timestamptz, jsonb) to service_role;
