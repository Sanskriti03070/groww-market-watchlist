# Engineering Decisions

### 1. PostgreSQL is the source of truth
**Context:** The watchlist must stay consistent across reloads, sessions, and multiple tabs.\
**Choice:** PostgreSQL owns watchlist membership and order. Mutations return the canonical ordered list, which the client adopts.\
**Why:** One authority for state makes consistency and concurrent changes predictable.

### 2. One owner, one watchlist
**Context:** The challenge asks for a watchlist, not a portfolio-management system.\
**Choice:** Each owner has one implicit watchlist; there is no `watchlists` table.\
**Why:** Multiple watchlists add complexity without improving the core product.

### 3. Reordering is concurrency-sensitive
**Context:** Two tabs can try to reorder the same watchlist at the same time.\
**Choice:** Reorder submits the complete intended ordering. A stale request is rejected with `409` rather than silently overwriting newer state.\
**Why:** Explicit conflicts are safer and easier to reason about than silent last-write-wins behavior.

### 4. Provider identifiers stay at the boundary
**Context:** Market-data providers have their own instrument identifiers.\
**Choice:** The application uses a canonical symbol and stores the provider identifier separately.\
**Why:** The rest of the product should not depend on which market-data provider we use.

### 5. Market data is persisted
**Context:** The watchlist needs to show market information consistently even when the provider is slow or unavailable.\
**Choice:** We persist the latest normalized quote in PostgreSQL instead of fetching market data directly for every user request.\
**Why:** This gives the application a stable copy of the latest known market state and lets us reason about freshness and changes without making every page load depend on the provider.

### 6. I kept provider time and our fetch time separate
**Context:** A provider can tell us when a market observation was generated, but that timestamp may be missing or unreliable.\
**Choice:** We store both `provider_ts` and `fetched_at`. Freshness is based on when our system actually received the data, while the provider timestamp is kept as information about the observation itself.\
**Why:** A bad provider timestamp should not make old data look fresh.

### 7. Freshness is calculated, not stored
**Context:** Whether market data is fresh changes as time passes, even when the quote itself does not change.\
**Choice:** We derive states such as `LIVE`, `STALE`, and `LAST_CLOSE` from the stored quote, its fetch time, and the current market session instead of storing a status on the quote.\
**Why:** The stored data stays about the market itself, while time-dependent reliability is always calculated from the current situation.

### 8. The market calendar stays local and deterministic
**Context:** We need to know whether the market is open, closed, or on a holiday to interpret quote freshness correctly.\
**Choice:** We use a small application-owned calendar based on Asia/Kolkata, the 09:15–15:30 regular session, weekends, and the 2026 NSE equity-market holidays.\
**Why:** Market-session logic should not depend on another network request or external service.

### 9. Market close is not data failure
**Context:** A quote naturally becomes old overnight and over weekends. Treating age alone as staleness would incorrectly report normal market closure as a broken data pipeline.\
**Choice:** Interpret quote age relative to the trading session and use `LAST_CLOSE` when a quote represents the completed session's close; mark it stale only when the application actually missed the close.\
**Why:** Reliability must distinguish “the market has stopped producing new prices” from “our system failed to capture available market data.”\

## 10. Designing the “Last Checked” Module
**What We Did**
Designed a persistent per-user/per-symbol observation model rather than treating “last checked” as a UI timestamp.
 Check is recorded only after trustworthy market data has rendered successfully. The client acknowledges the exact rendered quote using a signed observation token; the server validates the token, re-reads the quote, and advances the baseline only if the observation is newer than the existing one.Meaningful change is calculated deterministically using the stock’s current trading range, with bounded thresholds and a fallback for incomplete market data.
**What We Did Not Do**
- Page-level `lastCheckedAt`
- Update baseline on every GET
- Manual “Mark as checked”
- Trust client-supplied prices
- Store complete observation history
- Redis / queues / event infrastructure
- AI-based meaningful-change detection
**Why**
A request or page load does not prove that a user actually saw a particular quote. Client-supplied state cannot be trusted, and historical/event infrastructure is unnecessary for a feature that only needs the latest acknowledged baseline.
The token + server-side revalidation model gives us **exact quote identity, ownership validation, idempotency, and monotonic updates**, protecting against concurrent tabs, retries, delayed acknowledgements, and newer market data replacing the rendered quote.
We kept the persistence model intentionally small while putting the engineering complexity into **correctness, concurrency, and state integrity** rather than infrastructure.

