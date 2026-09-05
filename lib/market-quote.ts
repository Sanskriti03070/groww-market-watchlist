// Domain model for a market-data fetch cycle. These types describe the
// shape the rest of the system works with; nothing here is provider-specific
// (no response payloads, headers, or cookies) - that detail stays behind
// whichever MarketSource implementation produces a FetchOutcome.

/** Our application's canonical symbol (e.g. "RELIANCE"). Never a provider identifier. */
export type CanonicalSymbol = string;

/** A point in time. Plain `Date`, matching how timestamps are already represented elsewhere in this codebase. */
export type Instant = Date;

/**
 * A price-like value. Represented as a string, matching how Postgres
 * `numeric` columns are already read through Drizzle (see db/schema.ts) -
 * avoids floating-point rounding on money-like figures.
 */
export type Decimal = string;

export type NormalizedQuote = {
  symbol: CanonicalSymbol;
  lastPrice: Decimal;
  previousClose: Decimal;
  dayOpen: Decimal | null;
  dayHigh: Decimal | null;
  dayLow: Decimal | null;
  weekHigh52: Decimal | null;
  weekLow52: Decimal | null;
  volume: bigint | null;
  providerTs: Instant | null;
  fetchedAt: Instant;
};

export type ProviderErrorCode =
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "UNREACHABLE";

export type SymbolErrorCode =
  | "NOT_FOUND"
  | "MALFORMED"
  | "INCOMPLETE"
  | "TIMEOUT"
  | "HTTP_ERROR";

export type SymbolRef = {
  symbol: CanonicalSymbol;
  providerSymbol: string;
};

export type SymbolFailure = {
  symbol: CanonicalSymbol;
  reason: SymbolErrorCode;
};

/** The result of one fetch cycle: either it ran (with some symbols possibly failing individually), or it didn't run at all. */
export type FetchOutcome =
  | {
      kind: "CYCLE_OK";
      quotes: NormalizedQuote[];
      symbolFailures: SymbolFailure[];
    }
  | {
      kind: "CYCLE_FAILED";
      reason: ProviderErrorCode;
    };

export interface MarketSource {
  readonly id: "nse-live" | "replay";
  fetchQuotes(refs: SymbolRef[]): Promise<FetchOutcome>;
}
