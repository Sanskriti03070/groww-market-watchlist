# Architecture
## Overview
The application is a Next.js application with PostgreSQL as the persistent store.
The frontend reads watchlist and alert state through the application API. Market data is refreshed separately and written to the database before it is used by the watchlist or alert system.
## Main flow
User/browser
→ Next.js application
→ API routes
→ PostgreSQL
The market refresh flow is separate:
cron-job.org
→ `/api/market/refresh`
→ refresh service
→ NSE market data provider
→ PostgreSQL
The refresh endpoint is authenticated with a server-side secret. A database lease prevents overlapping refresh cycles.
## Watchlist
A watchlist belongs to an anonymous owner identified by a cookie.
Watchlist items and market quotes are stored in PostgreSQL. Removing a stock also disables its alerts while retaining their history.
The watchlist API returns the latest stored market information together with reliability and freshness information.
## Since Last Check
The application stores the last trusted observation for each owner and stock.
When the user successfully views a trustworthy market value, that observation becomes the baseline for the next check.
A stock's movement is considered meaningful when it crosses a volatility-adaptive threshold:
**25% of the day's trading range, bounded between 0.5% and 3%.**
If range data is unavailable, the threshold falls back to 1%.
The threshold decision is made on the server and the watchlist explains the result through a small popover.
## Alerts
Alerts are stored separately from watchlist observations.
There are two supported conditions:
- Price crosses a level
- Day move reaches a percentage
Alert evaluation happens when new market data is written, rather than when a user reads the page.
Each alert keeps its current state and last evaluated quote timestamp. A trigger is recorded only when the condition changes from false to true.
Database row locking, monotonic quote timestamps, and a unique trigger constraint protect evaluation from duplicate work during concurrent refreshes.
## Market data reliability
Market observations have explicit reliability states.
- `LIVE` — current market observation
- `LAST_CLOSE` — latest completed-session observation
- `STALE` — older data that should not drive decisions
- unavailable — no usable quote
LIVE and LAST_CLOSE data can be used for change and alert evaluation. STALE or unavailable data is displayed as such but does not create new decisions.
After market close, the latest close is captured once so the application can continue to show a trustworthy completed-session value without repeatedly changing the observation.
## Persistence and concurrency
PostgreSQL is the source of truth for watchlist state, observations, quotes, alerts, and triggers.
A refresh cycle:
1. Acquires the refresh lease.
2. Loads the active symbol universe.
3. Fetches market data outside the database transaction.
4. Writes successful quotes and failures.
5. Evaluates alerts for quotes that actually advanced.
6. Updates refresh state.
7. Commits the transaction.
Successful quote writes are monotonic by fetch time, so an older result cannot overwrite a newer observation.
## Scale
The current design is intentionally simple.
Market refresh work grows with the number of watched symbols, while alert evaluation grows with the number of active alerts for those symbols.
For larger workloads, refreshes can be split by symbol ranges across scheduled jobs without changing the database model or user-facing APIs.
No queue or event-streaming system is required at the current scale.
