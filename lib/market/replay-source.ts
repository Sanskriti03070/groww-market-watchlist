// A MarketSource that replays a fixed, caller-supplied set of quotes
// instead of calling NSE. No file/fixture format, no scheduling - just the
// second MarketSource implementation the interface is designed around, for
// local development and testing without live provider calls.

import type { FetchOutcome, MarketSource, NormalizedQuote, SymbolFailure, SymbolRef } from "@/lib/market/source";

export class ReplayMarketSource implements MarketSource {
  readonly id = "replay" as const;
  private readonly quotesBySymbol: Map<string, NormalizedQuote>;

  constructor(quotes: NormalizedQuote[]) {
    this.quotesBySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));
  }

  async fetchQuotes(refs: SymbolRef[]): Promise<FetchOutcome> {
    const quotes: NormalizedQuote[] = [];
    const symbolFailures: SymbolFailure[] = [];
    for (const ref of refs) {
      const quote = this.quotesBySymbol.get(ref.symbol);
      if (quote) {
        quotes.push(quote);
      } else {
        symbolFailures.push({ symbol: ref.symbol, reason: "NOT_FOUND" });
      }
    }
    return { kind: "CYCLE_OK", quotes, symbolFailures };
  }
}
