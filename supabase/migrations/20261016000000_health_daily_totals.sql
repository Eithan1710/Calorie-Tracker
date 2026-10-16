-- מאזן — Apple Health per-day totals (additive, safe to re-run).
--
-- Why: Shortcuts can send, for every calendar day, the full sum of Active Energy, Resting
-- Energy and Steps ("Find Health Samples → Group by Day → Calculate Sum"). That is the most
-- accurate value there is for a day — better than an "as of now" snapshot (which misses the
-- rest of the day) or a sum of the samples that happened to be sent. So:
--
-- 1. mz_health_data gains, per kind, when its value came from a day total (*_daily_at) and
--    whether that day had already ended at that moment (*_final = complete).
-- 2. mz_ingest_health_days(): writes day totals. Each one OVERWRITES that day's value of
--    its kind, whatever was stored (snapshot, samples, older day total). Kinds not sent are
--    left as they are.
-- 3. mz_ingest_health() (snapshots) and mz_ingest_health_samples() keep working as before,
--    except that they never replace a complete day total, and samples never replace a
--    partial day total (today) with an older reading.
-- Existing rows, the steps sync, the app and the policies are unchanged.

-- ── 1. provenance of each day value ─────────────────────────────────────────
alter table public.mz_health_data add column if not exists steps_daily_at timestamptz;
alter table public.mz_health_data add column if not exists active_daily_at timestamptz;
alter table public.mz_health_data add column if not exists resting_daily_at timestamptz;
alter table public.mz_health_data add column if not exists steps_final boolean not null default false;
alter table public.mz_health_data add column if not exists active_final boolean not null default false;
alter table public.mz_health_data add column if not exists resting_final boolean not null default false;

-- ── 2. day totals (service role only) ───────────────────────────────────────
-- p_days: [{"date": "2026-10-15", "steps": 7892 | null, "active": 421.9 | null,
--           "resting": 1590.1 | null, "as_of": "<ISO>", "final": true}]
create or replace function public.mz_ingest_health_days(p_user uuid, p_days jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  d jsonb;
  day date;
  v_steps integer;
  v_active numeric;
  v_resting numeric;
  v_as_of timestamptz;
  v_final boolean;
  prev record;
  had boolean;
  result jsonb := '{}'::jsonb;
  n_new int := 0;
  n_changed int := 0;
  n_same int := 0;
begin
  if p_user is null then raise exception 'user required'; end if;
  if jsonb_typeof(coalesce(p_days, '[]'::jsonb)) <> 'array' then raise exception 'p_days must be a JSON array'; end if;

  for d in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb)) loop
    day := (d ->> 'date')::date;
    v_steps := nullif(d ->> 'steps', '')::integer;
    v_active := nullif(d ->> 'active', '')::numeric;
    v_resting := nullif(d ->> 'resting', '')::numeric;
    v_as_of := coalesce(nullif(d ->> 'as_of', '')::timestamptz, now());
    v_final := coalesce((d ->> 'final')::boolean, false);
    if day is null then raise exception 'every day needs a date'; end if;
    if v_steps is null and v_active is null and v_resting is null then continue; end if;

    select h.steps, h.active_kcal, h.resting_kcal into prev
      from public.mz_health_data h where h.user_id = p_user and h.date = day;
    had := found;

    insert into public.mz_health_data as h (user_id, date, steps, active_kcal, resting_kcal, health_as_of, source, updated_at,
                                            steps_daily_at, active_daily_at, resting_daily_at, steps_final, active_final, resting_final)
    values (p_user, day, coalesce(v_steps, 0), v_active, v_resting, v_as_of, 'shortcut', now(),
            case when v_steps is not null then v_as_of end, case when v_active is not null then v_as_of end,
            case when v_resting is not null then v_as_of end,
            v_steps is not null and v_final, v_active is not null and v_final, v_resting is not null and v_final)
    on conflict (user_id, date) do update set
      steps            = coalesce(v_steps, h.steps),
      active_kcal      = coalesce(v_active, h.active_kcal),
      resting_kcal     = coalesce(v_resting, h.resting_kcal),
      steps_daily_at   = case when v_steps is not null then v_as_of else h.steps_daily_at end,
      active_daily_at  = case when v_active is not null then v_as_of else h.active_daily_at end,
      resting_daily_at = case when v_resting is not null then v_as_of else h.resting_daily_at end,
      steps_final      = case when v_steps is not null then v_final else h.steps_final end,
      active_final     = case when v_active is not null then v_final else h.active_final end,
      resting_final    = case when v_resting is not null then v_final else h.resting_final end,
      health_as_of     = greatest(coalesce(h.health_as_of, '-infinity'::timestamptz), v_as_of),
      source           = case when v_steps is not null then 'shortcut' else h.source end,
      updated_at       = now();

    if not had then
      n_new := n_new + 1;
    elsif (coalesce(v_steps, prev.steps), coalesce(v_active, prev.active_kcal), coalesce(v_resting, prev.resting_kcal))
          is distinct from (prev.steps, prev.active_kcal, prev.resting_kcal) then
      n_changed := n_changed + 1;
    else
      n_same := n_same + 1;
    end if;
    result := result || jsonb_build_object(day::text, jsonb_strip_nulls(jsonb_build_object(
      'steps', v_steps, 'active_kcal', v_active, 'resting_kcal', v_resting, 'final', v_final,
      'previous', case when not had then null else jsonb_build_object(
        'steps', prev.steps, 'active_kcal', prev.active_kcal, 'resting_kcal', prev.resting_kcal) end)));
  end loop;

  return jsonb_build_object('days', result, 'new_days', n_new, 'changed_days', n_changed, 'unchanged_days', n_same);
