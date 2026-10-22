-- Tests for public.mz_weights (20261015000000_body_weight.sql) on a plain Postgres.
-- Run after local_stubs.sql + this file's base objects + the migration (twice). Fails loudly.
-- NEVER run this against the real project.
\set ON_ERROR_STOP 1
create table if not exists auth.users (id uuid primary key);
create or replace function public.mz_touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.updated_at is null or new.updated_at < old.updated_at then new.updated_at := now(); end if;
  return new;
end $$;
insert into auth.users values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2'), ('00000000-0000-0000-0000-0000000000c3')
  on conflict do nothing;
insert into public.mz_members (user_id, username) values ('00000000-0000-0000-0000-0000000000c1', 'a'), ('00000000-0000-0000-0000-0000000000c2', 'b')
  on conflict do nothing;
\ir ../migrations/20261015000000_body_weight.sql
\ir ../migrations/20261015000000_body_weight.sql
\ir ../migrations/20261023000000_weights_keep_newest.sql
\ir ../migrations/20261023000000_weights_keep_newest.sql

-- user A (member)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
insert into public.mz_weights (user_id, date, weight_kg) values ('00000000-0000-0000-0000-0000000000c1', '2026-10-08', 61.4);
-- same day again = a correction through upsert, never a second row
insert into public.mz_weights (user_id, date, weight_kg) values ('00000000-0000-0000-0000-0000000000c1', '2026-10-08', 61.2)
  on conflict (user_id, date) do update set weight_kg = excluded.weight_kg, updated_at = now();
do $$ begin
  if (select count(*) from public.mz_weights) <> 1 then raise exception 'duplicate day rows'; end if;
  if (select weight_kg from public.mz_weights) <> 61.2 then raise exception 'correction not applied'; end if;
  begin
    insert into public.mz_weights (user_id, date, weight_kg) values ('00000000-0000-0000-0000-0000000000c1', '2026-10-09', 500);
    raise exception 'out-of-range weight accepted';
  exception when check_violation then null;
  end;
  -- writing a row for someone else is refused
  begin
    insert into public.mz_weights (user_id, date, weight_kg) values ('00000000-0000-0000-0000-0000000000c2', '2026-10-08', 70);
    raise exception 'wrote another user''s row';
  exception when insufficient_privilege then null;
  end;
end $$;

-- the app's upsert (client timestamps): newest version of a day wins, a stale copy never does
do $$
declare
  a constant uuid := '00000000-0000-0000-0000-0000000000c1';
  h record;
begin
  insert into public.mz_weights as w (user_id, date, weight_kg, created_at, updated_at, deleted_at)
    values (a, '2026-10-20', 65.0, '2026-10-20T18:00:00Z', '2026-10-20T18:00:00Z', null)
    on conflict (user_id, date) do update set weight_kg = excluded.weight_kg, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at;
  -- a newer correction from another device
  insert into public.mz_weights as w (user_id, date, weight_kg, created_at, updated_at, deleted_at)
    values (a, '2026-10-20', 64.6, '2026-10-20T19:00:00Z', '2026-10-20T19:00:00Z', null)
    on conflict (user_id, date) do update set weight_kg = excluded.weight_kg, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at;
  select * into h from public.mz_weights where user_id = a and date = '2026-10-20';
  if h.weight_kg <> 64.6 then raise exception 'newer correction not applied: %', row_to_json(h); end if;
  if h.created_at <> '2026-10-20T18:00:00Z' then raise exception 'first-logged time lost: %', row_to_json(h); end if;
  -- a device that was offline sends its older copy (even a delete): the newer weigh-in stays
  insert into public.mz_weights as w (user_id, date, weight_kg, created_at, updated_at, deleted_at)
    values (a, '2026-10-20', 65.0, '2026-10-20T18:00:00Z', '2026-10-20T18:30:00Z', '2026-10-20T18:30:00Z')
    on conflict (user_id, date) do update set weight_kg = excluded.weight_kg, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at;
  select * into h from public.mz_weights where user_id = a and date = '2026-10-20';
  if h.weight_kg <> 64.6 or h.deleted_at is not null or h.updated_at <> '2026-10-20T19:00:00Z' then raise exception 'stale copy replaced a newer weigh-in: %', row_to_json(h); end if;
  -- a newer delete is a real delete (soft: the row and its value stay)
  insert into public.mz_weights as w (user_id, date, weight_kg, created_at, updated_at, deleted_at)
    values (a, '2026-10-20', 64.6, '2026-10-20T18:00:00Z', '2026-10-20T20:00:00Z', '2026-10-20T20:00:00Z')
    on conflict (user_id, date) do update set weight_kg = excluded.weight_kg, created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at;
  if (select deleted_at from public.mz_weights where user_id = a and date = '2026-10-20') is null then raise exception 'newer delete ignored'; end if;
  -- history: other days untouched, one row per day
  if (select count(*) from public.mz_weights where user_id = a) <> 2 then raise exception 'history rows: %', (select count(*) from public.mz_weights where user_id = a); end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.mz_weights'::regclass and not tgisinternal) <> 1 then raise exception 'expected exactly one trigger'; end if;
end $$;

-- user B (member) sees nothing of A and cannot change it
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', false);
do $$ declare n int; begin
  if (select count(*) from public.mz_weights) <> 0 then raise exception 'B sees A''s weights'; end if;
  update public.mz_weights set weight_kg = 99 where date = '2026-10-08';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B updated A''s row'; end if;
  delete from public.mz_weights where date = '2026-10-08';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B deleted A''s row'; end if;
end $$;

-- user C is signed in but not a member: no access at all
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false);
do $$ begin
  begin
    insert into public.mz_weights (user_id, date, weight_kg) values ('00000000-0000-0000-0000-0000000000c3', '2026-10-08', 70);
    raise exception 'non-member could write';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- anon has no grant at all
set role anon;
do $$ begin
  begin
    perform 1 from public.mz_weights;
    raise exception 'anon could read';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin
  if (select weight_kg from public.mz_weights where user_id = '00000000-0000-0000-0000-0000000000c1' and date = '2026-10-08') <> 61.2 then raise exception 'A''s row changed'; end if;
  raise notice 'weight checks passed';
end $$;
