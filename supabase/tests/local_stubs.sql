-- Minimal stand-ins for the Supabase platform objects the migrations rely on, so the
-- food-database migration and search can be tested on a plain Postgres (CI / local).
-- NEVER run this against the real project.
create schema if not exists extensions;
create schema if not exists auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public, extensions, auth to anon, authenticated, service_role;

create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create table if not exists public.mz_members (user_id uuid primary key, username text);
create or replace function public.mz_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.mz_members m where m.user_id = auth.uid())
$$;
grant execute on function public.mz_is_member() to authenticated;
