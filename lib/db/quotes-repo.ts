// Reading and writing `quotes` and `market_refresh_state`. No provider
// knowledge here - callers pass already-normalized data (see
// lib/market-quote.ts) or read back the plain persisted shape.

import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Database } from "@/db/types";
import { marketRefreshState, symbols as symbolsTable, quotes as quotesTable, watchlistItems } from "@/db/schema";
import type { CanonicalSymbol, Decimal, Instant, NormalizedQuote, SymbolFailure, SymbolRef } from "@/lib/market-quote";

export type PersistedQuote = {
  lastPrice: Decimal;
  previousClose: Decimal;
  dayOpen: Decimal | null;
  dayHigh: Decimal | null;
  dayLow: Decimal | null;
  weekHigh52: Decimal | null;
  weekLow52: Decimal | null;
  volume: number | null;
  fetchedAt: Instant;
};

const MAX_BACKOFF_MS = 5 * 60_000;
const BACKOFF_STEP_MS = 30_000;

/** The database's own clock, as the authoritative "now" for a read - avoids relying on app-server clock skew. */
export async function getDatabaseNow(db: Database): Promise<Instant> {
  // db's driver is generic (see db/types.ts), so the raw result type can't
  // be resolved through it; the shape is fixed by the literal query above.
  const result = (await db.execute(sql`select now() as now`)) as { rows: [{ now: string }] };
  return new Date(result.rows[0].now);
}

/** The refresh set: active equities. Indices aren't supported by the current adapter (see lib/market/nse-live-source.ts). */
export async function getActiveEquitySymbolRefs(db: Database): Promise<SymbolRef[]> {
  const rows = await db
    .select({ symbol: symbolsTable.symbol, providerSymbol: symbolsTable.providerSymbol })
    .from(symbolsTable)
    .where(and(eq(symbolsTable.isActive, true), eq(symbolsTable.kind, "EQUITY")));
  return rows;
}

/** The read set: every symbol on any watchlist can render its last known quote, active or not. */
export async function getQuotesForSymbols(
  db: Database,
  symbols: CanonicalSymbol[],
): Promise<Map<CanonicalSymbol, PersistedQuote>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      symbol: quotesTable.symbol,
      lastPrice: quotesTable.lastPrice,
      previousClose: quotesTable.previousClose,
      dayOpen: quotesTable.dayOpen,
      dayHigh: quotesTable.dayHigh,
      dayLow: quotesTable.dayLow,
      weekHigh52: quotesTable.weekHigh52,
      weekLow52: quotesTable.weekLow52,
      volume: quotesTable.volume,
      fetchedAt: quotesTable.fetchedAt,
    })
    .from(quotesTable)
    .where(inArray(quotesTable.symbol, symbols));

  return new Map(rows.map((row) => [row.symbol, row]));
}

export type WatchlistQuoteRow = {
  symbol: CanonicalSymbol;
  position: number;
  addedAt: Instant;
  quote: PersistedQuote | null;
};

/** One query for one owner's watchlist joined to each symbol's latest quote, if any. */
export async function getWatchlistWithQuotes(db: Database, ownerId: string): Promise<WatchlistQuoteRow[]> {
  const rows = await db
    .select({
      symbol: watchlistItems.symbol,
      position: watchlistItems.position,
      addedAt: watchlistItems.addedAt,
      lastPrice: quotesTable.lastPrice,
      previousClose: quotesTable.previousClose,
      dayOpen: quotesTable.dayOpen,
      dayHigh: quotesTable.dayHigh,
      dayLow: quotesTable.dayLow,
      weekHigh52: quotesTable.weekHigh52,
      weekLow52: quotesTable.weekLow52,
      volume: quotesTable.volume,
      fetchedAt: quotesTable.fetchedAt,
    })
    .from(watchlistItems)
    .leftJoin(quotesTable, eq(watchlistItems.symbol, quotesTable.symbol))
    .where(eq(watchlistItems.ownerId, ownerId))
    .orderBy(asc(watchlistItems.position));

  return rows.map((row) => ({
    symbol: row.symbol,
    position: row.position,
    addedAt: row.addedAt,
    // lastPrice is NOT NULL on quotes, so it doubles as the "matched" flag
    // for this LEFT JOIN; previousClose/fetchedAt are asserted alongside it
    // for the same reason - either every joined column is present, or none is.
    quote:
      row.lastPrice === null
        ? null
        : {
            lastPrice: row.lastPrice,
            previousClose: row.previousClose!,
            dayOpen: row.dayOpen,
            dayHigh: row.dayHigh,
            dayLow: row.dayLow,
            weekHigh52: row.weekHigh52,
            weekLow52: row.weekLow52,
            volume: row.volume,
            fetchedAt: row.fetchedAt!,
          },
  }));
}

