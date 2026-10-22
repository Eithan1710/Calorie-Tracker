-- Tests for 20261020000000_calorie_range.sql + 20261020100000_custom_deficit.sql on a plain
-- Postgres (a minimal mz_profiles as the earlier migrations leave it). NEVER run this against
-- the real project.
create table if not exists public.mz_profiles (
  user_id uuid primary key,
  deficit_min smallint not null default 100,
  deficit_max smallint not null default 300
);
\ir ../migrations/20261020000000_calorie_range.sql
-- a row from the intake-range version (auto mode with a leftover range) survives the change
insert into public.mz_profiles (user_id, kcal_min, kcal_max) values ('00000000-0000-0000-0000-0000000000e2', 1900, 2100)
  on conflict (user_id) do nothing;
\ir ../migrations/20261020100000_custom_deficit.sql
\ir ../migrations/20261020100000_custom_deficit.sql
\ir ../migrations/20261023000100_step_goal.sql
\ir ../migrations/20261023000100_step_goal.sql
do $$
declare
  u1 constant uuid := '00000000-0000-0000-0000-0000000000e1';
  ok boolean;
begin
  if exists (select 1 from information_schema.columns where table_name = 'mz_profiles' and column_name in ('kcal_min', 'kcal_max')) then
    raise exception '0a: intake columns still there';
  end if;
  if (select calorie_mode from public.mz_profiles where user_id = '00000000-0000-0000-0000-0000000000e2') <> 'auto' then raise exception '0b: old row'; end if;

  delete from public.mz_profiles where user_id = u1;
  -- an existing row keeps working: automatic mode, no band
  insert into public.mz_profiles (user_id) values (u1);
  if (select calorie_mode from public.mz_profiles where user_id = u1) <> 'auto' then raise exception '1: default mode'; end if;
  -- phase + custom deficit 200–300 together
  update public.mz_profiles set goal_phase = 'recomp', calorie_mode = 'custom', custom_deficit_min = 200, custom_deficit_max = 300 where user_id = u1;
  -- a custom surplus of 200–400 (stored negative)
  update public.mz_profiles set custom_deficit_min = -400, custom_deficit_max = -200 where user_id = u1;
  -- switching back to automatic or changing the phase keeps the band
  update public.mz_profiles set calorie_mode = 'auto', goal_phase = 'cut', deficit_min = 300, deficit_max = 500 where user_id = u1;
  if (select custom_deficit_min from public.mz_profiles where user_id = u1) <> -400 then raise exception '2: band lost'; end if;
  -- invalid values are refused
  begin update public.mz_profiles set custom_deficit_min = -100 where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '3: min > max accepted'; end if;
  begin update public.mz_profiles set custom_deficit_min = 0, custom_deficit_max = 1500 where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '4: extreme deficit accepted'; end if;
  begin update public.mz_profiles set custom_deficit_min = -900, custom_deficit_max = -200 where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '5: extreme surplus accepted'; end if;
  begin update public.mz_profiles set custom_deficit_min = 200, custom_deficit_max = null where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '6: half band accepted'; end if;
  begin update public.mz_profiles set calorie_mode = 'custom', custom_deficit_min = null, custom_deficit_max = null where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '7: custom without a band accepted'; end if;
  begin update public.mz_profiles set goal_phase = 'bulk-max' where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '8: unknown phase accepted'; end if;
  -- step goal: optional, sane range, independent of the calorie target
  if (select step_goal from public.mz_profiles where user_id = u1) is not null then raise exception '9a: step goal default'; end if;
  update public.mz_profiles set step_goal = 10000 where user_id = u1;
  if (select step_goal from public.mz_profiles where user_id = u1) <> 10000 then raise exception '9b: step goal not saved'; end if;
  begin update public.mz_profiles set step_goal = 0 where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '9c: zero step goal accepted'; end if;
  begin update public.mz_profiles set step_goal = 120000 where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '9d: huge step goal accepted'; end if;
  if (select custom_deficit_min from public.mz_profiles where user_id = u1) <> -400 then raise exception '9e: band changed'; end if;
  raise notice 'calorie range checks passed';
end $$;
