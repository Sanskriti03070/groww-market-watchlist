// The only file that talks to stock-nse-india. Nothing provider-specific
// (tokens, response shapes, the library itself, cookies) crosses out of
// this module - callers only see MarketSource/FetchOutcome.
//
// Provider facts this is built on, verified directly against the live
// provider rather than assumed:
// - GET /api/equity/:symbol ("quote-equity") returns HTTP 403 in
//   production, so quotes are derived from daily OHLC chart data instead.
// - getEquityChartHistoricalData's default chartType is intraday ('I');
//   'D' (daily) must be requested explicitly.
// - A bare canonical symbol can resolve to the wrong instrument: "RELIANCE"
//   (no suffix) fuzzy-matches NSE's symbol search to "RCOM-BE" (Reliance
//   Communications - an unrelated company), while "RELIANCE-EQ" resolves
//   exactly to Reliance Industries (scripcode 2885). The "-EQ" suffix is
//   therefore required and lives in symbols.provider_symbol.
// - Chart data has no 52-week high/low; both stay null per Step 4 scope
//   rather than costing every symbol an extra full-year fetch per cycle.
//
// Open question, not resolved here (see R1/R3 in the task): live-market
// (state OPEN) behavior against real NSE has not been observed, since
// development happened outside market hours. The trading-date guard below
// implements the locked design for that case; it has not been proven live.

import { NseIndia } from "stock-nse-india";
import { normalizeDailyBars, type DailyBar } from "@/lib/market/normalize";
import { getSessionState, istCalendarDateOf } from "@/lib/nse-session-calendar";
import type { FetchOutcome, MarketSource, NormalizedQuote, SymbolFailure, SymbolRef } from "@/lib/market/source";

const LOOKBACK_DAYS = 10; // Comfortably spans any single NSE holiday cluster, so at least two daily bars come back.
const PER_SYMBOL_TIMEOUT_MS = 4_000;
const CONCURRENCY_LIMIT = 6;
const CYCLE_DEADLINE_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("provider request timed out")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

type SymbolResult = { ok: true; quote: NormalizedQuote } | { ok: false; failure: SymbolFailure };

class NseLiveMarketSource implements MarketSource {
  readonly id = "nse-live" as const;
  private readonly nse = new NseIndia();
  // providerSymbol -> resolved scripcode. Module-scope, in-memory, lazy:
  // populated on first use per symbol, never persisted, never re-fetched
  // once known (the token doesn't change between refresh cycles).
  private readonly tokenCache = new Map<string, string>();

  async fetchQuotes(refs: SymbolRef[]): Promise<FetchOutcome> {
    try {
      const now = new Date();
      const state = getSessionState(now);
      const session = { isOpen: state === "OPEN", todayIstDate: istCalendarDateOf(now) };

      const deadline = Date.now() + CYCLE_DEADLINE_MS;
      const results = await this.mapWithConcurrency(refs, CONCURRENCY_LIMIT, (ref) =>
        Date.now() >= deadline
          ? Promise.resolve<SymbolResult>({ ok: false, failure: { symbol: ref.symbol, reason: "TIMEOUT" } })
          : this.fetchOne(ref, session),
      );

      const quotes: NormalizedQuote[] = [];
      const symbolFailures: SymbolFailure[] = [];
      for (const result of results) {
        if (result.ok) {
          quotes.push(result.quote);
        } else {
          symbolFailures.push(result.failure);
        }
      }
      return { kind: "CYCLE_OK", quotes, symbolFailures };
    } catch {
      // Every ref is fetched and caught individually below; reaching here
      // means something broke before per-symbol handling even ran.
      return { kind: "CYCLE_FAILED", reason: "UNREACHABLE" };
    }
  }

  private async resolveToken(providerSymbol: string): Promise<string> {
    const cached = this.tokenCache.get(providerSymbol);
    if (cached !== undefined) {
      return cached;
    }
    const info = await this.nse.getEquitySymbolInfo(providerSymbol);
    this.tokenCache.set(providerSymbol, info.scripcode);
    return info.scripcode;
  }

  private async fetchOne(
    ref: SymbolRef,
    session: { isOpen: boolean; todayIstDate: string },
  ): Promise<SymbolResult> {
    const fail = (reason: SymbolFailure["reason"]): SymbolResult => ({ ok: false, failure: { symbol: ref.symbol, reason } });

    try {
      const bars = await withTimeout(this.fetchBars(ref.providerSymbol), PER_SYMBOL_TIMEOUT_MS);
      const result = normalizeDailyBars(ref, bars, new Date(), session);
      return result.ok ? { ok: true, quote: result.quote } : { ok: false, failure: result.failure };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("No symbol info found")) {
        return fail("NOT_FOUND");
      }
      if (message.includes("timed out")) {
        return fail("TIMEOUT");
      }
      return fail("HTTP_ERROR");
    }
  }

  private async fetchBars(providerSymbol: string): Promise<DailyBar[]> {
    const token = await this.resolveToken(providerSymbol);
    const end = new Date();
    const start = new Date(end.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const response = await this.nse.getEquityChartHistoricalData(providerSymbol, { start, end }, token, "Equity", "D");
    return response?.data ?? [];
  }

  private async mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < items.length) {
        const current = nextIndex++;
        results[current] = await fn(items[current]);
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }
}

export const nseLiveSource: MarketSource = new NseLiveMarketSource();
