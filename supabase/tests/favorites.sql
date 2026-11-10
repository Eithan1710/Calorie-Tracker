-- Tests for 20261110000000_favorites.sql on a plain Postgres. NEVER run against the real project.
create table if not exists public.mz_profiles (user_id uuid primary key);
insert into public.mz_profiles (user_id) values ('00000000-0000-0000-0000-0000000000f1') on conflict do nothing;
\ir ../migrations/20261110000000_favorites.sql
\ir ../migrations/20261110000000_favorites.sql
do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000000f1';
  ok boolean;
begin
  update public.mz_profiles set favorites = '[{"id":"a","title":"קפה עם סוכר","emoji":"☕","items":[],"totals":{}}]' where user_id = u;
  if (select favorites -> 0 ->> 'title' from public.mz_profiles where user_id = u) <> 'קפה עם סוכר' then raise exception '1: not saved'; end if;
  update public.mz_profiles set favorites = null where user_id = u;
  update public.mz_profiles set favorites = '[]' where user_id = u;
  begin update public.mz_profiles set favorites = '{"id":"a"}' where user_id = u; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '2: an object instead of a list was accepted'; end if;
  begin update public.mz_profiles set favorites = (select jsonb_agg(jsonb_build_object('id', g::text)) from generate_series(1, 13) g) where user_id = u; ok := true; exception when check_violation then ok := false; end;
  if ok then raise exception '3: 13 favourites were accepted'; end if;
  raise notice 'favorites checks passed';
end $$;
