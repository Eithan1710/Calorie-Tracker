-- מאזן — closed membership + workout volume / muscle groups
--
-- 1. Closed app: only accounts listed in mz_members may use מאזן. The Auth
--    project is shared with another app (sign-ups can't be switched off
--    project-wide), so "who is a user" is decided here, at the database level:
--    every mz_ policy and every photo policy also requires membership.
--    Anyone who creates an Auth account some other way gets nothing.
--    Accounts are created only by the project owner (SQL editor / service
--    role) with mz_create_member(username, password).
-- 2. Strength workouts: total volume lifted (kg) and the muscle groups worked,
--    used by the calorie engine as bounded secondary signals.

-- ── members ───────────────────────────────────────────────────────────────
create table if not exists public.mz_members (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  username   text not null unique check (char_length(username) between 1 and 40),
  created_at timestamptz not null default now()
);
alter table public.mz_members enable row level security;
revoke all on public.mz_members from anon, authenticated;
grant select on public.mz_members to authenticated;
drop policy if exists mz_members_select_own on public.mz_members;
create policy mz_members_select_own on public.mz_members for select to authenticated
  using ((select auth.uid()) = user_id);

-- is the caller a מאזן member? (security definer: usable inside other policies)
create or replace function public.mz_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.mz_members m
    where m.user_id = auth.uid()
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  )
$$;
revoke all on function public.mz_is_member() from public, anon;
grant execute on function public.mz_is_member() to authenticated;

-- ── every owner policy now also requires membership ───────────────────────
do $$
declare
  t text;
  own constant text := '(select auth.uid()) = user_id and (select public.mz_is_member())';
  r record;
begin
  for r in select tablename, policyname from pg_policies
           where schemaname = 'public' and tablename like 'mz\_%' and tablename <> 'mz_members'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
  foreach t in array array['mz_profiles', 'mz_food_entries', 'mz_exercises', 'mz_health_data', 'mz_daily_summaries', 'mz_push_subscriptions']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (%s)', t || '_select_own', t, own);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)', t || '_insert_own', t, own);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', t || '_update_own', t, own, own);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)', t || '_delete_own', t, own);
  end loop;
  execute format('create policy mz_ai_logs_select_own on public.mz_ai_analysis_logs for select to authenticated using (%s)', own);
  execute format('create policy mz_tokens_select_own on public.mz_health_ingest_tokens for select to authenticated using (%s)', own);
  execute format('create policy mz_tokens_delete_own on public.mz_health_ingest_tokens for delete to authenticated using (%s)', own);
end $$;

drop policy if exists mz_photos_select_own on storage.objects;
drop policy if exists mz_photos_insert_own on storage.objects;
drop policy if exists mz_photos_update_own on storage.objects;
drop policy if exists mz_photos_delete_own on storage.objects;
create policy mz_photos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mz_is_member()));
create policy mz_photos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mz_is_member()));
create policy mz_photos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mz_is_member()))
  with check (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy mz_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.mz_is_member()));

-- Shortcuts token: members only
create or replace function public.mz_set_ingest_token(token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not public.mz_is_member() then
    raise exception 'not a member' using errcode = '42501';
  end if;
  if token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'expected a sha-256 hex digest';
  end if;
  insert into public.mz_health_ingest_tokens (user_id, token_hash, created_at)
  values (uid, token_hash, now())
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = excluded.created_at;
end $$;
revoke all on function public.mz_set_ingest_token(text) from public, anon;
grant execute on function public.mz_set_ingest_token(text) to authenticated;

-- ── account administration (owner only: SQL editor / service role) ────────
-- Same mapping as supabase/functions/_shared/account.ts:
--   login address = 'u' || first 40 hex of sha256('maazan:' || lower(nfkc(trim(username)))) || '@users.maazan.app'
--   auth password = 'maazan:' || password   (lets members use short passwords while
--                                            the shared Auth project keeps its minimum length)
create or replace function public.mz_account_email(username text) returns text
language sql immutable set search_path = '' as $$
  select 'u' || left(encode(extensions.digest('maazan:' || lower(normalize(btrim(username), nfkc)), 'sha256'), 'hex'), 40) || '@users.maazan.app'
$$;

create or replace function public.mz_create_member(username text, password text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := gen_random_uuid();
  mail text := public.mz_account_email(username);
  display text := normalize(btrim(username), nfkc);
begin
  if coalesce(password, '') = '' then raise exception 'password required'; end if;
  if exists (select 1 from auth.users where email = mail) then raise exception 'username % already exists', display; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
          extensions.crypt('maazan:' || password, extensions.gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('username', display, 'app', 'maazan'), now(), now(),
          '', '', '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, 'email',
          jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true), now(), now(), now());
  insert into public.mz_members (user_id, username) values (uid, display);
  return uid;
end $$;

create or replace function public.mz_set_member_password(username text, password text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(password, '') = '' then raise exception 'password required'; end if;
  update auth.users set encrypted_password = extensions.crypt('maazan:' || password, extensions.gen_salt('bf')), updated_at = now()
  where email = public.mz_account_email(username);
  if not found then raise exception 'no such username'; end if;
end $$;

revoke all on function public.mz_account_email(text) from public, anon, authenticated;
revoke all on function public.mz_create_member(text, text) from public, anon, authenticated;
revoke all on function public.mz_set_member_password(text, text) from public, anon, authenticated;
grant execute on function public.mz_create_member(text, text) to service_role;
grant execute on function public.mz_set_member_password(text, text) to service_role;

-- ── strength workouts: total volume + muscle groups ───────────────────────
alter table public.mz_exercises add column if not exists volume_kg numeric(8, 0);
alter table public.mz_exercises add column if not exists muscles text[] not null default '{}';
alter table public.mz_exercises drop constraint if exists mz_exercises_volume_check;
alter table public.mz_exercises add constraint mz_exercises_volume_check check (volume_kg is null or volume_kg between 0 and 200000);
alter table public.mz_exercises drop constraint if exists mz_exercises_muscles_check;
alter table public.mz_exercises add constraint mz_exercises_muscles_check
  check (muscles <@ array['legs', 'back', 'chest', 'shoulders', 'arms', 'core', 'full_body']::text[]);
