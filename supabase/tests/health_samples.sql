-- Tests for public.mz_ingest_health_samples (20261014000000_health_energy_samples.sql) on a
-- plain Postgres. Run after local_stubs.sql + health_ingest_base.sql + both health migrations.
-- Times are Asia/Jerusalem (IDT = UTC+3 until 2026-10-25 02:00, then IST = UTC+2).
do $$
declare
  u1 constant uuid := '00000000-0000-0000-0000-0000000000b1';
  u2 constant uuid := '00000000-0000-0000-0000-0000000000b2';
  tz constant text := 'Asia/Jerusalem';
  r jsonb;
  h record;
  n int;
  -- yesterday (13th) and today (14th) as Shortcuts "Group by Day" buckets + a late raw sample
  batch jsonb := jsonb_build_array(
    jsonb_build_object('key', 'k-13', 'start', '2026-10-13T00:00:00+03:00', 'end', '2026-10-13T23:58:00+03:00', 'kcal', 512.4, 'source', 'Watch'),
    jsonb_build_object('key', 'k-14', 'start', '2026-10-14T00:00:00+03:00', 'end', '2026-10-14T21:00:00+03:00', 'kcal', 398, 'source', 'Watch'));
begin
  -- 1. one request, two days → each total under its own day
  r := public.mz_ingest_health_samples(u1, 'active', tz, '2026-10-14T21:05:00+03:00', batch);
  if (r ->> 'inserted')::int <> 2 then raise exception '1a: %', r; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-13') <> 512.4 then raise exception '1b: yesterday wrong'; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-14') <> 398 then raise exception '1c: today wrong'; end if;

  -- 2. the same request again (the automation every 15 minutes) → nothing added
  r := public.mz_ingest_health_samples(u1, 'active', tz, '2026-10-14T21:20:00+03:00', batch);
  if (r ->> 'inserted')::int <> 0 or (r ->> 'updated')::int <> 0 or (r ->> 'unchanged')::int <> 2 then raise exception '2a: %', r; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-14') <> 398 then raise exception '2b: double counted'; end if;
  select count(*) into n from public.mz_health_samples where user_id = u1;
  if n <> 2 then raise exception '2c: % sample rows', n; end if;

  -- 3. today's bucket grew and its end moved (new key) → old bucket replaced, not added
  r := public.mz_ingest_health_samples(u1, 'active', tz, '2026-10-14T21:35:00+03:00', jsonb_build_array(
    batch -> 0,
    jsonb_build_object('key', 'k-14b', 'start', '2026-10-14T00:00:00+03:00', 'end', '2026-10-14T21:30:00+03:00', 'kcal', 431, 'source', 'Watch')));
  if (r ->> 'replaced')::int <> 1 or (r ->> 'inserted')::int <> 1 then raise exception '3a: %', r; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-14') <> 431 then raise exception '3b: %', r; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-13') <> 512.4 then raise exception '3c: yesterday changed'; end if;

  -- 4. same key, new value (raw sample corrected) → updated in place
  r := public.mz_ingest_health_samples(u1, 'active', tz, '2026-10-14T21:40:00+03:00', jsonb_build_array(
    jsonb_build_object('key', 'k-14b', 'start', '2026-10-14T00:00:00+03:00', 'end', '2026-10-14T21:30:00+03:00', 'kcal', 440, 'source', 'Watch')));
  if (r ->> 'updated')::int <> 1 then raise exception '4a: %', r; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-14') <> 440 then raise exception '4b'; end if;

  -- 5. midnight: raw samples at 23:59:30 and 00:00:30 local land on different days
  r := public.mz_ingest_health_samples(u1, 'active', tz, '2026-10-14T21:45:00+03:00', jsonb_build_array(
    jsonb_build_object('key', 'm1', 'start', '2026-10-12T20:59:30Z', 'end', '2026-10-12T21:00:30Z', 'kcal', 3, 'source', 'iPhone'),   -- 12th 23:59:30 IDT
    jsonb_build_object('key', 'm2', 'start', '2026-10-12T21:00:30Z', 'end', '2026-10-12T21:01:30Z', 'kcal', 5, 'source', 'iPhone')));  -- 13th 00:00:30 IDT
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-12') <> 3 then raise exception '5a: %', r; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-13') <> 517.4 then raise exception '5b: %', r; end if;
  -- a different source overlapping the Watch bucket is NOT treated as a replacement
  if (r ->> 'replaced')::int <> 0 then raise exception '5c: other source replaced: %', r; end if;

  -- 6. DST end (25 Oct 02:00 IDT → 01:00 IST): 21:30Z on the 25th is 23:30 IST, same day
  r := public.mz_ingest_health_samples(u1, 'resting', tz, '2026-10-26T08:00:00+02:00', jsonb_build_array(
    jsonb_build_object('key', 'd1', 'start', '2026-10-25T21:30:00Z', 'end', '2026-10-25T21:31:00Z', 'kcal', 1, 'source', null),   -- 25th 23:30 IST
    jsonb_build_object('key', 'd2', 'start', '2026-10-25T22:30:00Z', 'end', '2026-10-25T22:31:00Z', 'kcal', 2, 'source', null)));  -- 26th 00:30 IST
  if (r -> 'days' ->> '2026-10-25')::numeric <> 1 or (r -> 'days' ->> '2026-10-26')::numeric <> 2 then raise exception '6: %', r; end if;

  -- 7. aggregate active for a day with samples is ignored; steps / resting still apply
  r := public.mz_ingest_health(u1, '2026-10-14', 7013, 620.5, 1284.8, '2026-10-14T21:50:00+03:00', '[]');
  select * into h from public.mz_health_data where user_id = u1 and date = '2026-10-14';
  if h.active_kcal <> 440 or h.steps <> 7013 or h.resting_kcal <> 1284.8 then raise exception '7a: %', row_to_json(h); end if;
  if not (r ->> 'active_ignored_samples_day')::boolean then raise exception '7b: %', r; end if;
  -- … while a day without samples keeps the aggregate behaviour
  r := public.mz_ingest_health(u1, '2026-10-10', 4000, 300, 1300, '2026-10-10T23:50:00+03:00', '[]');
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-10') <> 300 then raise exception '7c'; end if;

  -- 8. duplicates inside one request: counted once, the last value wins
  r := public.mz_ingest_health_samples(u1, 'active', tz, '2026-10-14T22:00:00+03:00', jsonb_build_array(
    jsonb_build_object('key', 'x', 'start', '2026-10-11T10:00:00+03:00', 'end', '2026-10-11T10:05:00+03:00', 'kcal', 10, 'source', 'iPhone'),
    jsonb_build_object('key', 'x', 'start', '2026-10-11T10:00:00+03:00', 'end', '2026-10-11T10:05:00+03:00', 'kcal', 12, 'source', 'iPhone')));
  if (r ->> 'duplicates_in_request')::int <> 1 or (r -> 'days' ->> '2026-10-11')::numeric <> 12 then raise exception '8: %', r; end if;

  -- 9. another account with the same sample keys is completely separate
  r := public.mz_ingest_health_samples(u2, 'active', tz, '2026-10-14T21:05:00+03:00', batch);
  if (r ->> 'inserted')::int <> 2 then raise exception '9a: %', r; end if;
  if (select active_kcal from public.mz_health_data where user_id = u1 and date = '2026-10-14') <> 440 then raise exception '9b: cross-account'; end if;

  -- 10. a day total over the column limit is capped, not rejected
  r := public.mz_ingest_health_samples(u2, 'resting', tz, '2026-10-14T22:00:00+03:00', jsonb_build_array(
    jsonb_build_object('key', 'big1', 'start', '2026-10-12T01:00:00+03:00', 'end', '2026-10-12T02:00:00+03:00', 'kcal', 4000, 'source', 'x'),
    jsonb_build_object('key', 'big2', 'start', '2026-10-12T03:00:00+03:00', 'end', '2026-10-12T04:00:00+03:00', 'kcal', 4000, 'source', 'x')));
  if (r -> 'capped_days') <> '["2026-10-12"]'::jsonb then raise exception '10: %', r; end if;

  -- 11. invalid input is refused loudly
  begin
    perform public.mz_ingest_health_samples(u1, 'steps', tz, now(), '[]');
    raise exception '11a: invalid kind accepted';
  exception when raise_exception then
    if sqlerrm not like 'invalid kind%' then raise; end if;
  end;
  begin
    perform public.mz_ingest_health_samples(u1, 'active', 'Mars/Olympus', now(), '[]');
    raise exception '11b: invalid time zone accepted';
  exception when invalid_parameter_value then null;
  end;

  raise notice 'health samples checks passed';
end $$;

-- 12. only the service role may call it
set role authenticated;
do $$ begin
  begin
    perform public.mz_ingest_health_samples('00000000-0000-0000-0000-0000000000b1', 'active', 'Asia/Jerusalem', now(), '[]');
    raise exception 'authenticated could call mz_ingest_health_samples';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.mz_health_samples limit 1;
    raise exception 'authenticated could read mz_health_samples';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
