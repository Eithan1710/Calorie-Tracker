-- Tests for 20261105000000_creatine.sql on a plain Postgres. NEVER run against the real project.
create table if not exists public.mz_profiles (user_id uuid primary key);
insert into public.mz_profiles (user_id) values ('00000000-0000-0000-0000-0000000000c1') on conflict do nothing;
\ir ../migrations/20261105000000_creatine.sql
\ir ../migrations/20261105000000_creatine.sql
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000000c1';
  ok boolean;
begin
  update public.mz_profiles set creatine = '{"start":"2026-10-25","loading":false}' where user_id = u;
  if (select creatine ->> 'start' from public.mz_profiles where user_id = u) <> '2026-10-25' then raise exception '1: not saved'; end if;
  update public.mz_profiles set creatine = null where user_id = u;
  begin update public.mz_profiles set creatine = '"yes"' where user_id = u; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '2: malformed accepted'; end if;
  begin update public.mz_profiles set creatine = '{"loading":true}' where user_id = u; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '3: no start accepted'; end if;
  begin update public.mz_profiles set creatine = '{"start":"2026-10-25","loading":"yes"}' where user_id = u; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '4: bad loading accepted'; end if;
  raise notice 'creatine checks passed';
end $$;
