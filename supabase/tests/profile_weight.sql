-- Tests for 20261101000000_profile_weight_hundredths.sql on a plain Postgres. NEVER run against the real project.
create table if not exists public.mz_profiles (user_id uuid primary key);
alter table public.mz_profiles add column if not exists weight_kg numeric(5, 1);
insert into public.mz_profiles (user_id, weight_kg) values ('00000000-0000-0000-0000-0000000000e1', 61.4) on conflict (user_id) do update set weight_kg = 61.4;
\ir ../migrations/20261101000000_profile_weight_hundredths.sql
\ir ../migrations/20261101000000_profile_weight_hundredths.sql
do $$
begin
  if (select weight_kg from public.mz_profiles where user_id = '00000000-0000-0000-0000-0000000000e1') <> 61.4 then raise exception '1: existing value changed'; end if;
  update public.mz_profiles set weight_kg = 59.65 where user_id = '00000000-0000-0000-0000-0000000000e1';
  if (select weight_kg from public.mz_profiles where user_id = '00000000-0000-0000-0000-0000000000e1') <> 59.65 then raise exception '2: 59.65 was rounded'; end if;
  raise notice 'profile weight checks passed';
end $$;
