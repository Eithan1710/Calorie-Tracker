-- מאזן — RLS / Storage isolation check.
-- Run in the Supabase SQL editor (or psql) AFTER applying 20261008000000_multi_user.sql.
-- Everything happens inside one transaction that is rolled back: no data is kept.
-- Expected output: a single row "all isolation checks passed". Any failure raises an error.

begin;

-- two throw-away accounts
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'aaaaaaaa-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'rls-test-a@users.maazan.app', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'bbbbbbbb-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'rls-test-b@users.maazan.app', '', now(), '{}', '{}', now(), now());

-- ── act as user A ──
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);

insert into public.mz_profiles (user_id, sex, age, height_cm, weight_kg) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'male', 32, 178, 82);
insert into public.mz_food_entries (id, date, meal, title, photo_path)
  values ('11111111-0000-4000-8000-000000000001', '2026-10-08', 'lunch', 'A lunch', 'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/p.jpg');
insert into public.mz_exercises (id, date, type, duration_min, intensity, rest, lifts)
  values ('11111111-0000-4000-8000-000000000002', '2026-10-08', 'strength', 60, 'moderate', 'standard', '[{"id":"x","name":"bench","weight_kg":68}]');
insert into storage.objects (bucket_id, name, owner) values ('mz-food-photos', 'aaaaaaaa-0000-4000-8000-00000000000a/11111111-0000-4000-8000-000000000001/p.jpg', 'aaaaaaaa-0000-4000-8000-00000000000a');

do $$
begin
  -- A cannot write rows for B
  begin
    insert into public.mz_food_entries (id, user_id, date, meal, title) values ('11111111-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-00000000000b', '2026-10-08', 'lunch', 'forged');
    raise exception 'FAIL: user A inserted a row owned by B';
  exception when insufficient_privilege then null;
  end;
  -- A cannot put a photo in B's folder
  begin
    insert into storage.objects (bucket_id, name, owner) values ('mz-food-photos', 'bbbbbbbb-0000-4000-8000-00000000000b/x/p.jpg', 'aaaaaaaa-0000-4000-8000-00000000000a');
    raise exception 'FAIL: user A wrote into B''s photo folder';
  exception when insufficient_privilege then null;
  end;
  -- photo_path must live in the owner's folder
  begin
    insert into public.mz_food_entries (id, date, meal, title, photo_path) values ('11111111-0000-4000-8000-000000000004', '2026-10-08', 'lunch', 'bad path', 'bbbbbbbb-0000-4000-8000-00000000000b/x/p.jpg');
    raise exception 'FAIL: photo_path outside the owner folder was accepted';
  exception when check_violation then null;
  end;
end $$;

-- ── act as user B ──
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated","is_anonymous":false}', true);

do $$
declare n int;
begin
  select count(*) into n from public.mz_profiles;      if n <> 0 then raise exception 'FAIL: B sees % profiles', n; end if;
  select count(*) into n from public.mz_food_entries;  if n <> 0 then raise exception 'FAIL: B sees % food entries', n; end if;
  select count(*) into n from public.mz_exercises;     if n <> 0 then raise exception 'FAIL: B sees % workouts', n; end if;
  select count(*) into n from storage.objects where bucket_id = 'mz-food-photos'; if n <> 0 then raise exception 'FAIL: B sees % photos', n; end if;

  update public.mz_food_entries set title = 'hacked' where id = '11111111-0000-4000-8000-000000000001';
  delete from public.mz_exercises where id = '11111111-0000-4000-8000-000000000002';
  -- (photo deletes can't be tested here: Supabase blocks any direct SQL delete on storage.objects;
  --  the mz_photos_delete_own policy guards deletes made through the Storage API)
end $$;

-- ── anonymous session (another app in this project) sees nothing ──
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated","is_anonymous":true}', true);
do $$
declare n int;
begin
  select count(*) into n from public.mz_food_entries; if n <> 0 then raise exception 'FAIL: anonymous session sees rows'; end if;
end $$;

-- ── public key without a session (anon role) has no table access ──
reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.mz_food_entries limit 1;
    raise exception 'FAIL: anon role can read mz_food_entries';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── back to A: B's update/delete attempts changed nothing ──
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","is_anonymous":false}', true);
do $$
declare t text; n int;
begin
  select title into t from public.mz_food_entries where id = '11111111-0000-4000-8000-000000000001';
  if t is distinct from 'A lunch' then raise exception 'FAIL: B modified A''s entry (title=%)', t; end if;
  select count(*) into n from public.mz_exercises; if n <> 1 then raise exception 'FAIL: B deleted A''s workout'; end if;
  select count(*) into n from storage.objects where bucket_id = 'mz-food-photos'; if n <> 1 then raise exception 'FAIL: B deleted A''s photo'; end if;
end $$;

select 'all isolation checks passed' as result;

rollback;
