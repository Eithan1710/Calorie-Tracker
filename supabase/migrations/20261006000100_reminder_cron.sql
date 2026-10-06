-- Daily reminder scheduler: every 15 minutes, call the send-reminders edge
-- function, which notifies subscriptions whose local time just passed their
-- reminder_time (default 21:30) and that haven't been notified today.
--
-- Before running this, store two secrets in Vault (Dashboard → Project Settings → Vault):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<a long random string>', 'cron_secret');
-- and set the same CRON_SECRET for the function:
--   supabase secrets set CRON_SECRET=<a long random string>

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'maazan-daily-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
