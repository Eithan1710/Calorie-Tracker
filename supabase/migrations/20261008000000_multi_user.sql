-- מאזן — multi-user accounts
--
-- Replaces single-owner mode (every row owned by a fixed id, tables open to the
-- public key) with real per-user accounts:
--   * every mz_ row belongs to an auth user (user_id → auth.users, default auth.uid())
--   * RLS: a signed-in, non-anonymous user can only see and change their own rows.
--     The anon role (public key without a session) gets no table access at all.
--     Anonymous sign-ins (used by another app in this project) are excluded too.
--   * food photos live in a private Storage bucket under "<user_id>/…", with
--     owner-only storage policies.
--   * workouts gain optional per-exercise loads (`lifts`) and a rest-style field
--     used by the calorie engine; a 'walk' workout type is added.
--   * profiles gain a personal daily deficit target.
--
-- Written to be safe against both the repo's single-owner migration and the
-- variant that was applied live (policies altered in place, FKs kept): it drops
-- every existing mz_ policy by catalogue lookup and only adds FKs that are missing.
-- No data is deleted. Rows still owned by the old single-owner id stay in place
-- but become invisible to everyone (no session has that uid).

-- ── 1. drop every existing policy on mz_ tables ───────────────────────────
do $$
declare r record;
begin
  for r in select tablename, policyname from pg_policies where schemaname = 'public' and tablename like 'mz\_%'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ── 2. ownership: default to the caller, FK to auth.users ─────────────────
do $$
declare r record;
begin
  for r in
    select table_name from information_schema.columns
    where table_schema = 'public' and table_name like 'mz\_%' and column_name = 'user_id'
  loop
    execute format('alter table public.%I alter column user_id set default auth.uid()', r.table_name);
    if not exists (
      select 1 from pg_constraint c
      where c.contype = 'f' and c.conrelid = format('public.%I', r.table_name)::regclass and c.confrelid = 'auth.users'::regclass
    ) then
      -- NOT VALID: enforce for new rows without failing on legacy single-owner rows
      execute format('alter table public.%I add constraint %I foreign key (user_id) references auth.users (id) on delete cascade not valid',
        r.table_name, r.table_name || '_user_id_fkey');
    end if;
  end loop;
end $$;
alter table public.mz_ai_analysis_logs alter column user_id drop default; -- written by the edge function only

-- ── 3. schema additions ───────────────────────────────────────────────────
-- food photo: one optional photo per entry, stored at "<user_id>/<entry_id>.jpg"
alter table public.mz_food_entries add column if not exists photo_path text;
alter table public.mz_food_entries drop constraint if exists mz_food_entries_photo_path_check;
alter table public.mz_food_entries add constraint mz_food_entries_photo_path_check
  check (photo_path is null or (photo_path like user_id::text || '/%' and char_length(photo_path) <= 200));

-- workouts: optional per-exercise loads + rest style (training density)
alter table public.mz_exercises add column if not exists lifts jsonb not null default '[]'::jsonb;
alter table public.mz_exercises add column if not exists rest text;
alter table public.mz_exercises drop constraint if exists mz_exercises_lifts_check;
alter table public.mz_exercises add constraint mz_exercises_lifts_check
  check (jsonb_typeof(lifts) = 'array' and jsonb_array_length(lifts) <= 30);
alter table public.mz_exercises drop constraint if exists mz_exercises_rest_check;
alter table public.mz_exercises add constraint mz_exercises_rest_check check (rest is null or rest in ('short', 'standard'));
alter table public.mz_exercises drop constraint if exists mz_exercises_type_check;
alter table public.mz_exercises add constraint mz_exercises_type_check
  check (type in ('run', 'walk', 'strength', 'cycling', 'swimming', 'other'));

-- personal daily target: deficit band (burned − eaten), default the original 100–300
alter table public.mz_profiles add column if not exists deficit_min smallint not null default 100;
alter table public.mz_profiles add column if not exists deficit_max smallint not null default 300;
alter table public.mz_profiles drop constraint if exists mz_profiles_deficit_check;
alter table public.mz_profiles add constraint mz_profiles_deficit_check
  check (deficit_min between -500 and 1000 and deficit_max between -500 and 1000 and deficit_max > deficit_min);

-- ── 4. privileges: no anon access; RLS decides for signed-in users ────────
revoke all on public.mz_profiles, public.mz_food_entries, public.mz_exercises, public.mz_health_data,
  public.mz_daily_summaries, public.mz_ai_analysis_logs, public.mz_push_subscriptions, public.mz_health_ingest_tokens
  from anon;
grant select, insert, update, delete on public.mz_profiles, public.mz_food_entries, public.mz_exercises,
  public.mz_health_data, public.mz_daily_summaries, public.mz_push_subscriptions to authenticated;
revoke insert, update, delete on public.mz_ai_analysis_logs from authenticated;
grant select on public.mz_ai_analysis_logs to authenticated;
-- the Shortcuts token hash is write-only (set through mz_set_ingest_token)
revoke all on public.mz_health_ingest_tokens from authenticated;
grant select (user_id, created_at) on public.mz_health_ingest_tokens to authenticated;
grant delete on public.mz_health_ingest_tokens to authenticated;

alter table public.mz_profiles             enable row level security;
alter table public.mz_food_entries         enable row level security;
alter table public.mz_exercises            enable row level security;
alter table public.mz_health_data          enable row level security;
alter table public.mz_daily_summaries      enable row level security;
alter table public.mz_ai_analysis_logs     enable row level security;
alter table public.mz_push_subscriptions   enable row level security;
alter table public.mz_health_ingest_tokens enable row level security;

-- ── 5. owner-only policies (real accounts only, never anonymous sessions) ──
do $$
declare
  t text;
  own constant text := '(select auth.uid()) = user_id and coalesce(((select auth.jwt()) ->> ''is_anonymous'')::boolean, false) = false';
begin
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

-- ── 6. Shortcuts token: set for the caller only ───────────────────────────
create or replace function public.mz_set_ingest_token(token_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'not signed in' using errcode = '42501';
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

-- ── 7. Storage: private bucket for food photos ────────────────────────────
-- Objects are stored at "<user_id>/<entry_id>.jpg". The first path segment must
-- be the caller's uid for every operation, so nobody can list, read, overwrite
-- or delete another user's photos. The bucket is private: reads go through
-- short-lived signed URLs created by the owner's session.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mz-food-photos', 'mz-food-photos', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists mz_photos_select_own on storage.objects;
drop policy if exists mz_photos_insert_own on storage.objects;
drop policy if exists mz_photos_update_own on storage.objects;
drop policy if exists mz_photos_delete_own on storage.objects;

create policy mz_photos_select_own on storage.objects for select to authenticated
  using (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
create policy mz_photos_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
              and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);
create policy mz_photos_update_own on storage.objects for update to authenticated
  using (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false)
  with check (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy mz_photos_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'mz-food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
         and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) = false);

-- helpful indexes for per-user sync pulls
create index if not exists mz_exercises_user_date on public.mz_exercises (user_id, date);
create index if not exists mz_push_subscriptions_user on public.mz_push_subscriptions (user_id);
