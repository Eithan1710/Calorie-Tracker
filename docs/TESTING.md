# Testing

```bash
npm test             # 212 unit tests (vitest + jsdom)
npm run test:e2e     # 52 Playwright tests = 26 scenarios × (mobile 390×844 touch, desktop 1280×860)
npm run build        # strict TypeScript + production PWA build
deno check supabase/functions/*/index.ts   # edge functions in their real runtime
```

## Results (latest run, 2026-10-06)

| Suite | Result |
|---|---|
| Unit (vitest) | **212 / 212 passed** |
| End-to-end (Playwright, Chromium) | **52 / 52 passed** (mobile + desktop) |
| `tsc -b` (app, tests, node, strict) | clean |
| `deno check` — analyze-food, health-ingest, send-reminders | clean |
| analyze-food served by Deno, real HTTP request | returns a valid analysis; malformed body → Hebrew `bad_request` |
| SQL migration on Postgres (PGlite) with `auth` stubs | applies; RLS blocks cross-user insert/read; token hash unreadable; `deficit` generated column correct |
| Production build offline (service worker) | reloads with network off; offline text analysis works |
| Client bundle scan | no AI keys or provider endpoints in `dist/` |

AI providers were **not** called live in this environment (no API keys, and the Google/Groq hosts are blocked
by the sandbox's network policy). Their HTTP contracts are covered by unit tests with mocked `fetch`
(request shape, model fallback on 404/429, retry without schema on 400, auth errors not retried, thought
parts stripped, image sent as a data URL). Set `GEMINI_API_KEY` in `.env` and run `npm run dev` to exercise
the real model.

## Coverage of the requested checklist

| # | Requirement | Where it's tested |
|---|---|---|
| 1 | Adding food by text | e2e *add food by text*; unit *local Hebrew parser* (canonical examples, number words, units, glued numbers, ranges, niqqud) |
| 2 | Adding food by photo | e2e *add food by photo …* (file input → review → range + confidence shown); unit *skips text-only providers for photos* |
| 3 | Editing AI results | e2e *edit grams recalculates* (type grams, remove item), *photo … correction* (`זה היה 250 גרם אורז`); unit *instant local corrections*, *editing grams recalculates* |
| 4 | Deleting food | e2e *delete food, then undo* |
| 5 | Daily calorie calculation | unit *daily burn* (breakdown adds up, sedentary ≈ BMR×1.2, active ≈ BMR×1.375); e2e hero numbers |
| 6–8 | Protein / fat / carbs | unit *computes totals deterministically from the table*, *day summary*; e2e protein card |
| 9 | Step integration | e2e *steps arrive from a Shortcut URL*, *manual steps raise calories burned*; `health-ingest` type-checked in Deno |
| 10 | Running calories | unit *running* (distance model, MET by speed, pace, workout steps); e2e *running: pace + estimate* |
| 11 | Strength calories | unit *strength training* ((MET−1)·kg·h, scales with weight); e2e *strength* |
| 12 | Goal status | unit *goal status (spec examples)* + boundaries 99/100/300/301/0/−1 + *day in progress*; e2e success / surplus / mid-day |
| 13 | Reminder behaviour | e2e nudge after 21:30 with nothing logged, gone once logged, none before 21:30 |
| 14 | RTL layout | e2e `dir=rtl`, `lang=he`, title on the right, no horizontal scroll |
| 15 | Mobile layout | e2e single column, touch targets ≥ 40 px |
| 16 | Desktop layout | e2e two-column layout |
| 17 | Offline behaviour | e2e *offline: known foods still log; unknown text queued and analysed when back online*; manual SW offline reload |
| 18 | AI failure handling | e2e *AI outage: friendly Hebrew message*, *AI outage for known foods → deterministic fallback*, *unclear photo*; unit *returns a friendly error when nothing works* |
| 19 | Invalid AI JSON | unit *falls back on invalid / malformed JSON*, *extractJson*, *repairs implausible per-100 g*, *drops items that cannot be computed*; e2e *invalid JSON from the server is never saved* |
| 20 | API failure / fallback | unit *falls back on rate limits*, Gemini model chain 404→429→ok, *provider chain from env* |

## Bug found by the tests and fixed

`2 פרוסות לחם מלא` was parsed as **white** bread: the alias `פרוסות לחם` (which contains a unit word) out-ranked
`לחם מלא`. Unit words were removed from food aliases (the parser handles units separately) and regression
tests were added.
