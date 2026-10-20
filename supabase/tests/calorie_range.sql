-- Tests for 20261020000000_calorie_range.sql on a plain Postgres (a minimal mz_profiles as the
-- earlier migrations leave it). NEVER run this against the real project.
create table if not exists public.mz_profiles (
  user_id uuid primary key,
  deficit_min smallint not null default 100,
  deficit_max smallint not null default 300
);
\ir ../migrations/20261020000000_calorie_range.sql
\ir ../migrations/20261020000000_calorie_range.sql
do $$
declare
  u1 constant uuid := '00000000-0000-0000-0000-0000000000e1';
  ok boolean;
begin
  delete from public.mz_profiles where user_id = u1;
  -- an existing row keeps working: automatic mode, no range
  insert into public.mz_profiles (user_id) values (u1);
  if (select calorie_mode from public.mz_profiles where user_id = u1) <> 'auto' then raise exception '1: default mode'; end if;
  -- phase + custom range together
  update public.mz_profiles set goal_phase = 'recomp', calorie_mode = 'custom', kcal_min = 1900, kcal_max = 2100 where user_id = u1;
  -- switching back to automatic keeps the range
  update public.mz_profiles set calorie_mode = 'auto' where user_id = u1;
  if (select kcal_min from public.mz_profiles where user_id = u1) <> 1900 then raise exception '2: range lost'; end if;
  -- invalid values are refused
  begin update public.mz_profiles set kcal_min = 2200 where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '3: min > max accepted'; end if;
  begin update public.mz_profiles set kcal_min = -5 where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '4: negative accepted'; end if;
  begin update public.mz_profiles set goal_phase = 'bulk-max' where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '5: unknown phase accepted'; end if;
  begin update public.mz_profiles set calorie_mode = 'custom', kcal_min = null, kcal_max = null where user_id = u1; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '6: custom without a range accepted'; end if;
  raise notice 'calorie range checks passed';
end $$;
