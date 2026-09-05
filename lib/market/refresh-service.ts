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
  recordSymbolFailure,
  releaseRefreshLease,
  upsertSuccessfulQuote,
} from "@/lib/db/quotes-repo";
import { nseLiveSource } from "@/lib/market/nse-live-source";
import type { FetchOutcome, MarketSource } from "@/lib/market/source";

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

  // T2: successful quote writes, symbol-failure writes, and refresh-state
  // completion/failure/backoff bookkeeping all commit together. Partial
  // success is still valid within this - completed symbols commit even
  // though others in this cycle failed - but the lease/state update is
  // part of the same commit as the quote data it describes.
  await db.transaction(async (tx) => {
    if (outcome.kind === "CYCLE_OK") {
      for (const quote of outcome.quotes) {
        await upsertSuccessfulQuote(tx, quote);
      }
      for (const failure of outcome.symbolFailures) {
        await recordSymbolFailure(tx, failure, new Date());
      }
    }
    // Ownership check inside releaseRefreshLease (WHERE lease_holder = holder)
    // ensures an expired old holder can never clear a newer holder's lease.
    await releaseRefreshLease(tx, holder, new Date(), success);
  });

  console.log(JSON.stringify({ event: "market_refresh_completed", holder, succeeded, failed, success }));

  return { ran: true, succeeded, failed };
}
