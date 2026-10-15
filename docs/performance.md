# Speed: open → photo → result

Measured October 2026. "Lab" numbers come from `tests/perf/diag.spec.ts` (Actions → *Perf diagnostics*):
production build, mocked Supabase, Pixel 7 emulation with **4× CPU throttling, 150 ms RTT, ~9 Mbps down /
3 Mbps up**, and iPhone 14 emulation on WebKit (no throttling available). CI machines vary run to run, so
ranges are given where two runs differed. AI numbers come from production (`mz_ai_analysis_logs`) and a
small benchmark against the real Gemini API (`scripts/perf/bench-ai.mjs`).

## Where the time went (before)

| Step | Before | Notes |
|---|---|---|
| Open installed app → camera button usable | ~0.15 s (lab, warm service worker) | not the bottleneck on repeat launches |
| Main JS bundle | 562 KB (166 KB gzip) | offline food parser + 100 KB food table, zod, every sheet, login, onboarding |
| Pick 12 MP photo → request at server | 1.8–2.1 s (lab, throttled) | resize to 1280 px + **650 KB upload** over mobile uplink |
| Server before AI | auth → member check → keys → body, one after another | |
| AI model call (Gemini 3.5 Flash) | 3.0–5.4 s (benchmark) | thinking tokens ≈ 0; 8.5 k prompt tokens, 6.7 k served from cache |
| Server total, successful photos | median 5.6 s, p90 8.3 s (n = 15, production) | |
| **Failed requests** | **8 of 18 recent requests hung 25 s** | Gemini stalled; the Groq fallback model no longer exists (404) |
| Result → on screen | ~0.26 s (lab) | |

## Changes

* **Startup:** everything not needed to open the app and log a meal loads on demand (history, weight,
  login, onboarding, workout/steps/settings sheets, result + search screens, offline parser, zod) and is
  preloaded right after the first paint. An inline skeleton replaces the blank screen before the script runs.
* **Photo:** decoded straight to 1024 px and encoded asynchronously; upload ~35–40 % smaller.
  (Decode/encode variants were all 100–200 ms on a photo-like 12 MP image — the upload is what mattered.)
* **Server:** auth, member check, key loading and body parsing run concurrently; membership is cached for
  10 minutes per function instance; stage timings are returned in a `Server-Timing` header and logged.
* **Stalls:** if the first Gemini model hasn't answered in 8 s (`GEMINI_HEDGE_MS`), the next Gemini model
  starts in parallel and the first answer wins; the overall budget is shared (25 s server, 30 s client).
* **Client:** one quick retry when the connection drops, one request at a time per meal (no double
  submissions), clear message on timeout; every photo flow is timed on the phone (Settings → מהירות).

## After (same lab scenarios)

| Step | Before | After |
|---|---|---|
| Main JS bundle | 562 KB / 166 KB gzip | **305 KB / 95 KB gzip** |
| Camera button usable (repeat launch, median of 5) | 155 ms | 85–105 ms |
| First paint | 220 ms | 124–188 ms |
| Photo upload size (same test photo) | 649 KB | **407 KB** |
| Pick photo → request at server (throttled) | 1.8–2.1 s | 1.0–2.2 s (noisy; upload is the stable win) |

The AI stall fix can only be measured in production: compare `latency_ms` and the share of 25 s failures
in `mz_ai_analysis_logs` before/after the deploy, and the "מהירות" panel in Settings on the phone.
