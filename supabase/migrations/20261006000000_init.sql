-- מאזן — initial schema
-- Local-first app: the browser is the source of truth while offline, and syncs
-- rows here when signed in. Every table is private to its owner via RLS.
-- Personal data kept to the minimum needed for the energy model (no name, no
-- birth date — only age; no photos are ever stored).

create extension if not exists pgcrypto;

-- ── profiles ──────────────────────────────────────────────────────────────
create table public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  sex              text not null check (sex in ('male', 'female')),
  age              smallint not null check (age between 14 and 100),
  height_cm        numeric(5, 1) not null check (height_cm between 120 and 230),
  weight_kg        numeric(5, 1) not null check (weight_kg between 35 and 250),
  protein_target_g smallint not null default 120 check (protein_target_g between 40 and 300),
  reminder_enabled boolean not null default false,
  reminder_time    time not null default '21:30',
  timezone         text not null default 'Asia/Jerusalem',
  updated_at       timestamptz not null default now()
);

-- ── food_entries ──────────────────────────────────────────────────────────
-- One logged meal/snack. `items` holds the validated per-item breakdown
-- (name, grams, per-100 g values, source, confidence, assumptions) as JSONB:
-- items are always read/written together with their entry, and keeping them
-- in one row makes offline sync atomic. Totals are denormalised for queries.
create table public.food_entries (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date           date not null,
  meal           text not null check (meal in ('breakfast', 'lunch', 'snack', 'dinner')),
  title          text not null check (char_length(title) <= 120),
  emoji          text not null default '🍽️',
  items          jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  calories       numeric(7, 1) not null default 0 check (calories between 0 and 20000),
  protein_g      numeric(6, 1) not null default 0 check (protein_g >= 0),
  fat_g          numeric(6, 1) not null default 0 check (fat_g >= 0),
  carbs_g        numeric(6, 1) not null default 0 check (carbs_g >= 0),
  calories_low   numeric(7, 1),
  calories_high  numeric(7, 1),
  confidence     numeric(3, 2) not null default 0 check (confidence between 0 and 1),
  provider       text not null default 'ai',
  raw_text       text check (char_length(raw_text) <= 1000),
  status         text not null default 'ok' check (status in ('ok', 'pending')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index food_entries_user_date on public.food_entries (user_id, date);
create index food_entries_user_updated on public.food_entries (user_id, updated_at);

-- ── exercises ─────────────────────────────────────────────────────────────
create table public.exercises (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date         date not null,
  type         text not null check (type in ('run', 'strength', 'cycling', 'swimming', 'other')),
  duration_min numeric(6, 1) check (duration_min between 0 and 1440),
  distance_km  numeric(6, 2) check (distance_km between 0 and 500),
  intensity    text check (intensity in ('low', 'moderate', 'high')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index exercises_user_updated on public.exercises (user_id, updated_at);

-- ── health_data (steps; written by the app or by the Apple Shortcuts bridge) ─
create table public.health_data (
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date        date not null,
  steps       integer not null default 0 check (steps between 0 and 150000),
  active_kcal numeric(6, 1),
  source      text not null default 'manual' check (source in ('manual', 'shortcut', 'url')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);
create index health_data_user_updated on public.health_data (user_id, updated_at);

-- ── daily_summaries (cache computed by the app; used by reminders & server-side history) ─
create table public.daily_summaries (
  user_id      uuid not null references auth.users (id) on delete cascade default auth.uid(),
  date         date not null,
  calories_in  numeric(7, 1) not null default 0,
  calories_out numeric(7, 1) not null default 0,
  deficit      numeric(7, 1) generated always as (calories_out - calories_in) stored,
  protein_g    numeric(6, 1) not null default 0,
  fat_g        numeric(6, 1) not null default 0,
  carbs_g      numeric(6, 1) not null default 0,
  steps        integer not null default 0,
  entries      smallint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, date)
);

-- ── ai_analysis_logs (written by the analyze-food function; no images, text truncated) ─
create table public.ai_analysis_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  input_kind  text not null check (input_kind in ('text', 'photo', 'correction')),
  input_text  text check (char_length(input_text) <= 200),
  provider    text not null,
  model       text,
  success     boolean not null,
  error_code  text,
  latency_ms  integer,
  attempts    jsonb not null default '[]'::jsonb
);
create index ai_logs_user_created on public.ai_analysis_logs (user_id, created_at desc);

-- ── push_subscriptions (Web Push for the 21:30 reminder) ──────────────────
create table public.push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade default auth.uid(),
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  timezone       text not null default 'Asia/Jerusalem',
  reminder_time  time not null default '21:30',
  enabled        boolean not null default true,
  last_sent_on   date,
  created_at     timestamptz not null default now()
);

-- ── health_ingest_tokens (personal token for the Shortcuts automation; hash only) ─
create table public.health_ingest_tokens (
  user_id    uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_at timestamptz not null default now()
);

-- ── Row Level Security: owner-only everywhere ─────────────────────────────
alter table public.profiles             enable row level security;
alter table public.food_entries         enable row level security;
alter table public.exercises            enable row level security;
alter table public.health_data          enable row level security;
alter table public.daily_summaries      enable row level security;
alter table public.ai_analysis_logs     enable row level security;
alter table public.push_subscriptions   enable row level security;
alter table public.health_ingest_tokens enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles', 'food_entries', 'exercises', 'health_data', 'daily_summaries', 'push_subscriptions']
  loop
    execute format('create policy "%1$s_select_own" on public.%1$I for select to authenticated using ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s_insert_own" on public.%1$I for insert to authenticated with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s_update_own" on public.%1$I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('create policy "%1$s_delete_own" on public.%1$I for delete to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- logs: the user may read their own; only the service role (edge function) writes
create policy "ai_logs_select_own" on public.ai_analysis_logs for select to authenticated using ((select auth.uid()) = user_id);

-- ingest token: the user may create/rotate/delete theirs but never read the hash back
create policy "tokens_insert_own" on public.health_ingest_tokens for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tokens_update_own" on public.health_ingest_tokens for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tokens_delete_own" on public.health_ingest_tokens for delete to authenticated using ((select auth.uid()) = user_id);
-- upsert needs to see the existing row for conflict resolution; expose only existence
create policy "tokens_select_own" on public.health_ingest_tokens for select to authenticated using ((select auth.uid()) = user_id);
-- column privileges only bite once the table-wide grant is gone
revoke select on public.health_ingest_tokens from authenticated, anon;
grant select (user_id, created_at) on public.health_ingest_tokens to authenticated;

-- keep updated_at honest when a client forgets
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin
  if new.updated_at is null or new.updated_at < old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger food_touch before update on public.food_entries for each row execute function public.touch_updated_at();
create trigger exercises_touch before update on public.exercises for each row execute function public.touch_updated_at();
