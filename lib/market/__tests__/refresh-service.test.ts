// Wiring tests for the T2 write transaction: do successfully-refreshed
// symbols drive alert evaluation while failed ones don't, and does a full
// cycle failure evaluate nothing? The reliability outcome (LIVE vs
// LAST_CLOSE) genuinely depends on real market-session time here, since
// this exercises the actual write path end to end - trustworthyFetchedAt()
// adapts to whichever the real session state is at test-run time, so the
// test is deterministic regardless of when it runs. Deeper evaluation-logic
// coverage (STALE/older-quote/etc.) lives in
// lib/alerts/__tests__/refresh-evaluation.test.ts against the pure,
// injectable evaluateAlertsForRefreshedSymbols function directly.

import { describe, expect, it } from "vitest";
import type { Database } from "@/db/types";
import * as repo from "@/lib/alerts/repo";
import { createAlert, getAlert } from "@/lib/alerts/service";
import { getDatabaseNow } from "@/lib/db/quotes-repo";
import { refreshMarketData } from "@/lib/market/refresh-service";
import { ReplayMarketSource } from "@/lib/market/replay-source";
import type { FetchOutcome, MarketSource, NormalizedQuote } from "@/lib/market/source";
import { getSessionSnapshot } from "@/lib/nse-session-calendar";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";
import { addSymbolToWatchlist } from "@/lib/watchlist";
import { createTestOwner, getTestDb } from "@/lib/__tests__/test-db";

const EQUITY_SYMBOLS = SYMBOL_UNIVERSE.filter((s) => s.kind === "EQUITY").map((s) => s.symbol);

/** A fetchedAt guaranteed to resolve as trustworthy (LIVE if the market happens to be open right now, LAST_CLOSE otherwise), regardless of when this test runs. */
async function trustworthyFetchedAt(db: Database): Promise<Date> {
  const now = await getDatabaseNow(db);
  const session = getSessionSnapshot(now);
  if (session.state === "OPEN") {
    return now;
  }
  if (session.lastCompleted) {
    return new Date(session.lastCompleted.close.getTime() - 30_000);
  }
  return now; // defensive fallback only - not expected to be hit
}

function quote(symbol: string, lastPrice: string, fetchedAt: Date): NormalizedQuote {
  return {
    symbol,
    lastPrice,
    previousClose: "1400.0000",
    dayOpen: null,
    dayHigh: null,
    dayLow: null,
    weekHigh52: null,
    weekLow52: null,
    volume: null,
    providerTs: null,
    fetchedAt,
  };
}

class FailingSource implements MarketSource {
  readonly id = "replay" as const;
  async fetchQuotes(): Promise<FetchOutcome> {
    return { kind: "CYCLE_FAILED", reason: "UNREACHABLE" };
  }
}

const SEED_TIME = new Date("2026-06-01T00:00:00.000Z");

/** Pre-armed at side -1 (below threshold) so the refresh cycle's observation exercises a real crossing, not the from-null "establish only" case. */
async function setupArmedBelowAlert(symbol: string, threshold = 1400) {
  const db = getTestDb();
  const { ownerId } = await createTestOwner();
  await addSymbolToWatchlist(db, ownerId, symbol);
  const created = await createAlert(db, {
    ownerId,
    symbol,
    conditionType: "PRICE_LEVEL",
    direction: "ABOVE",
    thresholdValue: threshold,
    currentQuote: { lastPrice: threshold - 50, changePercent: null, fetchedAt: SEED_TIME },
  });
  if (!created.ok) throw new Error("test setup failed");
  return { db, ownerId, alert: created.alert };
}

describe("refreshMarketData - alert evaluation integration", () => {
  it("evaluates alerts only for symbols whose quote successfully refreshed this cycle, atomically with the quote write", async () => {
    const db = getTestDb();
    const successSymbol = EQUITY_SYMBOLS[20];
    const failedSymbol = EQUITY_SYMBOLS[21];
    const fetchedAt = await trustworthyFetchedAt(db);

    const success = await setupArmedBelowAlert(successSymbol);
    const failed = await setupArmedBelowAlert(failedSymbol);

    // Every other active equity symbol is deliberately absent from the
    // replay source too and will fail as NOT_FOUND - harmless noise,
    // exactly like a real partial provider outage.
    const source = new ReplayMarketSource([quote(successSymbol, "1450.0000", fetchedAt)]);

    const result = await refreshMarketData(db, source);
    expect(result).toEqual({ ran: true, succeeded: 1, failed: expect.any(Number) });

    const successAlert = await getAlert(db, success.ownerId, success.alert.id);
    expect(successAlert?.lastSide).toBe(1); // 1450 >= 1400 threshold, evaluated
    expect(successAlert?.lastEvaluatedQuoteAt).toEqual(fetchedAt);

    const triggers = await repo.listTriggersByAlert(db, success.ownerId, success.alert.id);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].quoteFetchedAt).toEqual(fetchedAt);

    // The failed symbol's quote never became the persisted truth this
    // cycle, so its alert was never selected for evaluation.
    const failedAlert = await getAlert(db, failed.ownerId, failed.alert.id);
    expect(failedAlert?.lastSide).toBe(-1); // untouched, still exactly as seeded at creation
    expect(failedAlert?.lastEvaluatedQuoteAt).toEqual(SEED_TIME);
  });

  it("a full cycle failure (provider unreachable) evaluates nothing", async () => {
    const db = getTestDb();
    const symbol = EQUITY_SYMBOLS[22];
    const { ownerId, alert } = await setupArmedBelowAlert(symbol);

    const result = await refreshMarketData(db, new FailingSource());
    expect(result.ran).toBe(true);

    const unchanged = await getAlert(db, ownerId, alert.id);
    expect(unchanged?.lastSide).toBe(-1); // untouched, still exactly as seeded at creation
    expect(unchanged?.lastEvaluatedQuoteAt).toEqual(SEED_TIME);
    const triggers = await repo.listTriggersByAlert(db, ownerId, alert.id);
    expect(triggers).toHaveLength(0);
  });
});
