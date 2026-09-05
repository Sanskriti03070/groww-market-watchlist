# Plan
## Goal
Build a market watchlist that does more than display prices. A user should be able to return later and quickly understand what changed and what deserves attention.
## 1. Product foundation
- Create and manage a personal watchlist.
- Persist watchlist state across sessions.
- Display the latest available market information.
- Show price, day movement, volume, and market status.
## 2. Market data
- Integrate the NSE market data provider.
- Normalize provider responses into one internal quote format.
- Validate incomplete and malformed responses.
- Persist successful quotes.
- Keep the previous trusted value when a symbol fails to refresh.
- Track freshness and reliability explicitly.
## 3. Since Last Check
- Store the last trusted observation for each stock and user.
- Compare the next trusted observation with that baseline.
- Use the stock's trading range to adapt the meaningful-change threshold.
- Show whether the movement is meaningful or not significant.
- Explain the decision directly in the watchlist.
## 4. Alerts
- Support price-level alerts.
- Support day-move alerts.
- Allow users to enable, disable, edit, dismiss, and delete alerts.
- Evaluate alerts when new market data is written.
- Record a trigger when a condition crosses from false to true.
- Surface active, near-target, and triggered alerts in the watchlist.
## 5. Reliability
- Do not make decisions from stale or unavailable data.
- Treat the latest completed market session as trustworthy after close.
- Capture the post-close value once.
- Prevent older provider responses from replacing newer quotes.
## 6. Concurrency and state
- Use a database lease to prevent overlapping refresh cycles.
- Lock alerts while they are being evaluated.
- Use quote timestamps to make updates monotonic.
- Use unique trigger constraints to prevent duplicate triggers.
- Keep all user-owned data scoped to the owner.
## 7. API and frontend
- Keep market refresh separate from normal read requests.
- Expose watchlist and alert data through application APIs.
- Keep market-provider details out of the frontend.
- Keep alert evaluation and meaningful-change logic in domain code.
- Keep SQL inside repository code.
## 8. Testing
- Test meaningful-change calculations and edge cases.
- Test alert state transitions and trigger creation.
- Test refresh and concurrency behavior.
- Test API validation and owner isolation.
- Test watchlist and alert integration.
- Run tests, type checking, linting, and the production build before release.
## 9. Production
- Deploy the application on Vercel.
- Use Neon PostgreSQL for production persistence.
- Run market refreshes through an external scheduler.
- Protect the refresh endpoint with a server-side secret.
- Keep production secrets outside the repository.
