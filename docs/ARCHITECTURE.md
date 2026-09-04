# Architecture

## Implementation status

**Slice A is implemented**: owner/capability identity, the fixed symbol
universe, and the single per-owner watchlist (add/remove/reorder) — see
`db/schema.ts`, `db/migrations/`, `lib/watchlist.ts`, `lib/auth.ts`, and the
six route handlers under `app/api/`. The "Capability-token model" section
below reflects what's built. There is no `watchlists` table (see
docs/ENGINEERING_DECISIONS.md) — everything else in this document (the
market-data poller, poll lease, quote cache, daily history, conditions and
trigger state machine, stale/unavailable handling, since-last-check) is
still design only, not yet built.

## Product/system goal

A watchlist that does two things a plain price table doesn't: shows a user what
changed on a stock since the last time they personally looked at it, and lets the
user define, per stock, what "meaningful" means to them — a price level, a move
relative to that stock's own normal volatility, or a moving-average cross/reclaim
— and surfaces only what the user asked to be told about. The system does not
generate its own buy/sell signals or judge significance on the user's behalf.

## High-level request/data flow

A request for watchlist data reads the current quote and derived stats for each
symbol on that watchlist from Postgres. If a symbol's cached quote is older than
the refresh interval, the request also triggers a lazy refresh for that symbol
(see below), then returns the best available data along with each symbol's
reliability state. Condition evaluation runs as part of this same read path,
against whatever quote was just read. The client re-requests on its own interval;
each request repeats this cycle. A separate Cron-triggered path performs the same
refresh independently of any user request, so watched symbols keep updating even
with no one currently viewing the app.

## Next.js 16 App Router + route handlers

All server logic — search, watchlist CRUD, condition CRUD, quote reads, refresh
triggering — is implemented as App Router route handlers in one Next.js project.
There is no separate backend service; the whole app is one deployable unit.

## Neon Postgres + Drizzle

Neon (serverless Postgres) is the only persistence layer. Drizzle is used for
schema definition, migrations, and queries. The data is relational by nature —
a token owns multiple watchlists, each holding stocks, each stock holding at most
one condition, plus a separate price-history series — so the schema is expressed
directly as tables and foreign keys rather than through a document or key-value
shape.

## Shared server-side market-data poller

Quotes are fetched once, server-side, per symbol — not once per user or per open
browser tab. Every watchlist that includes a given symbol reads from the same
cached row. This keeps total call volume against the external price source tied
to the number of distinct symbols being watched, not the number of users.

## Lazy refresh with an atomic poll lease

A refresh for a given symbol is only triggered when a request actually needs that
symbol's data and the cached quote is older than the refresh interval. Before
fetching, the server attempts to acquire a lease for that symbol (an atomic
check-and-set against a lease record). If the lease is already held — another
request is already refreshing that symbol — the current request simply reads the
existing cached value instead of issuing a second concurrent fetch. This is the
mechanism that prevents duplicate outbound calls when multiple users or requests
hit a stale symbol at the same moment.

## Vercel Cron as backstop

A scheduled Cron job invokes the same lazy-refresh path on a fixed interval,
independent of user traffic. This exists because pure lazy refresh only fetches
data when someone asks for it — if no one has a given watchlist open, its
conditions would stop being evaluated against fresh data. Cron guarantees a floor
level of freshness regardless of live viewers.

## Yahoo Chart source behind a source abstraction

The actual HTTP calls to the (unofficial) Yahoo Finance chart endpoint are
isolated behind a single narrow interface with one implementation. Nothing else
in the system — the lease logic, the poller, condition evaluation — talks to
Yahoo directly. This is a deliberately small boundary, justified by the fact that
this dependency is already known to be unofficial and rate-limit-fragile; if it
needs to be replaced, only the implementation behind the interface changes.

## Quote cache and daily history

Two different storage shapes serve two different needs. A current-quote table
holds the latest fetched price per symbol, overwritten on every refresh. A
separate daily-history table holds one row per symbol per trading day (open,
high, low, close, volume), which is the source for anything computed over time —
50-day moving average, 52-week high/low, a rolling volatility baseline. These
derived values are recomputed once per trading day from the history table, not
on every refresh cycle, since they don't meaningfully change intraday.

## Last-known-state / since-last-check model

Separately from any of the above, the system stores one snapshot per
(account, symbol): the price at that account's last visit. This snapshot is read
and then immediately overwritten on page load — not on page exit, since an exit
event isn't reliable. The difference between the stored snapshot and the current
price is shown as an ambient, informational delta. It carries no threshold, no
highlight, and triggers no action; it's a separate, passive mechanism from
condition evaluation.

## Condition evaluation and trigger state machine

A condition is either ARMED (watching, not yet met), TRIGGERED (met, not yet
acknowledged), or PAUSED (evaluation stopped by explicit user action). Editing a
condition or resuming it from PAUSED forces an immediate re-evaluation against
the current cached price — either can trigger right away if already met, rather
than waiting silently for the next cycle. Evaluation only ever runs against data
classified LIVE (see below); it does not run, and does not change state, while a
symbol's data is STALE or UNAVAILABLE.

## Stale/unavailable data handling

Each symbol's quote carries one of three states: LIVE (fetched within the current
refresh interval), STALE (a fetch has been missed, but a last-known price exists
and is shown with its timestamp), or UNAVAILABLE (no trustworthy price exists —
either nothing has ever been successfully fetched, or failures have gone on long
enough that the last-known value is no longer shown as current). This is
independent of whether the market is open; a closed market is not a reliability
failure, it's a separate fact about trading hours.

## Concurrency protections

The poll lease prevents more than one in-flight refresh per symbol at a time.
Quote and derived-stat writes are single-row atomic updates, so a concurrent
reader never observes a partially written value. Derived stats are recomputed
once per day by a single job, rather than on read, which avoids any race between
concurrent recomputation attempts.

## Capability-token model

There is no login. A random, unguessable token embedded in the URL is the sole
identity mechanism. All state — watchlists, stocks, conditions, snapshots — is
looked up by that token. Opening the same link on any device returns the same
state; the token itself is the only thing that determines access.

## Deployment

One Vercel project, one deployment, serving both frontend and API routes. Neon
Postgres is the only external managed dependency besides the market-data source
itself.

## Scaling approach

Cost and load scale with the number of distinct symbols currently being watched
by anyone, not with the number of users or watchlists — because quotes are cached
per symbol and shared across every watchlist that includes it. Lazy refresh means
a symbol nobody is currently watching isn't polled at all outside the Cron
backstop interval, which can be tuned independently of traffic.

## Important invariants

- The UI never shows a fabricated or zeroed price for a symbol with no data.
- A condition never changes state based on non-LIVE data.
- At most one refresh fetch is in flight per symbol at any time.
- Derived stats (moving average, 52-week high/low) change only on the daily
  recompute, never mid-cycle.
- The capability token is the only authorization check in the system.