end $$;

revoke all on function public.mz_ingest_health_days(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.mz_ingest_health_days(uuid, jsonb) to service_role;

-- ── 3a. samples: never replace a complete day total ─────────────────────────
create or replace function public.mz_ingest_health_samples(
  p_user uuid,
  p_kind text,
  p_tz text,
  p_as_of timestamptz,
  p_samples jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n_received int;
  n_dupes int;
  n_inserted int := 0;
  n_updated int := 0;
  n_replaced int := 0;
  n_purged int := 0;
  day_totals jsonb := '{}'::jsonb;
  capped text[] := '{}';
  d date;
  total numeric;
  cap numeric;
  fin boolean;
  daily_at timestamptz;
  kept text[] := '{}';
begin
  if p_user is null then raise exception 'user required'; end if;
  if p_kind not in ('active', 'resting') then raise exception 'invalid kind: %', p_kind; end if;
  perform now() at time zone p_tz; -- raises on an unknown time zone
  if jsonb_typeof(coalesce(p_samples, '[]'::jsonb)) <> 'array' then raise exception 'p_samples must be a JSON array'; end if;
  cap := case p_kind when 'active' then 8000 else 5000 end;

  create temporary table if not exists pg_temp.mz_in (
    ord bigint, sample_key text, start_at timestamptz, end_at timestamptz, kcal numeric, source text, date date
  ) on commit drop;
  truncate pg_temp.mz_in;
  insert into pg_temp.mz_in
  select e.ord, e.v ->> 'key', (e.v ->> 'start')::timestamptz, (e.v ->> 'end')::timestamptz,
         (e.v ->> 'kcal')::numeric, nullif(e.v ->> 'source', ''), ((e.v ->> 'start')::timestamptz at time zone p_tz)::date
  from jsonb_array_elements(coalesce(p_samples, '[]'::jsonb)) with ordinality as e(v, ord);
  get diagnostics n_received = row_count;
  if exists (select 1 from pg_temp.mz_in where sample_key is null or start_at is null or end_at is null or kcal is null) then
    raise exception 'every sample needs key, start, end and kcal';
  end if;

  -- the same key twice in one request: the last one wins
  delete from pg_temp.mz_in a using pg_temp.mz_in b where a.sample_key = b.sample_key and a.ord < b.ord;
  get diagnostics n_dupes = row_count;

  create temporary table if not exists pg_temp.mz_days (date date primary key) on commit drop;
  truncate pg_temp.mz_days;
  insert into pg_temp.mz_days select distinct date from pg_temp.mz_in on conflict do nothing;

  -- a stored sample of the same source overlapping a new one under another key is stale
  -- (the bucket of the current hour/day grew and its end moved, or the granularity changed)
  with gone as (
    delete from public.mz_health_samples s
    using pg_temp.mz_in i
    where s.user_id = p_user and s.kind = p_kind
      and coalesce(s.source, '') = coalesce(i.source, '')
      and s.sample_key <> i.sample_key
      and not exists (select 1 from pg_temp.mz_in k where k.sample_key = s.sample_key)
      and (case when s.end_at > s.start_at then tstzrange(s.start_at, s.end_at, '[)') else tstzrange(s.start_at, s.start_at, '[]') end)
       && (case when i.end_at > i.start_at then tstzrange(i.start_at, i.end_at, '[)') else tstzrange(i.start_at, i.start_at, '[]') end)
    returning s.date
  ), counted as (
    insert into pg_temp.mz_days select distinct date from gone on conflict do nothing
  )
  select count(*) into n_replaced from gone;

  -- idempotent upsert: re-sending the same sample changes nothing
  with up as (
    insert into public.mz_health_samples as s (user_id, kind, sample_key, date, start_at, end_at, kcal, source, received_at)
    select p_user, p_kind, i.sample_key, i.date, i.start_at, i.end_at, i.kcal, i.source, now() from pg_temp.mz_in i
    on conflict (user_id, kind, sample_key) do update set
      date = excluded.date, start_at = excluded.start_at, end_at = excluded.end_at,
      kcal = excluded.kcal, source = excluded.source, received_at = now()
    where (s.date, s.start_at, s.end_at, s.kcal, s.source) is distinct from
          (excluded.date, excluded.start_at, excluded.end_at, excluded.kcal, excluded.source)
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new), count(*) filter (where not is_new) into n_inserted, n_updated from up;

  -- every affected day: total recomputed from the stored samples (never incremented)
  for d in select date from pg_temp.mz_days order by date loop
    -- the day total from the per-day feed is the most accurate value: a complete one is never
    -- replaced by a sum of samples, a partial one (today) only by a newer reading
    select case when p_kind = 'active' then h.active_final else h.resting_final end,
           case when p_kind = 'active' then h.active_daily_at else h.resting_daily_at end
      into fin, daily_at
      from public.mz_health_data h where h.user_id = p_user and h.date = d;
    if coalesce(fin, false) or (daily_at is not null and p_as_of <= daily_at) then
      kept := kept || d::text;
      continue;
    end if;
    select coalesce(sum(kcal), 0) into total from public.mz_health_samples where user_id = p_user and kind = p_kind and date = d;
    if total > cap then capped := capped || d::text; total := cap; end if;
    total := round(total, 1);
    insert into public.mz_health_data as h (user_id, date, steps, active_kcal, resting_kcal, health_as_of, source, updated_at)
    values (p_user, d, 0,
            case when p_kind = 'active' then total end,
            case when p_kind = 'resting' then total end,
            p_as_of, 'shortcut', now())
    on conflict (user_id, date) do update set
      active_kcal  = case when p_kind = 'active' then total else h.active_kcal end,
      resting_kcal = case when p_kind = 'resting' then total else h.resting_kcal end,
      health_as_of = greatest(coalesce(h.health_as_of, '-infinity'::timestamptz), p_as_of),
      updated_at   = now();
    day_totals := day_totals || jsonb_build_object(d::text, total);
  end loop;

  -- keep the table small: samples are only needed while their day can still change
  delete from public.mz_health_samples where user_id = p_user and kind = p_kind and start_at < p_as_of - interval '35 days';
  get diagnostics n_purged = row_count;

  return jsonb_build_object(
    'kind', p_kind, 'received', n_received, 'duplicates_in_request', n_dupes,
    'inserted', n_inserted, 'updated', n_updated, 'unchanged', n_received - n_dupes - n_inserted - n_updated,
    'replaced', n_replaced, 'purged', n_purged, 'days', day_totals, 'capped_days', to_jsonb(capped),
    'kept_daily_days', to_jsonb(kept));
end $$;

revoke all on function public.mz_ingest_health_samples(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mz_ingest_health_samples(uuid, text, text, timestamptz, jsonb) to service_role;

-- ── 3b. snapshots: never replace a complete day total ───────────────────────
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
  active_ignored boolean := false;
  resting_ignored boolean := false;
  fin record;
  kept_daily text[] := '{}';
begin
  if p_user is null then raise exception 'user required'; end if;

  -- a complete day total from the per-day feed is final for that day and kind
  select h.steps_final, h.active_final, h.resting_final into fin
    from public.mz_health_data h where h.user_id = p_user and h.date = p_date;
  if found then
    if fin.steps_final and p_steps is not null then p_steps := null; kept_daily := array_append(kept_daily, 'steps'); end if;
    if fin.active_final and p_active is not null then p_active := null; kept_daily := array_append(kept_daily, 'active_kcal'); end if;
    if fin.resting_final and p_resting is not null then p_resting := null; kept_daily := array_append(kept_daily, 'resting_kcal'); end if;
  end if;

  -- a day whose energy comes from timestamped samples keeps the sample-based total:
  -- an aggregate ("sum since midnight") for that day/kind is ignored (it can't be merged)
  if p_active is not null and exists (select 1 from public.mz_health_samples s where s.user_id = p_user and s.kind = 'active' and s.date = p_date) then
    p_active := null; active_ignored := true;
  end if;
  if p_resting is not null and exists (select 1 from public.mz_health_samples s where s.user_id = p_user and s.kind = 'resting' and s.date = p_date) then
    p_resting := null; resting_ignored := true;
  end if;

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

  return jsonb_build_object('day_applied', day_applied, 'workouts_inserted', inserted, 'workouts_updated', updated, 'workouts_kept_deleted', kept_deleted,
                            'active_ignored_samples_day', active_ignored, 'resting_ignored_samples_day', resting_ignored,
                            'kept_daily_totals', to_jsonb(kept_daily));
end $$;

revoke all on function public.mz_ingest_health(uuid, date, integer, numeric, numeric, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mz_ingest_health(uuid, date, integer, numeric, numeric, timestamptz, jsonb) to service_role;
