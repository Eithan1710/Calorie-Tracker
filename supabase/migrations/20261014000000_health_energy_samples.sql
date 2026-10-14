-- מאזן — Apple Health energy from timestamped samples (additive, safe to re-run).
--
-- Why: an aggregate "Active Energy since midnight" sent every 15 minutes can only ever be
-- filed under one day, and the last snapshot before midnight misses the rest of the day.
-- Timestamped samples (raw Health samples, or Shortcuts' Group-by-Day/Hour buckets) carry
-- their own time, so each one is filed under the local calendar day of its start and a
-- single request can correct yesterday and update today.
--
-- 1. mz_health_samples: one row per sample, keyed by a stable sample key (the sample's
--    own id when the phone sends one, else sha256(kind|start|end|source) computed by the
--    edge function — never by the calorie value). Re-sending = update, never a new row.
-- 2. mz_ingest_health_samples(): upserts a batch, replaces older rows of the same source
--    that overlap a new sample under a different key (e.g. the current hour's bucket whose
--    end moved, or a switch from raw samples to buckets), then recomputes the total of
--    every affected day from the stored samples and writes it to mz_health_data
--    (active_kcal / resting_kcal). Totals are recomputed, never incremented, so repeating
--    a request any number of times gives the same result.
-- 3. mz_ingest_health(): unchanged, except that an aggregate active/resting value is
--    ignored for a day that already has samples of that kind (they would conflict).
-- Existing tables, columns, rows and policies are unchanged.

-- ── 1. samples ──────────────────────────────────────────────────────────────
create table if not exists public.mz_health_samples (
  user_id     uuid not null,
  kind        text not null check (kind in ('active', 'resting')),
  sample_key  text not null check (char_length(sample_key) between 1 and 120),
  -- local calendar day of start_at in the day-boundary time zone (Asia/Jerusalem)
  date        date not null,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  kcal        numeric(7, 2) not null check (kcal between 0 and 8000),
  source      text check (source is null or char_length(source) <= 80),
  received_at timestamptz not null default now(),
  primary key (user_id, kind, sample_key),
  check (end_at >= start_at and end_at - start_at <= interval '25 hours')
);
create index if not exists mz_health_samples_day_idx on public.mz_health_samples (user_id, kind, date);
create index if not exists mz_health_samples_time_idx on public.mz_health_samples (user_id, kind, start_at);

-- written only by the health-ingest edge function (service role); never read by the app
alter table public.mz_health_samples enable row level security;
revoke all on public.mz_health_samples from anon, authenticated;

-- ── 2. sample ingest (service role only) ───────────────────────────────────
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
    'replaced', n_replaced, 'purged', n_purged, 'days', day_totals, 'capped_days', to_jsonb(capped));
end $$;

revoke all on function public.mz_ingest_health_samples(uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mz_ingest_health_samples(uuid, text, text, timestamptz, jsonb) to service_role;

-- ── 3. aggregate ingest: ignore aggregate energy for days that have samples ───
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
begin
  if p_user is null then raise exception 'user required'; end if;

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
                            'active_ignored_samples_day', active_ignored, 'resting_ignored_samples_day', resting_ignored);
end $$;

revoke all on function public.mz_ingest_health(uuid, date, integer, numeric, numeric, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.mz_ingest_health(uuid, date, integer, numeric, numeric, timestamptz, jsonb) to service_role;
