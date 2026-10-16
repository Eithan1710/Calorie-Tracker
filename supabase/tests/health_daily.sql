-- Tests for 20261016000000_health_daily_totals.sql on a plain Postgres. Run after
-- local_stubs.sql + health_ingest_base.sql + the 20261012 / 20261014 / 20261016 migrations.
-- Times are Asia/Jerusalem (IDT = UTC+3 until 2026-10-25).
do $$
declare
  u1 constant uuid := '00000000-0000-0000-0000-0000000000d1';
  u2 constant uuid := '00000000-0000-0000-0000-0000000000d2';
  tz constant text := 'Asia/Jerusalem';
  r jsonb;
  h record;
begin
  -- what the snapshot automation had stored (a snapshot at 23:55 misses the end of the day)
  perform public.mz_ingest_health(u1, '2026-10-13', 5598, 136.6, 1364, '2026-10-13T23:55:03+03:00', '[]'::jsonb);
  perform public.mz_ingest_health(u1, '2026-10-16', 21526, 1440.9, 1590.2, '2026-10-16T10:28:28+03:00', '[]'::jsonb);
  perform public.mz_ingest_health(u2, '2026-10-13', 4000, 200, 1300, '2026-10-13T22:00:00+03:00', '[]'::jsonb);

  -- 1. day totals overwrite each sent kind for that day, keep the others; other users untouched
  r := public.mz_ingest_health_days(u1, jsonb_build_array(
    jsonb_build_object('date', '2026-10-13', 'resting', 1557.0, 'active', null, 'as_of', '2026-10-16T10:40:00+03:00', 'final', true),
    jsonb_build_object('date', '2026-10-15', 'active', 422.0, 'resting', 1590.1, 'steps', 7892, 'as_of', '2026-10-16T10:40:00+03:00', 'final', true),
    jsonb_build_object('date', '2026-10-16', 'steps', 18, 'as_of', '2026-10-16T10:40:00+03:00', 'final', false)));
  if (r ->> 'new_days')::int <> 1 or (r ->> 'changed_days')::int <> 2 then raise exception '1a: %', r; end if;
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-13';
  if h.resting_kcal <> 1557.0 or h.active_kcal <> 136.6 or h.steps <> 5598 then raise exception '1b: %', row_to_json(h); end if;
  if not h.resting_final or h.active_final or h.resting_daily_at is null then raise exception '1c: flags %', row_to_json(h); end if;
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-15';
  if h.active_kcal <> 422.0 or h.resting_kcal <> 1590.1 or h.steps <> 7892 or h.source <> 'shortcut' then raise exception '1d: %', row_to_json(h); end if;
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-16';
  if h.steps <> 18 or h.active_kcal <> 1440.9 or h.steps_final then raise exception '1e: today %', row_to_json(h); end if;
  if (r -> 'days' -> '2026-10-13' -> 'previous' ->> 'resting_kcal')::numeric <> 1364 then raise exception '1f: previous %', r; end if;
  if (select resting_kcal from public.mz_health_data where user_id = u2 and date = '2026-10-13') <> 1300 then raise exception '1g: other user changed'; end if;

  -- 2. the same request again → same values, nothing duplicated
  r := public.mz_ingest_health_days(u1, jsonb_build_array(
    jsonb_build_object('date', '2026-10-15', 'active', 422.0, 'resting', 1590.1, 'steps', 7892, 'as_of', '2026-10-16T10:45:00+03:00', 'final', true)));
  if (r ->> 'unchanged_days')::int <> 1 then raise exception '2a: %', r; end if;
  if (select count(*) from public.mz_health_data where user_id = u1) <> 3 then raise exception '2b: rows'; end if;

  -- 3. a later snapshot does not replace a complete day total, but still updates other kinds of that day
  r := public.mz_ingest_health(u1, '2026-10-13', 6000, 150, 1400, '2026-10-16T11:00:00+03:00', '[]'::jsonb);
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-13';
  if h.resting_kcal <> 1557.0 then raise exception '3a: final resting replaced %', row_to_json(h); end if;
  if h.active_kcal <> 150 or h.steps <> 6000 then raise exception '3b: non-final kinds not updated %', row_to_json(h); end if;
  if not (r -> 'kept_daily_totals') ? 'resting_kcal' then raise exception '3c: %', r; end if;

  -- 4. today (partial): a newer snapshot may update it (the day is still going on); an older one may not
  perform public.mz_ingest_health(u1, '2026-10-16', 30, null, null, '2026-10-16T10:30:00+03:00', '[]'::jsonb);
  if (select steps from public.mz_health_data where user_id = u1 and date = '2026-10-16') <> 18 then raise exception '4a: older snapshot applied'; end if;
  perform public.mz_ingest_health(u1, '2026-10-16', 950, null, null, '2026-10-16T11:30:00+03:00', '[]'::jsonb);
  if (select steps from public.mz_health_data where user_id = u1 and date = '2026-10-16') <> 950 then raise exception '4b: newer snapshot ignored'; end if;

  -- 5. samples never replace a complete day total; on a day without one they work as before
  r := public.mz_ingest_health_samples(u1, 'resting', tz, '2026-10-16T12:00:00+03:00', jsonb_build_array(
    jsonb_build_object('key', 's-15', 'start', '2026-10-15T00:00:00+03:00', 'end', '2026-10-15T20:00:00+03:00', 'kcal', 1200, 'source', 'Watch'),
    jsonb_build_object('key', 's-14', 'start', '2026-10-14T00:00:00+03:00', 'end', '2026-10-14T23:59:00+03:00', 'kcal', 1512.9, 'source', 'Watch')));
  if (select resting_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-15') <> 1590.1 then raise exception '5a: samples replaced a day total'; end if;
  if (select resting_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-14') <> 1512.9 then raise exception '5b: samples day broken'; end if;
  if not (r -> 'kept_daily_days') ? '2026-10-15' then raise exception '5c: %', r; end if;

  -- 6. a newer day total replaces a sample-based total (and is then final)
  perform public.mz_ingest_health_days(u1, jsonb_build_array(
    jsonb_build_object('date', '2026-10-14', 'resting', 1512.9, 'active', 417.4, 'as_of', '2026-10-16T12:10:00+03:00', 'final', true)));
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-14';
  if h.resting_kcal <> 1512.9 or h.active_kcal <> 417.4 or not h.active_final then raise exception '6a: %', row_to_json(h); end if;

  -- 7. migration ran twice above: still exactly one definition per function
  if (select count(*) from pg_proc where proname = 'mz_ingest_health_days') <> 1 then raise exception '7: duplicate function'; end if;

  raise notice 'health daily checks passed';
end $$;
