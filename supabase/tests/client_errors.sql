-- Tests for 20261107000000_client_errors.sql on a plain Postgres (after weights.sql: auth.users + members exist).
-- NEVER run this against the real project.
\set ON_ERROR_STOP 1
reset role;
\ir ../migrations/20261107000000_client_errors.sql
\ir ../migrations/20261107000000_client_errors.sql
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
insert into public.mz_client_errors (user_id, message, stack, where_, path, app_version, user_agent)
  values ('00000000-0000-0000-0000-0000000000c1', 'TypeError: x is undefined', 'at Today', 'render', '/', 'abc', 'test');
do $$
declare ok boolean;
begin
  -- someone else's row is refused
  begin
    insert into public.mz_client_errors (user_id, message) values ('00000000-0000-0000-0000-0000000000c2', 'x');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception '1: wrote another user''s error row'; end if;
  -- members can't read errors back (not even their own)
  begin
    perform count(*) from public.mz_client_errors;
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception '2: errors are readable through the API role'; end if;
  -- oversized message refused
  begin
    insert into public.mz_client_errors (user_id, message) values ('00000000-0000-0000-0000-0000000000c1', repeat('x', 400));
    ok := true;
  exception when check_violation then ok := false;
  end;
  if ok then raise exception '3: oversized message accepted'; end if;
end $$;
-- a non-member (c3) can't write either
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c3', false);
do $$
declare ok boolean;
begin
  begin
    insert into public.mz_client_errors (user_id, message) values ('00000000-0000-0000-0000-0000000000c3', 'x');
    ok := true;
  exception when insufficient_privilege then ok := false;
  end;
  if ok then raise exception '4: non-member wrote an error row'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.mz_client_errors) <> 1 then raise exception '5: expected exactly the one valid row'; end if;
  raise notice 'client errors checks passed';
end $$;
