-- מאזן — body-weight log: a stale write can never replace a newer weigh-in (safe to re-run).
--
-- mz_weights used the shared mz_touch_updated_at() trigger, which turns an OLDER write into a
-- new one (updated_at := now()). For the weight log that meant a device holding an old copy
-- of a day (offline for a while, a wrong clock) could overwrite a newer weigh-in made on
-- another device, and the overwrite then looked like the newest version everywhere.
-- Now: the newest updated_at wins on the server too; an older upsert leaves the row as it is
-- (the app then reads the newer row back on its next sync). Nothing is deleted or rewritten.
create or replace function public.mz_weights_keep_newest() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.updated_at is null then
    new.updated_at := now();
  elsif new.updated_at < old.updated_at then
    return old; -- stale copy: keep the newer weigh-in
  end if;
  new.created_at := least(old.created_at, new.created_at); -- the first time this day was logged
  return new;
end $$;

drop trigger if exists mz_weights_touch on public.mz_weights;
drop trigger if exists mz_weights_keep_newest on public.mz_weights;
create trigger mz_weights_keep_newest before update on public.mz_weights
  for each row execute function public.mz_weights_keep_newest();
