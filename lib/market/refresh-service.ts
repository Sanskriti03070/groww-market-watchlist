// Runs one market-data refresh cycle: acquire the shared lease, load the
// refresh set, fetch quotes (network I/O, outside any DB transaction), then
// commit every write - successful quotes, symbol failures, and refresh-state
// bookkeeping - in one transaction. Does not schedule cycles -
// app/api/market/refresh/route.ts decides when to call this.

import { randomUUID } from "node:crypto";
import type { Database } from "@/db/types";
import {
  acquireRefreshLease,
  getActiveEquitySymbolRefs,
  getDatabaseNow,
  recordSymbolFailure,
  releaseRefreshLease,
  upsertSuccessfulQuote,
} from "@/lib/db/quotes-repo";
import { evaluateAlertsForRefreshedSymbols, type QuoteObservation } from "@/lib/alerts/service";
import { nseLiveSource } from "@/lib/market/nse-live-source";
import type { FetchOutcome, MarketSource } from "@/lib/market/source";
import { getSessionSnapshot } from "@/lib/nse-session-calendar";
import { resolveReliability } from "@/lib/quote-reliability";

const LEASE_TTL_MS = 30_000;

export type RefreshCycleResult = { ran: true; succeeded: number; failed: number } | { ran: false; reason: "lease_held" };

export async function refreshMarketData(db: Database, source: MarketSource = nseLiveSource): Promise<RefreshCycleResult> {
  const holder = randomUUID();
  const cycleStart = new Date();

  const acquired = await acquireRefreshLease(db, holder, cycleStart, LEASE_TTL_MS);
  if (!acquired) {
    console.log(JSON.stringify({ event: "market_refresh_skipped", reason: "lease_held" }));
    return { ran: false, reason: "lease_held" };
  }
  console.log(JSON.stringify({ event: "market_refresh_started", holder }));

  const refs = await getActiveEquitySymbolRefs(db);
  const outcome: FetchOutcome = await source.fetchQuotes(refs); // network I/O - never inside a DB transaction

  let succeeded = 0;
  let failed = 0;
  let success = false;

  if (outcome.kind === "CYCLE_FAILED") {
    console.log(JSON.stringify({ event: "market_refresh_cycle_failed", reason: outcome.reason }));
    failed = refs.length;
  } else {
    for (const failure of outcome.symbolFailures) {
      console.log(JSON.stringify({ event: "market_refresh_symbol_failed", symbol: failure.symbol, reason: failure.reason }));
    }
    succeeded = outcome.quotes.length;
    failed = outcome.symbolFailures.length;
    success = true;
  }

  // T2: successful quote writes, symbol-failure writes, alert evaluation/
  // trigger insertion, and refresh-state completion/failure/backoff
  // bookkeeping all commit together. Partial success is still valid within
  // this - completed symbols commit even though others in this cycle
  // failed - but the lease/state update, and every alert transition it
  // caused, are part of the same commit as the quote data that drove them.
  await db.transaction(async (tx) => {
    if (outcome.kind === "CYCLE_OK") {
      // Database time and session state are resolved once for the whole
      // cycle and reused for every quote's reliability, rather than
      // re-reading either per symbol.
      const now = await getDatabaseNow(tx);
      const session = getSessionSnapshot(now);
      const observations: QuoteObservation[] = [];

      for (const quote of outcome.quotes) {
        // Only a quote that actually became the persisted truth this cycle
        // (see upsertSuccessfulQuote's monotonic guard) is eligible for
        // alert evaluation - a slower/duplicate/out-of-order fetch that
        // lost the race must never drive an alert transition.
        const persisted = await upsertSuccessfulQuote(tx, quote);
        if (persisted) {
          observations.push({
            symbol: persisted.symbol,
            lastPrice: persisted.lastPrice,
            previousClose: persisted.previousClose,
            fetchedAt: persisted.fetchedAt,
            reliability: resolveReliability({ fetchedAt: persisted.fetchedAt, now, session }),
          });
        }
      }
      for (const failure of outcome.symbolFailures) {
        await recordSymbolFailure(tx, failure, new Date());
      }

      // Failed symbols never reach `observations` at all, so their alerts
      // are never selected for evaluation - a full CYCLE_FAILED above
      // means this whole block, and therefore every alert, is skipped.
      await evaluateAlertsForRefreshedSymbols(tx, now, observations);
    }
    // Ownership check inside releaseRefreshLease (WHERE lease_holder = holder)
    // ensures an expired old holder can never clear a newer holder's lease.
    await releaseRefreshLease(tx, holder, new Date(), success);
  });

  console.log(JSON.stringify({ event: "market_refresh_completed", holder, succeeded, failed, success }));

  return { ran: true, succeeded, failed };
}
