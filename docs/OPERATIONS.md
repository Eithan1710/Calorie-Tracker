# מאזן — operations runbook

Everything needed to deploy, change, monitor and recover the app. The app is **members-only**:
there is no public sign-up; the owner creates accounts.

## Environments

| | Where | Notes |
|---|---|---|
| Production app | GitHub Pages — `https://eithan1710.github.io/Calorie-Tracker/` | static build of `main` |
| Backend | Supabase project `kjfihzskaqcboeejnkak` | Postgres + Auth + Storage + Edge Functions |
| CI / test | GitHub Actions (`ci.yml`) | its own throw-away Postgres and a mocked Supabase — never touches production |

The project is shared with other apps (`nx_*`, Yotzim tables). מאזן only uses `mz_*` objects,
the `mz-food-photos` bucket and the functions below.

The frontend holds only the **publishable** key (public by design; every table is protected by RLS).
Service-role and AI keys live in Supabase secrets / Vault and GitHub secrets, never in the repo.

## Deploy the app

1. Merge to `main` (CI must be green: typecheck + build, unit, end-to-end on mobile and desktop, SQL migration tests).
2. `pages.yml` builds and deploys automatically.
3. **Known race:** the repository's Pages source is still "deploy from a branch", so GitHub also runs its legacy
   `pages-build-deployment`, which publishes the raw source (a blank page) and can finish after ours. Until the
   source is switched to **Settings → Pages → Source: GitHub Actions**, re-run the deploy once after every push:
   `gh api -X POST repos/Eithan1710/Calorie-Tracker/actions/workflows/pages.yml/dispatches -f ref=main`.
4. Installed apps pick up the new version the next time they go to the background.

## Database changes

- Migrations live in `supabase/migrations/`, are **additive and idempotent** (re-runnable), and each has a
  test in `supabase/tests/` that CI runs twice against a plain Postgres.
- Apply one to production: add it to the `options` list in `apply-migration.yml`, then
  `gh api -X POST repos/Eithan1710/Calorie-Tracker/actions/workflows/apply-migration.yml/dispatches -f ref=main -f inputs[migration]=<file>.sql`.
- Never drop / truncate / bulk-update user tables. Data fixes are single-row, scoped by id, and recorded in the commit message.

## Deploy the Edge Functions

`deploy-supabase.yml` (manual) deploys `analyze-food`, `health-ingest`, `send-reminders`, `mz-config`.
Supabase CLI 3 asks for confirmation, so the workflow passes `--yes`; a failed run publishes its log to the
`ci/deploy-log` branch.

## Accounts

Create a member (SQL editor, service role): `select public.mz_create_member('<username>', '<password>');`
It creates the Auth user and the `mz_members` row; non-members can't read or write any `mz_*` data.

## Monitoring

- **App errors:** `select * from mz_client_errors order by created_at desc limit 50;` — message, trimmed stack,
  screen, app version (git sha), browser. No food, health or personal data. Kept 90 days.
- **AI:** `mz_ai_analysis_logs` (provider, model, success, latency; text truncated to 200 chars, never images).
  Each member is limited to 100 analyses per rolling 24 h (`_shared/quota.ts`).
- **Functions:** Supabase dashboard → Edge Functions → logs (one JSON line per analysis with stage timings).
- **Live site check:** pushing to `debug/white-page` runs a headless browser against production and writes
  `log.txt` to `ci/debug` (bundle loads, no page errors, chosen strings present).

## Backup and recovery

- Supabase's own backups depend on the plan (the Free plan has no downloadable backups) — check
  Dashboard → Database → Backups.
- Before any risky change, take a dump with the Supabase CLI (needs the database password):
  `supabase db dump --db-url "$DB_URL" -f schema.sql` and
  `supabase db dump --db-url "$DB_URL" --data-only --schema public -f data.sql`
  (only `mz_*` tables matter for מאזן). Store it outside the repo.
- Every device also keeps a full local copy of its account (IndexedDB) and re-uploads anything the server is
  missing, so a lost row is usually recovered by opening the app on the phone.
- Soft deletes: food, workouts and weights carry `deleted_at`; an accidental delete can be undone by clearing it.

## Before going public (not done — decisions for the owner)

- Public sign-up does not exist by choice. Opening it needs: a sign-up flow, paid AI quotas, a privacy policy and
  terms written for the operator's jurisdiction (health data is sensitive personal data), and support contact details.
- Switch the Pages source to GitHub Actions (see above); enable leaked-password protection in Supabase Auth.
