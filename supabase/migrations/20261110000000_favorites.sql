-- מאזן — favourite meals on the profile (additive, safe to re-run).
--
-- mz_profiles.favorites  [{"id":"…","title":"קפה עם סוכר","emoji":"☕","items":[…],"totals":{…}}, …] or null.
--   Meals the member logs often (a coffee with a teaspoon of sugar): one tap on the Today screen logs a copy.
--   Kept on the profile so every device shows the same favourites. At most 12, a few KB.
-- Row-level security on mz_profiles is unchanged (own row only).
alter table public.mz_profiles add column if not exists favorites jsonb;
alter table public.mz_profiles drop constraint if exists mz_profiles_favorites_check;
alter table public.mz_profiles add constraint mz_profiles_favorites_check
  check (favorites is null or coalesce(jsonb_typeof(favorites) = 'array'
         and jsonb_array_length(favorites) <= 12
         and octet_length(favorites::text) <= 65536, false));
