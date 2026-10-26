-- Tests for 20261026000000_routine_schedule.sql on a plain Postgres (minimal tables as the earlier
-- migrations leave them). NEVER run this against the real project.
create table if not exists public.mz_profiles (user_id uuid primary key);
create table if not exists public.mz_exercises (id uuid primary key, user_id uuid, type text not null);
alter table public.mz_exercises drop constraint if exists mz_exercises_type_check;
alter table public.mz_exercises add constraint mz_exercises_type_check check (type in ('run', 'walk', 'strength', 'cycling', 'swimming', 'other'));
create table if not exists public.mz_daily_summaries (user_id uuid, date date, calories_out numeric, primary key (user_id, date));
insert into public.mz_exercises values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000f1', 'run') on conflict do nothing;
\ir ../migrations/20261026000000_routine_schedule.sql
\ir ../migrations/20261026000000_routine_schedule.sql
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000000f1';
  ok boolean;
begin
  delete from public.mz_profiles where user_id = u;
  insert into public.mz_profiles (user_id) values (u);
  -- the user's schedule: Sun–Thu 09:30–18:00, phone with him 12–13
  update public.mz_profiles set routine_schedule = '{"days":[0,1,2,3,4],"start":"09:30","end":"18:00","phoneBreaks":[["12:00","13:00"]]}' where user_id = u;
  if (select routine_schedule ->> 'start' from public.mz_profiles where user_id = u) <> '09:30' then raise exception '1: schedule not saved'; end if;
  update public.mz_profiles set routine_schedule = null where user_id = u;
  begin update public.mz_profiles set routine_schedule = '"every day"' where user_id = u; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '2: malformed schedule accepted'; end if;
  begin update public.mz_profiles set routine_schedule = '{"days":[0],"start":"09:30"}' where user_id = u; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '3: incomplete schedule accepted'; end if;
  -- new activity types; existing rows kept
  insert into public.mz_exercises values ('00000000-0000-0000-0000-0000000000fa', u, 'dance'), ('00000000-0000-0000-0000-0000000000fb', u, 'climbing') on conflict do nothing;
  if (select count(*) from public.mz_exercises where id = '00000000-0000-0000-0000-0000000000f9') <> 1 then raise exception '4: old row lost'; end if;
  begin insert into public.mz_exercises values (gen_random_uuid(), u, 'parkour'); ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '5: unknown type accepted'; end if;
  -- the per-day breakdown
  insert into public.mz_daily_summaries (user_id, date, calories_out, energy_breakdown) values (u, '2026-10-26', 2300, '{"routine": 277, "no_phone_minutes": 450, "confidence": "medium"}')
    on conflict (user_id, date) do update set energy_breakdown = excluded.energy_breakdown;
  if (select (energy_breakdown ->> 'no_phone_minutes')::int from public.mz_daily_summaries where user_id = u) <> 450 then raise exception '6: breakdown'; end if;
  raise notice 'routine schedule checks passed';
end $$;
