-- Single-owner mode: the app has exactly one user (its owner) and no login.
-- All rows belong to a fixed owner id; the app reads/writes the mz_ tables
-- directly with the public key. Every device opening the app sees the same data.
--
-- To go multi-user later: drop the mz_open_* policies, restore per-user
-- policies (auth.uid() = user_id) and re-add the auth.users foreign keys.

do $$
declare r record;
begin
  -- user ids are no longer auth users
  for r in
    select c.conname, c.conrelid::regclass::text as tbl
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and c.conrelid::regclass::text like 'mz\_%'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  -- replace the per-user policies with open ones
  for r in select tablename, policyname from pg_policies where schemaname = 'public' and tablename like 'mz\_%'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;

  for r in
    select table_name from information_schema.columns
    where table_schema = 'public' and table_name like 'mz\_%' and column_name = 'user_id'
  loop
    execute format('alter table public.%I alter column user_id set default %L::uuid', r.table_name, '00000000-0000-4000-8000-000000000001');
    if r.table_name <> 'mz_ai_analysis_logs' then
      execute format('create policy %I on public.%I for all to anon, authenticated using (true) with check (true)', 'mz_open_' || r.table_name, r.table_name);
    else
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)', 'mz_open_' || r.table_name, r.table_name);
    end if;
  end loop;
end $$;

-- The Shortcuts token hash stays write-only: the app sets it through this function
-- (a plain upsert would need SELECT on token_hash). Only a SHA-256 hash is stored.
revoke select, insert, update, delete on public.mz_health_ingest_tokens from anon, authenticated;
grant select (user_id, created_at) on public.mz_health_ingest_tokens to anon, authenticated;

create or replace function public.mz_set_ingest_token(token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'expected a sha-256 hex digest';
  end if;
  insert into public.mz_health_ingest_tokens (user_id, token_hash, created_at)
  values ('00000000-0000-4000-8000-000000000001', token_hash, now())
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = excluded.created_at;
end $$;
revoke all on function public.mz_set_ingest_token(text) from public;
grant execute on function public.mz_set_ingest_token(text) to anon, authenticated;
