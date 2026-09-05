// Pure, read-time-only derivation of the HIGHLIGHTED presentation state
// (docs/ENGINEERING_DECISIONS.md #17-18). A highlight is never persisted -
// it is recomputed from the alert's current configuration and the symbol's
// current quote on every read. No I/O, no clock, no persistence, no
// hysteresis/debounce: the same inputs always produce the same answer.

import { deriveSide } from "@/lib/alerts/evaluate";
import type { AlertState, ConditionType, Direction } from "@/lib/alerts/evaluate";
import type { Reliability } from "@/lib/quote-reliability";

const MIN_PROXIMITY_BAND_PERCENT = 0.25;
const MAX_PROXIMITY_BAND_PERCENT = 2.0;
const PROXIMITY_BAND_FACTOR = 0.3;
const FALLBACK_PROXIMITY_BAND_PERCENT = 0.75;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export type HighlightInput = {
  alertState: AlertState;
  conditionType: ConditionType;
  direction: Direction;
  thresholdValue: number;
  reliability: Reliability;
  lastPrice: number;
  /** Full-precision day-change percent - see lib/market-quote.ts's changePercentOf. */
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
};

/** clamp(0.30 x dayRangePercent, 0.25%, 2.0%), or the 0.75% fallback when the day range can't be computed. */
function proximityBandPercent(dayHigh: number | null, dayLow: number | null, previousClose: number | null): number {
  if (dayHigh === null || dayLow === null || previousClose === null || previousClose <= 0) {
    return FALLBACK_PROXIMITY_BAND_PERCENT;
  }
  const dayRange = dayHigh - dayLow;
  if (!(dayRange >= 0)) {
    return FALLBACK_PROXIMITY_BAND_PERCENT;
  }
  const dayRangePercent = (dayRange / previousClose) * 100;
  if (!Number.isFinite(dayRangePercent)) {
    return FALLBACK_PROXIMITY_BAND_PERCENT;
  }
  return clamp(PROXIMITY_BAND_FACTOR * dayRangePercent, MIN_PROXIMITY_BAND_PERCENT, MAX_PROXIMITY_BAND_PERCENT);
}

/**
 * PRICE_LEVEL: |threshold - currentPrice| / currentPrice x 100.
 * DAY_MOVE: how many percentage points today's move still is from the
 * threshold magnitude - the same volatility-scaled proximity concept
 * applied to a percentage-based condition instead of a price level.
 * Returns null when the condition can't be evaluated at all (mirrors
 * deriveSide's null case), which is never "close" for highlight purposes.
 */
function distancePercentOf(input: HighlightInput): number | null {
  if (input.conditionType === "PRICE_LEVEL") {
    if (!(input.lastPrice > 0)) {
      return null;
    }
    return (Math.abs(input.thresholdValue - input.lastPrice) / input.lastPrice) * 100;
  }
  if (input.changePercent === null || !Number.isFinite(input.changePercent)) {
    return null;
  }
  return Math.abs(input.thresholdValue - Math.abs(input.changePercent));
}

/**
 * The alert's current distance from its threshold, or null when the
 * concept doesn't apply: not ACTIVE, not LIVE, already on/past the trigger
 * side, or (DAY_MOVE) no usable change percent. Recomputing the side from
 * the live quote (rather than trusting the alert's persisted last_side) is
 * what makes TRIGGERED and HIGHLIGHTED mutually exclusive: once the live
 * price actually crosses, this returns null regardless of when the
 * write-side evaluation catches up and flips the persisted state.
 * Exposed (not just isHighlighted's private concern) because the "Nearest"
 * read-model sort needs the same distance, nulls last.
 */
export function distancePercentIfEligible(input: HighlightInput): number | null {
  if (input.alertState !== "ACTIVE" || input.reliability !== "LIVE") {
    return null;
  }
  const side = deriveSide(input, { lastPrice: input.lastPrice, changePercent: input.changePercent });
  if (side !== -1) {
    return null;
  }
  return distancePercentOf(input);
}

/** HIGHLIGHTED iff eligible (see distancePercentIfEligible) and within the volatility-scaled proximity band. */
export function isHighlighted(input: HighlightInput): boolean {
  const distancePercent = distancePercentIfEligible(input);
  if (distancePercent === null) {
    return false;
  }
  return distancePercent <= proximityBandPercent(input.dayHigh, input.dayLow, input.previousClose);
}
