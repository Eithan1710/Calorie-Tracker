-- Tests for 20261120000000_routine_off.sql on a plain Postgres. NEVER run against the real project.
create table if not exists public.mz_profiles (user_id uuid primary key);
insert into public.mz_profiles (user_id) values ('00000000-0000-0000-0000-0000000000a1') on conflict do nothing;
\ir ../migrations/20261120000000_routine_off.sql
\ir ../migrations/20261120000000_routine_off.sql
do $$
declare u constant uuid := '00000000-0000-0000-0000-0000000000a1';
begin
  if (select routine_off from public.mz_profiles where user_id = u) is distinct from false then raise exception '1: default should be false'; end if;
  update public.mz_profiles set routine_off = true where user_id = u;
  if not (select routine_off from public.mz_profiles where user_id = u) then raise exception '2: not saved'; end if;
  raise notice 'routine_off checks passed';
end $$;
