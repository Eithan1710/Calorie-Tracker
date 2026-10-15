-- מאזן — body-weight log (additive, safe to re-run).
--
-- One measurement per user per calendar day: the primary key is (user_id, date), so a
-- second entry for the same day is an update (a correction), never a duplicate — also
-- when two devices log the same day offline. Deletes are soft (deleted_at) so they
-- reach the user's other devices through the regular sync, like every other table.
-- Same access rules as the rest of the app: members only, own rows only (RLS).

create table if not exists public.mz_weights (
  user_id    uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date       date not null,
  weight_kg  numeric(5, 2) not null check (weight_kg between 20 and 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, date)
);
create index if not exists mz_weights_user_updated on public.mz_weights (user_id, updated_at);

revoke all on public.mz_weights from anon;
grant select, insert, update, delete on public.mz_weights to authenticated;
alter table public.mz_weights enable row level security;

drop policy if exists mz_weights_select_own on public.mz_weights;
drop policy if exists mz_weights_insert_own on public.mz_weights;
drop policy if exists mz_weights_update_own on public.mz_weights;
drop policy if exists mz_weights_delete_own on public.mz_weights;
create policy mz_weights_select_own on public.mz_weights for select to authenticated
  using ((select auth.uid()) = user_id and (select public.mz_is_member()));
create policy mz_weights_insert_own on public.mz_weights for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.mz_is_member()));
create policy mz_weights_update_own on public.mz_weights for update to authenticated
  using ((select auth.uid()) = user_id and (select public.mz_is_member()))
  with check ((select auth.uid()) = user_id and (select public.mz_is_member()));
create policy mz_weights_delete_own on public.mz_weights for delete to authenticated
  using ((select auth.uid()) = user_id and (select public.mz_is_member()));

drop trigger if exists mz_weights_touch on public.mz_weights;
create trigger mz_weights_touch before update on public.mz_weights
  for each row execute function public.mz_touch_updated_at();
