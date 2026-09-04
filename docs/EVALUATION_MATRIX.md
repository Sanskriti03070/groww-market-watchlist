# Evaluation Matrix

Maps the challenge brief's stated dimensions to what this project must demonstrate,
and where we currently stand against each. Status reflects the actual repo state,
not the plan — see [PLAN.md](PLAN.md) for step-by-step progress and
[ARCHITECTURE.md](ARCHITECTURE.md) for the mechanisms referenced below.

| Dimension | Evaluator should observe | Engineering evidence needed | Current status |
|---|---|---|---|
| **Build both frontend and backend** | A working watchlist UI backed by real server-side routes and a persistent store — not a static or client-only page. | App Router route handlers for search/CRUD/quotes; Neon Postgres schema via Drizzle; one deployable unit. | Designed in ARCHITECTURE.md. Repo is still the default `create-next-app` scaffold — no routes, schema, or DB connection exist yet. |
| **Define what counts as a meaningful change** | Per-stock, user-set conditions (price level, % move vs. that stock's own volatility, MA cross), not one global threshold applied to everyone. | Condition data model; ARMED/TRIGGERED/PAUSED state machine; explicit non-goal that the system never generates its own signals. | Designed (ARCHITECTURE.md, "Condition evaluation and trigger state machine"). Not built — PLAN.md step 6 is Not started. |
| **Surface useful/latest market information** | A current quote per symbol with clearly labeled freshness, plus derived stats (moving average, 52-week high/low). | Shared server-side poller; lazy refresh with Cron backstop; LIVE/STALE/UNAVAILABLE classification. | Designed. Not built — PLAN.md steps 3 and 8 are Not started. |
| **Persist state across sessions/devices** | Opening the same link on a different device shows the same watchlists, conditions, and history. | Capability-token identity; all state keyed by token in Postgres, no client-only storage. | Designed (ARCHITECTURE.md, "Capability-token model"). Not built — PLAN.md steps 2 and 4 are Not started. |
| **Handle stale, delayed, or conflicting data** | No fabricated or zeroed price is ever shown; stale data is timestamped and visually distinct; conditions never fire on frozen data. | Three-state reliability model (LIVE/STALE/UNAVAILABLE); atomic poll lease preventing concurrent duplicate fetches; single-row atomic writes. | Designed as an explicit invariant list in ARCHITECTURE.md. Not built or tested — adversarial tests for this are planned in PLAN.md step 9, Not started. |
| **Consider larger watchlists and more users** | Cost and latency scale with distinct symbols watched, not with user count. | Per-symbol shared quote cache read by every watchlist that includes it; lease-gated lazy refresh. | Designed (ARCHITECTURE.md, "Scaling approach"). Unverified — no implementation or load test exists yet. |
| **Make deliberate simplicity/complexity trade-offs** | A documented, defensible account of what was cut and why, not just a list of features shipped. | A trade-off log with explicit cuts, written before submission. | Not started. ARCHITECTURE.md documents chosen mechanisms but no explicit cut list exists yet (planned as PLAN.md step 12 deliverable). |
| **Build a product meaningfully beyond an obvious watchlist** | Since-last-check deltas and user-defined trigger conditions on top of a price table, not a price table alone. | Last-known-state snapshot mechanism; condition engine distinct from a recommendation feature (see differentiator below). | Designed, not built. |

## Our differentiator

Four bets this product makes, each already reasoned through in
[ARCHITECTURE.md](ARCHITECTURE.md) but not yet implemented or demonstrable:

- **Since-last-check comparison** — the app remembers the price at your last visit
  per (account, symbol) and shows the delta since then as ambient information, not
  just the current price in isolation.
- **User-defined watch intent/conditions** — what counts as worth noticing is set
  by the user per stock (a price level, a move relative to that stock's own
  volatility, an MA cross), not a fixed global threshold.
- **Deterministic trigger lifecycle** — conditions move through an explicit
  ARMED → TRIGGERED → PAUSED state machine with defined re-evaluation rules, so
  behavior is predictable and testable rather than ad hoc.
- **Evidence-based attention, not AI-generated recommendations** — the system
  surfaces what the user asked to be told about and shows the data behind it; it
  does not generate buy/sell signals or judge significance on the user's behalf.

None of the above is implemented yet. This document will be updated as each row
moves from "designed" to "built" and, separately, to "verified."
