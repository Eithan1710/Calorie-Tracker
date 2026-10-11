-- Tests for public.mz_ingest_health (20261012000000_health_energy_workouts.sql) on a plain
-- Postgres. Run after local_stubs.sql + health_ingest_base.sql + the migration. Fails loudly.
do $$
declare
  u1 constant uuid := '00000000-0000-0000-0000-0000000000a1';
  u2 constant uuid := '00000000-0000-0000-0000-0000000000a2';
  w1 constant uuid := '11111111-1111-5111-8111-111111111111';
  r jsonb;
  h record;
  n int;
  run jsonb := jsonb_build_object('id', w1, 'date', '2026-10-11', 'type', 'run', 'title', 'Running',
    'started_at', '2026-10-11T15:00:00Z', 'ended_at', '2026-10-11T15:32:00Z', 'duration_min', 32, 'distance_km', 5.1, 'kcal', 340, 'source_app', 'Strava');
begin
  -- 1. first snapshot of the day
  r := public.mz_ingest_health(u1, '2026-10-11', 5000, 300, 700, '2026-10-11T09:00:00Z', '[]');
  if not (r ->> 'day_applied')::boolean then raise exception '1: first snapshot not applied: %', r; end if;

  -- 2. an older snapshot arriving late never overwrites a newer one
  r := public.mz_ingest_health(u1, '2026-10-11', 3000, 100, 400, '2026-10-11T06:00:00Z', '[]');
  if (r ->> 'day_applied')::boolean then raise exception '2: older snapshot applied'; end if;
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-11';
  if h.steps <> 5000 or h.active_kcal <> 300 or h.resting_kcal <> 700 then raise exception '2: values changed: %', row_to_json(h); end if;

  -- 3. partial update: only active energy → steps and resting kept
  r := public.mz_ingest_health(u1, '2026-10-11', null, 450, null, '2026-10-11T12:00:00Z', '[]');
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-11';
  if h.steps <> 5000 or h.active_kcal <> 450 or h.resting_kcal <> 700 or h.health_as_of <> '2026-10-11T12:00:00Z' then
    raise exception '3: partial update wrong: %', row_to_json(h);
  end if;

  -- 4. repeating the same snapshot is harmless (idempotent)
  r := public.mz_ingest_health(u1, '2026-10-11', null, 450, null, '2026-10-11T12:00:00Z', '[]');
  select count(*) into n from public.mz_health_data where user_id = u1;
  if n <> 1 then raise exception '4: duplicate day rows'; end if;

  -- 5. workouts: insert once, re-send = no new row, change = update
  r := public.mz_ingest_health(u1, '2026-10-11', null, null, null, '2026-10-11T16:00:00Z', jsonb_build_array(run));
  if (r ->> 'workouts_inserted')::int <> 1 then raise exception '5a: %', r; end if;
  r := public.mz_ingest_health(u1, '2026-10-11', null, null, null, '2026-10-11T16:05:00Z', jsonb_build_array(run));
  if (r ->> 'workouts_inserted')::int <> 0 or (r ->> 'workouts_updated')::int <> 0 then raise exception '5b: re-send changed something: %', r; end if;
  r := public.mz_ingest_health(u1, '2026-10-11', null, null, null, '2026-10-11T16:10:00Z', jsonb_build_array(run || '{"kcal": 352}'));
  if (r ->> 'workouts_updated')::int <> 1 then raise exception '5c: %', r; end if;
  select count(*) into n from public.mz_exercises where user_id = u1;
  if n <> 1 then raise exception '5d: % workout rows', n; end if;
  if (select origin from public.mz_exercises where id = w1) <> 'apple_health' then raise exception '5e: origin'; end if;

  -- 6. a workout the user deleted is not resurrected; user edits survive a re-send
  update public.mz_exercises set intensity = 'high' where id = w1;
  r := public.mz_ingest_health(u1, '2026-10-11', null, null, null, '2026-10-11T16:20:00Z', jsonb_build_array(run || '{"kcal": 360}'));
  if (select intensity from public.mz_exercises where id = w1) <> 'high' then raise exception '6a: user edit lost'; end if;
  update public.mz_exercises set deleted_at = now() where id = w1;
  r := public.mz_ingest_health(u1, '2026-10-11', null, null, null, '2026-10-11T16:30:00Z', jsonb_build_array(run));
  if (r ->> 'workouts_kept_deleted')::int <> 1 then raise exception '6b: %', r; end if;
  if (select deleted_at from public.mz_exercises where id = w1) is null then raise exception '6c: resurrected'; end if;

  -- 7. another account can never modify this row through an id collision
  r := public.mz_ingest_health(u2, '2026-10-11', null, null, null, '2026-10-11T16:40:00Z', jsonb_build_array(run || '{"kcal": 1}'));
  if (select user_id from public.mz_exercises where id = w1) <> u1 or (select reported_kcal from public.mz_exercises where id = w1) = 1 then
    raise exception '7: cross-account write';
  end if;

  raise notice 'health ingest checks passed';
end $$;

-- 8. only the service role may call it
set role authenticated;
do $$ begin
  begin
    perform public.mz_ingest_health('00000000-0000-0000-0000-0000000000a1', '2026-10-11', 1, null, null, now(), '[]');
    raise exception 'authenticated could call mz_ingest_health';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
