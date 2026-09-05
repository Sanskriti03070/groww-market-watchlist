// Pure normalization/validation of raw daily OHLC bars into a
// NormalizedQuote or a SymbolFailure. No network, no provider client - this
// only shapes and sanity-checks data already fetched by an adapter, which
// is what makes it possible to unit test without hitting NSE.

import { istCalendarDateOf } from "@/lib/nse-session-calendar";
import type { Instant, NormalizedQuote, SymbolErrorCode, SymbolFailure, SymbolRef } from "@/lib/market/source";

/** Structurally identical to stock-nse-india's ChartingOHLCItem, kept local so this module doesn't depend on the provider package. */
export type DailyBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time: number;
};

export type SessionContext = {
  isOpen: boolean;
  todayIstDate: string;
};

export type NormalizeResult = { ok: true; quote: NormalizedQuote } | { ok: false; failure: SymbolFailure };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isUsableBar(bar: DailyBar | undefined): bar is DailyBar {
  return (
    bar !== undefined &&
    isFiniteNumber(bar.open) &&
    isFiniteNumber(bar.high) &&
    isFiniteNumber(bar.low) &&
    isFiniteNumber(bar.close) &&
    isFiniteNumber(bar.volume) &&
    isFiniteNumber(bar.time) &&
    bar.close > 0
  );
}

function fail(symbol: string, reason: SymbolErrorCode): NormalizeResult {
  return { ok: false, failure: { symbol, reason } };
}

export function normalizeDailyBars(
  ref: SymbolRef,
  bars: DailyBar[],
  now: Instant,
  session: SessionContext,
): NormalizeResult {
  if (bars.length < 2) {
    // Not enough history to derive a previous close - never fabricate one.
    return fail(ref.symbol, "INCOMPLETE");
  }

  const latest = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  if (!isUsableBar(latest) || !isUsableBar(previous)) {
    return fail(ref.symbol, "MALFORMED");
  }

  const providerTs = new Date(latest.time);

  if (session.isOpen && istCalendarDateOf(providerTs) !== session.todayIstDate) {
    // The market is open but the latest candle is from an earlier session -
    // the refresh cycle hasn't caught up yet. Never present a stale candle
    // as today's live data.
    return fail(ref.symbol, "INCOMPLETE");
  }

  // A high/low that doesn't actually bound the close is a data
  // inconsistency in that one field, not a reason to discard the quote.
  const dayHigh = latest.high >= latest.close ? latest.high.toString() : null;
  const dayLow = latest.low <= latest.close ? latest.low.toString() : null;

  return {
    ok: true,
    quote: {
      symbol: ref.symbol,
      lastPrice: latest.close.toString(),
      previousClose: previous.close.toString(),
      dayOpen: latest.open.toString(),
      dayHigh,
      dayLow,
      weekHigh52: null,
      weekLow52: null,
      volume: BigInt(Math.trunc(latest.volume)),
      providerTs,
      fetchedAt: now,
    },
  };
}
