// Pure since-last-check evaluation: is the current quote meaningfully
// different from the baseline the owner last acknowledged? No I/O, no
// clock reads - every instant this needs is passed in.

import type { Instant } from "@/lib/market-quote";
import type { Reliability } from "@/lib/quote-reliability";

const MIN_THRESHOLD_PERCENT = 0.5;
const MAX_THRESHOLD_PERCENT = 3.0;
const FALLBACK_THRESHOLD_PERCENT = 1.0;
const RANGE_THRESHOLD_FACTOR = 0.25;

/** The one shared rule for what counts as trustworthy enough to establish or advance a baseline. */
export function isTrustworthy(reliability: Reliability): boolean {
  return reliability === "LIVE" || reliability === "LAST_CLOSE";
}

export type ObservationBaseline = {
  price: number;
  observedAt: Instant;
  quoteFetchedAt: Instant;
  sessionDate: string;
};

// BELOW_THRESHOLD carries thresholdPercent for the same reason MEANINGFUL
// does: the UI explains *why* a movement was or wasn't judged meaningful,
// and that explanation needs the actual per-stock adaptive threshold this
// module already computed - never a value re-derived in the frontend.
export type SinceLastCheckState =
  | { kind: "NO_BASELINE" }
  | { kind: "NOT_COMPARABLE"; reason: "CURRENT_UNTRUSTWORTHY" }
  | { kind: "UNCHANGED_SESSION" }
  | { kind: "BELOW_THRESHOLD"; deltaPercent: number; baselinePrice: number; thresholdPercent: number }
  | { kind: "MEANINGFUL"; direction: "UP" | "DOWN"; deltaPercent: number; baselinePrice: number; thresholdPercent: number };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

type MeaningfulChangeInput = {
  currentPrice: number;
  baselinePrice: number;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
};

type MeaningfulChangeResult = {
  meaningful: boolean;
  deltaPercent: number;
  thresholdPercent: number;
  direction: "UP" | "DOWN";
};

/** The locked meaningful-change rule. Full precision throughout - callers round only for display. */
export function computeMeaningfulChange(input: MeaningfulChangeInput): MeaningfulChangeResult {
  const { currentPrice, baselinePrice, dayHigh, dayLow, previousClose } = input;

  // baseline <= 0 can't happen given the DB CHECK constraint, but this stays
  // a total function rather than assuming that from the outside.
  if (!isFiniteNumber(currentPrice) || !isFiniteNumber(baselinePrice) || baselinePrice <= 0) {
    return { meaningful: false, deltaPercent: 0, thresholdPercent: FALLBACK_THRESHOLD_PERCENT, direction: "UP" };
  }

  const deltaPercent = ((currentPrice - baselinePrice) / baselinePrice) * 100;
  const direction: "UP" | "DOWN" = currentPrice >= baselinePrice ? "UP" : "DOWN";

  let thresholdPercent = FALLBACK_THRESHOLD_PERCENT;
  if (isFiniteNumber(dayHigh) && isFiniteNumber(dayLow) && isFiniteNumber(previousClose)) {
    const dayRange = dayHigh - dayLow;
    if (dayRange > 0) {
      const rangePercent = (dayRange / previousClose) * 100;
      if (isFiniteNumber(rangePercent)) {
        thresholdPercent = clamp(RANGE_THRESHOLD_FACTOR * rangePercent, MIN_THRESHOLD_PERCENT, MAX_THRESHOLD_PERCENT);
      }
    }
  }

  return { meaningful: Math.abs(deltaPercent) >= thresholdPercent, deltaPercent, thresholdPercent, direction };
}

export type CurrentQuoteForComparison = {
  reliability: Reliability;
  lastPrice: number;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
  fetchedAt: Instant;
};

/**
 * Observation identity is quoteFetchedAt, not wall-clock time: if the
 * current quote isn't strictly newer than the baseline's, nothing new has
 * been observed since the baseline was set (e.g. a repeat visit during a
 * closed market, where LAST_CLOSE sits at the same fetched_at all day).
 */
export function evaluateSinceLastCheck(
  current: CurrentQuoteForComparison,
  baseline: ObservationBaseline | null,
): SinceLastCheckState {
  // Trustworthiness is checked before baseline existence: untrustworthy
  // data can't establish "first view" of anything either, so it must never
  // present as NO_BASELINE - only as NOT_COMPARABLE, baseline or not.
  if (!isTrustworthy(current.reliability)) {
    return { kind: "NOT_COMPARABLE", reason: "CURRENT_UNTRUSTWORTHY" };
  }
  if (baseline === null) {
    return { kind: "NO_BASELINE" };
  }
  if (current.fetchedAt.getTime() <= baseline.quoteFetchedAt.getTime()) {
    return { kind: "UNCHANGED_SESSION" };
  }

  const change = computeMeaningfulChange({
    currentPrice: current.lastPrice,
    baselinePrice: baseline.price,
    dayHigh: current.dayHigh,
    dayLow: current.dayLow,
    previousClose: current.previousClose,
  });

  if (change.meaningful) {
    return {
      kind: "MEANINGFUL",
      direction: change.direction,
      deltaPercent: change.deltaPercent,
      baselinePrice: baseline.price,
      thresholdPercent: change.thresholdPercent,
    };
  }
  return {
    kind: "BELOW_THRESHOLD",
    deltaPercent: change.deltaPercent,
    baselinePrice: baseline.price,
    thresholdPercent: change.thresholdPercent,
  };
}

/** Whether an acknowledgement of the current quote could validly move the baseline forward. */
export function canAdvanceBaseline(state: SinceLastCheckState): boolean {
  return state.kind === "NO_BASELINE" || state.kind === "MEANINGFUL" || state.kind === "BELOW_THRESHOLD";
}