/**
 * Inserts or updates the successful quote for one symbol. An older, slower
 * refresh must never clobber a newer successful one, so the update side of
 * the upsert only applies when the incoming fetchedAt is actually newer.
 */
export async function upsertSuccessfulQuote(db: Database, quote: NormalizedQuote): Promise<void> {
  const values = {
    symbol: quote.symbol,
    lastPrice: quote.lastPrice,
    previousClose: quote.previousClose,
    dayOpen: quote.dayOpen,
    dayHigh: quote.dayHigh,
    dayLow: quote.dayLow,
    weekHigh52: quote.weekHigh52,
    weekLow52: quote.weekLow52,
    volume: quote.volume === null ? null : Number(quote.volume),
    providerTs: quote.providerTs,
    fetchedAt: quote.fetchedAt,
    consecutiveFailures: 0,
    lastErrorCode: null,
  };

  await db
    .insert(quotesTable)
    .values(values)
    .onConflictDoUpdate({
      target: quotesTable.symbol,
      set: values,
      setWhere: sql`${quotesTable.fetchedAt} < excluded.fetched_at`,
    });
}

/**
 * Records a failed refresh attempt against an existing quote row. There is
 * nothing to record if the symbol has never had a successful quote - quotes
 * requires non-null prices, so no row exists yet to attach failure state
 * to, and one is never fabricated just to hold it. Never touches price
 * fields or fetched_at.
 */
export async function recordSymbolFailure(db: Database, failure: SymbolFailure, failedAt: Instant): Promise<void> {
  await db
    .update(quotesTable)
    .set({
      consecutiveFailures: sql`${quotesTable.consecutiveFailures} + 1`,
      lastErrorCode: failure.reason,
      lastFailureAt: failedAt,
    })
    .where(eq(quotesTable.symbol, failure.symbol));
}

/**
 * Atomically claims the single shared refresh lease if it's free, expired,
 * or past backoff. Returns whether this caller now holds it. The row is
 * created on first use - there is no separate migration/seed step for it.
 */
export async function acquireRefreshLease(
  db: Database,
  holder: string,
  now: Instant,
  ttlMs: number,
): Promise<boolean> {
  await db.insert(marketRefreshState).values({ id: "global" }).onConflictDoNothing();

  const leaseExpiresAt = new Date(now.getTime() + ttlMs);
  const claimed = await db
    .update(marketRefreshState)
    .set({ leaseHolder: holder, leaseExpiresAt, cycleStartedAt: now })
    .where(
      and(
        eq(marketRefreshState.id, "global"),
        or(isNull(marketRefreshState.leaseHolder), lt(marketRefreshState.leaseExpiresAt, now)),
        or(isNull(marketRefreshState.backoffUntil), lt(marketRefreshState.backoffUntil, now)),
      ),
    )
    .returning({ id: marketRefreshState.id });

  return claimed.length > 0;
}

/** Releases the lease this caller holds and records cycle completion/backoff. A no-op if the lease has already moved on (e.g. expired and re-claimed). */
export async function releaseRefreshLease(db: Database, holder: string, now: Instant, success: boolean): Promise<void> {
  const [row] = await db
    .select({ consecutiveFailures: marketRefreshState.consecutiveFailures })
    .from(marketRefreshState)
    .where(eq(marketRefreshState.id, "global"));

  const consecutiveFailures = success ? 0 : (row?.consecutiveFailures ?? 0) + 1;
  const backoffUntil = success ? null : new Date(now.getTime() + Math.min(consecutiveFailures * BACKOFF_STEP_MS, MAX_BACKOFF_MS));

  await db
    .update(marketRefreshState)
    .set({ leaseHolder: null, leaseExpiresAt: null, cycleCompletedAt: now, consecutiveFailures, backoffUntil })
    .where(and(eq(marketRefreshState.id, "global"), eq(marketRefreshState.leaseHolder, holder)));
}

/** Whether a cycle has already completed at or after `since` - used to skip a redundant post-close capture. */
export async function hasCompletedCycleSince(db: Database, since: Instant): Promise<boolean> {
  const [row] = await db
    .select({ cycleCompletedAt: marketRefreshState.cycleCompletedAt })
    .from(marketRefreshState)
    .where(eq(marketRefreshState.id, "global"));

  return row?.cycleCompletedAt != null && row.cycleCompletedAt.getTime() >= since.getTime();
}
