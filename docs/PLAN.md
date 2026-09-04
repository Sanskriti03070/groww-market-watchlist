# Implementation Plan

## 1. Foundation
**Status: Complete**
Next.js 16 project scaffolded, connected to a Vercel project, Neon Postgres
provisioned, Drizzle configured, `docs/` directory established.

## 2. Data layer
**Status: Slice A complete for owner/symbol/watchlist tables**
Drizzle schema and migrations for `owners`, `symbols`, `watchlist_items`
(see docs/ENGINEERING_DECISIONS.md for why there is no `watchlists` table).
Seed script for the fixed ~53-symbol universe. Tables for later slices
(prices_current, price_daily_history, derived_stats, conditions,
last_seen_snapshots, poll lease) are still not started — see Slice A's
"Future state keys" note in the review for the ownership decisions already
locked in for two of them.

## 3. Market-data source
**Status: Not started**
Yahoo Chart source implementation behind the source abstraction. Lazy-refresh
logic with the atomic poll lease. Vercel Cron route and configuration for the
backstop refresh.

## 4. Watchlist core
**Status: API complete (Slice A); UI not started**
Capability-token creation and resolution. CRUD for the single watchlist's
items (add/remove/reorder) as route handlers, with the approved
concurrency/data-integrity invariants enforced and tested. There is no
search endpoint by design (GET /api/symbols returns the fixed universe).
Drag-based reordering UI is not built - Slice A ships the API it would call
(PUT /api/watchlist/order).

## 5. Last-seen / since-last-check
**Status: Not started**
Snapshot read-and-overwrite on page load. Ambient delta computation and display
on each row.

## 6. Conditions and trigger lifecycle
**Status: Not started**
Condition CRUD for both structural types (price-level-cross with anchor
resolution; percent-move vs. volatility baseline). State machine
(ARMED/TRIGGERED/PAUSED). Evaluation gated on LIVE data only. Immediate
re-evaluation on edit and on resume.

## 7. Attention/review experience
**Status: Not started**
Row-level highlighting for TRIGGERED conditions. State-dependent action panel
(View/Edit/Pause/Resume/Acknowledge/Keep watching/Remove). Notification bell
aggregating TRIGGERED conditions across all of an account's watchlists.

## 8. Reliability and failure handling
**Status: Not started**
LIVE/STALE/UNAVAILABLE rendering, including the two distinct UNAVAILABLE cases
(never fetched vs. no longer trusted). Stale timestamp display. Network-failure
and search-failure states, scoped separately. Empty-watchlist and
zero-search-result states. Market-session status kept separate from reliability
state.

## 9. Testing and adversarial testing
**Status: Not started**
Forced-overlap test on the poll lease. Forced-stale-data test on condition
evaluation (must not trigger while frozen, must resume correctly once LIVE).
Edit-while-triggered and resume-while-still-met tests (must re-trigger
immediately in both cases).

## 10. UX/polish
**Status: Not started**
Filter, sort, search, and refresh controls on the watchlist view. A deliberate
typography/spacing pass. Final copy review to confirm no wording implies a
buy/sell recommendation anywhere in the app.

## 11. Deployment
**Status: Not started**
Production deploy on Vercel. Every flow verified cold, on the live deployed link,
in an incognito window.

## 12. Final evaluation/submission
**Status: Not started**
README with trade-off log and explicit list of cuts. Demo video. Submission
document. Buffer time reserved before the deadline for fixes only.