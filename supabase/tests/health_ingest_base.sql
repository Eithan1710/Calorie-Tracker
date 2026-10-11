-- The two existing tables the health migration extends, as the earlier migrations leave
-- them (without the auth.users foreign keys), for testing on a plain Postgres.
-- NEVER run this against the real project.
create table if not exists public.mz_health_data (
  user_id     uuid not null,
  date        date not null,
  steps       integer not null default 0 check (steps between 0 and 150000),
  active_kcal numeric(6, 1),
  source      text not null default 'manual' check (source in ('manual', 'shortcut', 'url')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);
create table if not exists public.mz_exercises (
  id           uuid primary key,
  user_id      uuid not null,
  date         date not null,
  type         text not null check (type in ('run', 'walk', 'strength', 'cycling', 'swimming', 'other')),
  duration_min numeric(6, 1) check (duration_min between 0 and 1440),
  distance_km  numeric(6, 2) check (distance_km between 0 and 500),
  intensity    text check (intensity in ('low', 'moderate', 'high')),
  rest         text,
  lifts        jsonb not null default '[]'::jsonb,
  volume_kg    numeric(8, 0),
  muscles      text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
grant select, insert, update, delete on public.mz_health_data, public.mz_exercises to authenticated;
