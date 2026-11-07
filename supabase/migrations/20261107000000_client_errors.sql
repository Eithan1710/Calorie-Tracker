-- מאזן — client error monitoring (additive, safe to re-run).
--
-- mz_client_errors: unexpected errors from the app (message, trimmed stack, screen, version, browser).
-- No food / health / personal data. Members can only INSERT their own rows; nobody can read them through
-- the API (no select policy) — the owner reads them in the Supabase dashboard. Old rows are trimmed to 90 days.
create table if not exists public.mz_client_errors (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  message text not null check (char_length(message) <= 300),
  stack text check (char_length(stack) <= 1500),
  where_ text check (char_length(where_) <= 40),
  path text check (char_length(path) <= 120),
  app_version text check (char_length(app_version) <= 64),
  user_agent text check (char_length(user_agent) <= 200)
);
create index if not exists mz_client_errors_created on public.mz_client_errors (created_at desc);

alter table public.mz_client_errors enable row level security;
drop policy if exists mz_client_errors_insert_own on public.mz_client_errors;
create policy mz_client_errors_insert_own on public.mz_client_errors
  for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.mz_is_member()));
grant insert on public.mz_client_errors to authenticated;
revoke select, update, delete on public.mz_client_errors from anon, authenticated;

-- keep it small: drop rows older than 90 days, at most once a day, from the insert path
create or replace function public.mz_client_errors_trim() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if random() < 0.05 then
    delete from public.mz_client_errors where created_at < now() - interval '90 days';
  end if;
  return new;
end $$;
revoke all on function public.mz_client_errors_trim() from public, anon, authenticated;
drop trigger if exists mz_client_errors_trim on public.mz_client_errors;
create trigger mz_client_errors_trim after insert on public.mz_client_errors
  for each statement execute function public.mz_client_errors_trim();
