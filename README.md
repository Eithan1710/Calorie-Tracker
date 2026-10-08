# מאזן — calorie & protein tracker for body recomposition

A Hebrew, RTL, mobile-first PWA built around one question: **"where am I today?"**
Open → see the balance → `+ הוסף אוכל` → type or photograph → `אישור` → close. 10–20 seconds.

| Today (goal reached) | Review an AI/photo estimate | History |
|---|---|---|
| ![](docs/screenshots/mobile-today-success.png) | ![](docs/screenshots/mobile-photo-review.png) | ![](docs/screenshots/mobile-history.png) |

![desktop](docs/screenshots/desktop-today-success.png)

---

## What it does

- **Today dashboard** — calorie balance (eaten − burned) as the hero number, a number-line gauge with the
  **100–300 kcal deficit** target band, a plain-language status (`היעד הושג` / `כמעט שם` / `עודף קלורי` /
  `הגירעון גדול מהיעד`), **protein vs. 120 g** with emphasis, fat, carbs, steps, workouts, and the food log.
  Mid-day it doesn't scare you with a "huge deficit" — it says how much is left to eat.
- **Accounts** — closed app: username + password login only (no sign-up), stays signed in; nothing is reachable
  without logging in.
  Every account has its own profile, targets, food log, workouts, steps and photos; isolation is enforced by
  Postgres RLS and Storage policies, not by the UI.
- **Food entry** — free Hebrew text (`אכלתי 3 ביצים, 2 פרוסות לחם, קוטג' וסלט`) or a photo — taken with the camera
  *or picked from the photo library* (`הוסף תמונה`). The photo is compressed on the device and stays attached to
  the meal (thumbnail in the log, viewable/replaceable later). Every estimate is shown as `≈`, with a range for photos, a confidence label,
  per-item sources, and the assumptions. Edit grams with ± or by typing, remove items, or type a correction
  (`זה היה 250 גרם אורז`) — simple corrections are applied instantly on-device, anything else goes to the AI.
- **One-tap re-log** of recent meals, **undo** on every add/delete.
- **Workouts** — strength (duration + intensity + rest style, optional muscle groups and total volume lifted), run
  (distance + time → pace + burn), walk, cycling, swimming, cardio/other. Every estimate is shown with a range.
- **Steps** — manual, or from Apple Health through an Apple Shortcuts bridge (see below).
- **History** — week / month: days in target, average balance, protein, steps, three small charts, day list.
- **Daily 21:30 reminder** — `לא שכחת לעדכן את היום? 🥗`, once a day, skipped if the evening is logged.
- **Offline-first** — data lives in IndexedDB; common foods are computed offline by a deterministic Hebrew
  parser; anything else is queued and analysed when the connection returns. Optional Supabase sync.
- Minimal settings (per account): sex, age, height, weight, protein target (default **120 g**), daily target
  (recomp 100–300 deficit · weight loss 300–500 · maintenance · gain), reminder, logout.

## Quick start

```bash
npm install
cp .env.example .env        # optional: add GEMINI_API_KEY (free) for AI text + photo analysis
npm run dev                 # http://localhost:5173 — includes the local /api/analyze-food
```

Without any key the app still works: text is analysed by the built-in Hebrew parser + nutrition table
(photos need an AI key). With `GEMINI_API_KEY` set, the dev server runs the full AI pipeline server-side.

```bash
npm test            # unit tests (vitest)
npm run test:e2e    # Playwright end-to-end, mobile + desktop
npm run build       # typecheck + production PWA build → dist/
```

Requires Node ≥ 22.18 (the dev API imports the shared TypeScript pipeline directly).

## Deployment

**Live:** <https://eithan1710.github.io/Calorie-Tracker/> — backend in the Supabase project `kjfihzskaqcboeejnkak`
(shared with another app; every מאזן table, function and Vault secret is prefixed `mz_`).

