// Re-exports the provider-boundary contract for the lib/market/* modules.
// lib/market-quote.ts remains the single, authoritative definition of these
// types - this file exists only so code under lib/market/ doesn't reach
// back out of its own folder for its core contract.

export type {
  CanonicalSymbol,
  Decimal,
  FetchOutcome,
  Instant,
  MarketSource,
  NormalizedQuote,
  ProviderErrorCode,
  SymbolErrorCode,
  SymbolFailure,
  SymbolRef,
} from "@/lib/market-quote";
