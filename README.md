# Smart Market Watchlist

A market watchlist with that helps users :
- Track stocks.
- Understand what has meaningfully changed since the last check.
- Create simple alerts for the market conditions that matter.

## Live

https://groww-market-watchlist-g3ip.vercel.app

## Solution to the Groww Engineering Challenge
### What counts as a meaningful change
A change is meaningful when the stock has moved enough since the user's last successful check to matter.
The threshold adapts to the stock's recent trading range instead of using one fixed percentage for every stock. It is based on 25% of the day's range, with a lower bound of 0.5%, an upper bound of 3%, and a 1% fallback when range data is unavailable.
### What information to surface
The watchlist focuses on information that helps the user decide what needs attention:
- Current price and today's movement
- Volume
- Market status and data freshness
- Change since the last check
- Alerts and their current state

The goal is to implement correct technical approach towards the build and their edge cases without turning the watchlist into a dashboard full of indicators.
### How state persists across sessions and devices
Watchlist state, market quotes, observations, and alerts are stored server-side in PostgreSQL.
The user's last successful observation is stored for each stock. When they return, the new market data can be compared against that stored observation rather than relying on browser or session state.
### How stale, delayed or conflicting data is handled
Market data is stored with its fetch time and reliability state.
Live data and the latest completed market session can be used for decisions. Stale or unavailable data is shown as such but does not create new actionable signals.
Quote updates are monotonic, so an older fetch cannot overwrite a newer one.
### How the system scales for larger watchlists and more users
Market data is refreshed in bounded batches rather than once per browser request. Refresh cycles are protected by a database lease so multiple workers cannot run the same cycle at the same time.
Alert evaluation happens only for symbols whose quotes actually changed. The current design keeps the system on PostgreSQL; more infrastructure can be introduced later if the workload requires it.
### Where to keep things simple vs add complexity
The read path is intentionally simple. The browser reads persisted market state instead of calling the market-data provider directly.
Market refresh, quote persistence and alert evaluation happen on the write side. This avoids adding queues, workers or streaming infrastructure before they are necessary.

## Solution
The solution has two layers:
- **Since Last Check** — remembers what the user last saw for each stock and compares it with the next trusted market observation. A volatility-adaptive threshold decides whether the movement is significant.
- **Alerts** — lets users define simple conditions for stocks they care about. Alerts are evaluated when new market data is written and can move from active to near target or triggered.
The reasoning behind the main technical choices is documented in [`docs/ENGINEERING_DECISIONS.md`](docs/ENGINEERING_DECISIONS.md).

## Screenshots

Main Watchlist — Track stocks and see what changed
<img width="1470" height="875" alt="Screenshot 2026-09-05 at 10 42 52 PM" src="https://github.com/user-attachments/assets/6b789204-b8ba-47b1-97dd-b8baa02674cf" />

Add Stock — Add stocks to your watchlist
<img width="1470" height="875" alt="Screenshot 2026-09-05 at 10 45 02 PM" src="https://github.com/user-attachments/assets/d4ff4e9c-a89c-409f-aa25-6a89a29660b2" />

Create Alert — Set a condition for a stock
<img width="1470" height="875" alt="Screenshot 2026-09-05 at 10 45 25 PM" src="https://github.com/user-attachments/assets/f91ef5fc-26c8-4eef-a856-b1d4d054cf6d" />

## Architecture
```
Browser
  ↓  reads persisted state only
Next.js API routes
  ↓
Market / Watchlist / Alerts services
  ↓
Neon PostgreSQL
  ↑  lease-guarded refresh, one transaction
Scheduled refresh (cron-job.org)
  ↑
NSE provider (behind an adapter)
```

The read path is separate from the write path. Reading the watchlist is one query plus
pure functions — no network calls, no writes. Market refresh, quote persistence and alert
evaluation all happen on the write side, inside a single transaction, so a trigger always
points at the exact quote that caused it.


## Tech Stack

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Backend | Next.js App Router route handlers |
| Database | Neon PostgreSQL (WebSocket pool driver) |
| ORM | Drizzle ORM |
| Market Data | `stock-nse-india` (unofficial NSE client, behind a provider adapter) |
| Validation | Zod |
| Testing | Vitest against embedded PostgreSQL |
| Deployment | Vercel |
| Market Refresh | cron-job.org |

## Run Locally
```bash
git clone https://github.com/Sanskriti03070/groww-market-watchlist.git
cd groww-market-watchlist
npm install
```

Create `.env.local` from `.env.example` and set:

- `DATABASE_URL` — Neon Postgres connection string
- `OBSERVATION_TOKEN_SECRET` — signs the observation tokens used by Since Last Check
- `MARKET_REFRESH_SECRET` — protects the refresh endpoint called by the scheduler

```bash
npm run db:migrate
npm run db:seed
npm run dev
```

Open http://localhost:3000. No login — a session is created automatically. Add stocks,
then revisit later to see Since Last Check populate.