**Accounts (current): closed membership.** Only accounts listed in `public.mz_members` can use the app — every
RLS policy, the photo Storage policies and the `analyze-food` function check membership, so an Auth account created
any other way (the Auth project is shared with another app, so sign-up can't be switched off project-wide) gets
nothing. There is no sign-up screen. Create or reset members in the SQL editor:

```sql
select public.mz_create_member('username', 'password');        -- new member
select public.mz_set_member_password('username', 'new password');
```

Usernames map deterministically to a synthetic, never-mailed login address (`u<sha-256>@users.maazan.app`, see
[`_shared/account.ts`](supabase/functions/_shared/account.ts)). Short passwords are allowed: Supabase Auth stores a
bcrypt hash of `"maazan:" + password`, so the shared project's minimum length never applies to members.

| Piece | How it's deployed |
|---|---|
| Database schema, policies, Vault helpers, reminder cron | `supabase/migrations/*` (applied) |
| Web Push keys, cron secret | generated inside Supabase, kept in Vault |
| AI keys | GitHub secret → [`sync-ai-keys.yml`](.github/workflows/sync-ai-keys.yml) → `mz-config` function → Vault. No Supabase token needed: the function verifies GitHub's signed OIDC token and only accepts this repo's `main` branch |
| Edge functions | [`deploy-supabase.yml`](.github/workflows/deploy-supabase.yml) (manual, needs `SUPABASE_ACCESS_TOKEN`) redeploys after code changes |
| PWA | [`pages.yml`](.github/workflows/pages.yml) on push to `main`: tests → build → GitHub Pages |
| Checks | [`ci.yml`](.github/workflows/ci.yml) on every other branch / PR: unit tests, typecheck + build, Playwright (mobile, desktop, accounts) |

**Repository secrets** (Settings → Secrets and variables → Actions): `GEMINI_API_KEY` (required for AI/photos);
optional `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `USDA_FDC_API_KEY`. After adding or changing one, run
**Actions → Sync AI keys to Supabase → Run workflow** (it also runs on every push and daily).

## Environment variables

All documented in [`.env.example`](.env.example). Summary:

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODELS` | server | Primary AI (free tier). Models tried in order. |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_VISION` | server | Fallback AI #1 |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | server | Fallback AI #2 |
| `AI_PROVIDER_ORDER`, `AI_TIMEOUT_MS` | server | Chain order / timeout |
| `USDA_FDC_API_KEY`, `USDA_FDC_DISABLED` | server | USDA FoodData Central lookups for foods outside the table |
| `REQUIRE_AUTH` | server | the AI endpoint requires a signed-in (non-anonymous) session; `false` disables that for local experiments only |
| `VAPID_*`, `CRON_SECRET` | server (optional) | Override the Web Push keys / cron secret that otherwise live in Vault |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | client (public) | Optional sync + hosted functions |
| `VITE_BASE` | build | Sub-path for hosting, e.g. `/Calorie-Tracker/` on GitHub Pages |
| `VITE_VAPID_PUBLIC_KEY` | client (public, optional) | Otherwise fetched from `send-reminders` |
| `VITE_API_BASE` | client (public) | Override the analyze endpoint |

AI keys are **never** bundled into the frontend — only `VITE_*` values are, and none of them are secret.

---

## Calorie expenditure algorithm (deterministic — no AI)

One module computes every "burned" number: [`src/domain/energy.ts`](src/domain/energy.ts) (unit-tested in
[`energy.test.ts`](src/domain/energy.test.ts)). UI components only call into it.

```
TOTAL = (BMR + BASELINE + STEPS_NET + EXERCISE_NET) × 1.10
```

| Term | Model |
|---|---|
| **BMR** | Mifflin-St Jeor: `10·kg + 6.25·cm − 5·age + 5` (♂) / `− 161` (♀). Energy for 24 h at rest. |
| **BASELINE** | 5 % of BMR — non-walking daily life a step counter can't see (standing, posture, chores). |
| **STEPS_NET** | `steps × stride × kg × 0.5 kcal/kg/km`, stride = height × 0.415 (♂) / 0.413 (♀). 0.5 is the *net* walking cost. |
| **EXERCISE_NET** | per workout: `(MET × 3.5 × kg / 200 − BMR/1440) × minutes` — the standard MET equation minus *this person's own* resting rate (which BMR already counts). Running with a distance: `1.0 kcal × kg × km − resting`. |
| **× 1.10** | Thermic effect of food ≈ 10 %, modelled on expenditure so "burned" doesn't rise because you ate more. |

**MET values** — 2024 Adult Compendium of Physical Activities. Strength training is costed as a *session*
(the Compendium resistance codes are session averages including rest between sets), never as continuous work:

| Strength | light | moderate | vigorous |
|---|---|---|---|
| standard rests (1–3 min) | 3.5 (02054) | 5.0 (02052) | 6.0 (02050) |
| short rests / supersets / circuit | 3.5 (02034) | 5.8 (02055) | 7.5 (02040) |

Walking, cycling, swimming and cardio use their Compendium tables by intensity; running without a distance uses
pace-based running METs.

**Optional strength inputs (bounded):**
- *Muscle groups worked* scale the MET by active muscle mass: legs or full body ×1.10, back/chest ×1.00,
  only shoulders/arms/core ×0.90.
- *Total volume lifted* (Σ kg × reps, e.g. 8,000 kg) adds its mechanical work: `volume × 9.81 × 0.5 m ÷ 0.20
  efficiency ÷ 4184` ≈ 0.0059 kcal per kg → 8,000 kg ≈ +47 kcal. Load alone is a poor predictor of energy cost, so
  it's an add-on to the time-based session estimate, never its basis (doubling the volume of a 60-min session adds
  ~12 %).

**No false precision:** individual MET predictions are typically off by 20–30 %, so every workout shows a rounded
(10 kcal) estimate plus a range (±30 % strength/cardio, ±25 % cycling/swimming, ±20 % walking, ±10 % running with a
distance).

**Double-counting guards:** resting energy is counted once (BMR); steps recorded during a logged run or walk are
subtracted before step energy is computed.

Sanity checks (tested): 3k steps ≈ BMR × 1.2, 12k steps ≈ BMR × 1.375; 5 km run for 65 kg ≈ 300 kcal;
75 min moderate lifting for 80 kg ≈ 430 kcal above rest (range ≈ 300–560).

**Daily goal** ([`src/domain/goal.ts`](src/domain/goal.ts)): deficit = burned − eaten, checked against the
account's target band (default `100–300`; presets for weight loss 300–500, maintenance ±100, gain 200–400 surplus).
Default band: `100–300` → success · `0–99` → almost (`חסרות עוד X קלוריות ליעד`) · `< 0` → surplus (gentle wording) ·
`> 300` → "deficit larger than target" — **only once the day is over (after 20:00 or a past day)**; before that
it shows how many calories are still available. The app never recommends aggressive restriction.

## AI nutrition pipeline

```
text / photo
  → AI with the nutrition skill: identify items, edible grams, raw/cooked state, map to table keys
  → zod validation of the model JSON (invalid → next provider)
  → nutrients: curated table (USDA SR Legacy + Israeli labels) → USDA FDC search → AI per-100 g estimate (sanity-checked)
  → calories/macros computed deterministically; totals summed in code; kcal range from portion range
  → result with confidence, assumptions, source per item → client validates again → user confirms/edits
```

- **The model never supplies the final calories.** It decides *what* and *how much*; numbers come from
  [`foodDb.ts`](supabase/functions/_shared/foodDb.ts) (135 foods incl. Israeli staples, per-100 g, portion units,
  composite dishes that list their ingredients to prevent double counting) or USDA FoodData Central.
  Only foods found in neither use the model's own per-100 g estimate, which must pass an Atwater
  consistency check, is labelled `הערכה`, and caps confidence.
- **Skill / system instructions:** [`skills/nutrition-analysis/SKILL.md`](skills/nutrition-analysis/SKILL.md) —
  identification, edible-portion grams, raw vs cooked rules, Israeli & restaurant foods, hidden oil/sauces,
  photo portioning cues, confidence scale, clarification questions, correction semantics, strict JSON schema.
  It's embedded into the edge-function bundle by `scripts/sync-skill.mjs` (a test fails if it's stale).
- **Provider abstraction:** `NutritionAIProvider` in [`providers.ts`](supabase/functions/_shared/providers.ts) with
  `GeminiProvider` and `OpenAICompatProvider` (Groq, OpenRouter, anything OpenAI-compatible). Retries a model
  without JSON-schema/thinking config on HTTP 400; moves to the next model on 404/429; next provider on any failure.
- **Model choice (researched Oct 2026):** Google's free Gemini API tier now offers only Flash / Flash-Lite
  models (Pro left the free tier in April 2026), with per-project RPM/RPD limits that Google changes without
  notice. Flash has vision, native JSON-schema output and good reasoning, so it is primary, configured as a
  chain `gemini-3.5-flash → gemini-3-flash-preview → gemini-2.5-flash` (env-overridable). Groq's free tier
  retired Llama 4 Scout (July 2026) and recommends `qwen/qwen3.6-27b`, which is multimodal with JSON mode →
  fallback #1. OpenRouter's `openrouter/free` router accepts images and routes to whichever free model is live →
  fallback #2. For text, the offline parser is the final fallback.
- **Errors are human:** `לא הצלחתי לנתח את האוכל. נסה לתאר קצת יותר את הכמות.`,
  `התמונה קצת לא ברורה לי…` — never a stack trace or HTTP code.
- Logged to `ai_analysis_logs` (provider, model, latency, success; text truncated to 200 chars; images never stored).

## Apple Health — what's possible and what's built

**A web app / PWA cannot read HealthKit.** Apple exposes HealthKit only to native apps; Safari and home-screen
PWAs have no API for it (Android's Health Connect is likewise native-only). So the app does not pretend.

Implemented bridges, all using Apple's free **Shortcuts** app:

1. **Background sync (recommended, needs Supabase).** Settings → Steps → "צור קוד אישי" creates a personal
   token (only its SHA-256 is stored). A Shortcuts *Personal Automation* (e.g. 21:15 daily, "run immediately"):
   *Find Health Samples (Steps, today)* → *Calculate Statistics (Sum)* → *Get Contents of URL* `POST`
   `…/functions/v1/health-ingest` with `Authorization: Bearer <token>` and JSON `{"steps": <sum>}`. The app picks it
   up on next open. Works with Android automation apps too (same endpoint).
2. **Open-with-URL (no backend).** A shortcut opens `https://your-app/?steps=7842&date=2026-10-06`; the app imports
   and cleans the URL. Caveat (shown in the UI): on iOS the link opens in Safari, whose storage is separate from
   the installed PWA — so this suits Safari-tab, Android and desktop use.
3. **Manual** — tap the steps tile, type the number.

Upgrade path if fully automatic sync is ever needed: wrap the same React app in Capacitor and add a HealthKit
plugin (a small native companion) — the energy model and data layer don't change.

## Reminders — what works where

- A web page can't schedule an OS notification for later (the Notification Triggers API was abandoned).
- **Reliable:** Web Push. `pg_cron` calls `send-reminders` every 15 min (authenticated with a Vault-held
  secret; the VAPID key pair is generated server-side on first use and also kept in Vault); it sends one push per local day at/after
  21:30, and skips users who logged something after 17:00. iPhone/iPad support Web Push **only for PWAs added
  to the Home Screen** (iOS 16.4+); the settings screen explains this.
- **Without a backend:** a local timer fires while the app is open/backgrounded, and an in-app banner appears when
  the app is opened after 21:30 with nothing logged. Never more than one per day.

## Data & security

- **Per-account, local-first:** each account has its own IndexedDB database (`maazan:<user_id>`) and settings key,
  so people sharing a device never see each other's data even offline. Sync is last-write-wins on `updated_at`,
  soft deletes so removals propagate. On logout the local copy is removed once everything is synced.
- **Server-side isolation** ([`20261008000000_multi_user.sql`](supabase/migrations/20261008000000_multi_user.sql)):
  every `mz_` table has `user_id → auth.users` (default `auth.uid()`) and owner-only RLS policies for select /
  insert / update / delete; anonymous sessions (another app in this project uses them) are excluded; the `anon` role
  (public key without a session) has no table privileges at all. AI logs are read-only for their owner; the
  Shortcuts token hash is write-only through `mz_set_ingest_token`, which now writes for the caller only.
  [`supabase/tests/rls_isolation.sql`](supabase/tests/rls_isolation.sql) proves it (two users, rolled back).
- **Photos:** private bucket `mz-food-photos`, objects at `<user_id>/<entry_id>/<photo_id>.jpg`. Storage policies
  require the first path segment to be the caller's uid for every operation, and `mz_food_entries.photo_path` has a
  check that it lives in the owner's folder. Photos are downscaled to ≤1280 px JPEG (~150–300 KB) on the device,
  which also strips EXIF/location. Shown through 1-hour signed URLs; queued in IndexedDB while offline.
- **First login on an old device:** data from before accounts existed is never moved silently — the app asks once
  whether to attach it to the signed-in account.
- The analyze function validates the request with zod and every model reply with zod; the client validates the
  server reply again before saving. AI keys live only in Vault / function env, never in the app bundle.

## Project structure

```
src/
  domain/        energy.ts (burn model) · goal.ts (status logic) · day.ts (daily summary)
  data/          store.ts (local-first store) · idb.ts · types.ts
  services/      auth.ts · session.ts · sync.ts · photos.ts · image.ts · ai.ts · notifications.ts · health.ts · supabase.ts · config.ts
  ui/            screens/ (Login, Today, History, Onboarding) · sheets/ (food, review, exercise, steps, settings, legacy import)
  sw.ts          service worker: precache, Web Push, notification click
supabase/
  functions/_shared/   pipeline · providers · schema (zod) · foodDb · localParser · nutrition · usda · skill
  functions/{analyze-food,health-ingest,send-reminders,mz-config}/
  migrations/          schema + RLS, reminder cron, multi-user accounts + photo storage
  tests/rls_isolation.sql
skills/nutrition-analysis/SKILL.md
dev/apiPlugin.ts       local /api/analyze-food for dev & preview
tests/                 unit/ · e2e/ (Playwright; accounts.spec runs against a mocked Supabase)
```

## Testing

See [`docs/TESTING.md`](docs/TESTING.md) for the full matrix and latest results.