### 11. Alert created while the condition is already true
**Context:** A price alert can be created when the stock is already on the trigger side of the threshold.
**Choice:** We seed the alert with the current side without triggering it. Each newer quote is then classified as FALSE or TRUE, and the alert triggers only on FALSE → TRUE. TRUE → TRUE does not trigger, while TRUE → FALSE re-arms the alert.
**Why:** This makes the alert represent an actual crossing after the alert was created, rather than treating an already-satisfied condition as a new event.
**Example:** ₹1,390 → FALSE → ₹1,395 → FALSE → ₹1,400 → TRUE (trigger) → ₹1,405 → TRUE (no trigger) → ₹1,390 → FALSE → ₹1,400 → TRUE (trigger again).

### 12. Editing an alert while it is already satisfied
**Context:** Editing an alert can place its new threshold on the already-satisfied side of the current price.
**Choice:** We reseed last_side using the current trustworthy quote after an edit and do not trigger immediately.
**Why:** An edit creates a new alert configuration; it should not manufacture a historical crossing from the previous configuration.
**Example:** ₹1,386 → edit ABOVE ₹1,400 to ABOVE ₹1,300 → TRUE is seeded → no trigger → ₹1,295 → FALSE → ₹1,305 → TRUE (trigger).

### 14. Repeated last-close observations after market close
**Context:** After market close, the same captured quote can be returned on multiple visits or refreshes.
**Choice:** LAST_CLOSE is eligible for evaluation, but only once for a given quote_fetched_at. Repeated observations with the same timestamp are ignored. Highlighting is disabled because highlighting requires LIVE data.
**Why:** We must not manufacture repeated evaluations or apparent activity from a market that is no longer producing new observations.
**Example:** 15:30 ₹1,405 / fetched_at=A → evaluate once → 18:00 fetched_at=A → skip → next session fetched_at=B → evaluate again.

### 15. Overnight gap across an alert threshold
**Context:** The market can reopen on the opposite side of an alert threshold without ever producing an observed quote exactly at that threshold.
**Choice:** We treat the first newer trustworthy observation on the trigger side as the crossing observation and record its actual price.
**Why:** Waiting for an exact threshold price would miss legitimate crossings caused by gaps. We also never invent an unobserved ₹1,400 price.
**Example:** Friday ₹1,390 → FALSE → Monday ₹1,425 → TRUE (trigger). The trigger records ₹1,425 as the observed price.

### 16. Missing previous close for a day-move alert
**Context:** A DAY_MOVE alert requires previousClose, but that value may be unavailable.
**Choice:** We skip evaluation for that observation rather than deriving or guessing a previous close. PRICE_LEVEL alerts continue to work because they do not depend on previousClose.
**Why:** An incorrect baseline can create a false percentage movement and therefore a false trigger.

### 17. Stable vs Volatile stock
**Context:** A fixed proximity rule such as “highlight when within 1%” treats a highly volatile stock and a stable stock identically.
**Choice:** We derive the highlight proximity from the stock's current day range: proximityBand = clamp(0.30 × dayRangePercent, 0.25%, 2.0%). If the day range cannot be calculated, we use a 0.75% fallback. Highlighting is only possible for an ACTIVE alert with trustworthy LIVE data and while the alert remains on its pre-trigger side.
**Why:** The same absolute distance from a threshold does not have the same significance across stocks. A volatility-scaled band makes “close to triggering” relative to the stock's actual movement while the clamps prevent the highlight from becoming either too sensitive or too difficult to reach.
**Example:** If a stock's day range is 4%, the proximity band is 1.2%; if its day range is 10%, the raw band is 3% but the 2.0% maximum applies. A price within that band is highlighted; once the alert actually crosses, it becomes TRIGGERED rather than HIGHLIGHTED.

### 18. Near Target and triggered calculation
**Context:** An alert can become visually important when the current price is close to its threshold, before the threshold is actually crossed.
**Choice:** HIGHLIGHTED is derived only for an ACTIVE alert with LIVE data that remains on its pre-trigger side. We calculate distancePercent = |threshold - currentPrice| / currentPrice × 100 and compare it with a volatility-scaled proximityBand = clamp(0.30 × ((dayHigh - dayLow) / previousClose × 100), 0.25%, 2.0%). If the required range data is unavailable, the fallback proximity band is 0.75%. Once the alert crosses its threshold and becomes TRIGGERED, it is no longer highlighted.
**Why:** We wanted “close to happening” to adapt to the stock's actual intraday movement rather than using an arbitrary fixed distance for every stock. Keeping the highlight derived also prevents stale highlight state from surviving a trigger.
**Example:** If the day range is 4%, the proximity band is 1.2%. A price within 1.2% of the threshold can be highlighted while still pre-trigger; once the threshold is crossed, the alert becomes TRIGGERED.


### 20. We use a volatility adaptive threshold to define meaningful change
**Context:** The watchlist needs to identify what has meaningfully changed since the user's last check, without treating every small price movement as significant. A fixed percentage threshold would behave poorly across stocks with different levels of normal price movement.
**Choice:** We calculate the movement from the user's stored baseline and compare it against a stock-specific threshold derived from its current trading range. The threshold is 25% of the day-range percentage, clamped between 0.5% and 3.0%, with a 1.0% fallback when the required range data is unavailable. A change is meaningful when the absolute movement meets or exceeds that threshold.
**Why:** This makes “meaningful change” adaptive to each stock's recent activity instead of using an arbitrary fixed percentage. Stable stocks can surface smaller meaningful movements while highly volatile stocks require a larger move, helping users focus on changes that actually deserve attention. This directly satisfies the problem statement's requirement to help users quickly understand what has meaningfully changed since they last checked and what deserves their attention now. The UI also makes the decision transparent through the Since Last Check indicator popover and threshold explanation.

### 21. We use external scheduling to keep market data fresh without relying on paid Vercel Cron
**Context:** The watchlist is expected to show current market information when users return during market hours. Vercel Hobby does not support the intraday Cron frequency required by our refresh design, and reducing the schedule to once daily would materially degrade the product by allowing users to encounter stale market information.
**Choice:** Vercel Hobby hosts the application, while cron-job.org runs the primary market refresh approximately every minute and GitHub Actions provides a lower-frequency fallback of approximately every five minutes during the market session. Neon remains the database and the NSE provider remains the market-data source. The existing database refresh lease protects against concurrent refreshes.
**Why:** This preserves the intended market-freshness behavior without requiring paid infrastructure, while providing scheduler redundancy if the primary scheduler is temporarily unavailable. It also keeps the application architecture simple: the schedulers only invoke the existing refresh endpoint; all market-data fetching, persistence, reliability handling, and alert evaluation remain inside the application. This directly addresses the problem statement's requirement to determine how to handle stale/delayed data and how the system should behave for a real, returning user.

### 22. We use a refresh lease to safely coordinate scheduled market refreshes
**Context:** Market refreshes can be invoked by more than one scheduler, and a refresh can overlap with another invocation if a previous cycle has not completed.
**Choice:** The refresh pipeline acquires a short-lived database-backed refresh lease before starting a market-data cycle. Only the lease holder performs the refresh; competing invocations exit safely. The lease is shorter than the refresh cycle's execution limits so an abandoned lease does not permanently block future refreshes.
**Why:** This prevents concurrent workers from unnecessarily hitting the market-data provider, racing to write the same observations, or evaluating alerts multiple times for the same refresh cycle. It allows multiple scheduling mechanisms to safely invoke the same endpoint without duplicating the refresh pipeline. This is important for the problem statement's requirement to decide how state persists, how delayed/conflicting data is handled, and how the system should scale to larger watchlists and more users.