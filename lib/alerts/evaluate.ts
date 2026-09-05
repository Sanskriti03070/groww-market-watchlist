// Pure alert evaluation: given an alert's persisted state and one quote
// observation, what happens? No clock, no DB, no provider, no I/O - every
// value this needs is passed in, and the same inputs always produce the
// same outcome.
//
// A crossing is a transition, not a property of one quote: -1 means the
// configured side is not currently satisfied, +1 means it is. Only a
// transition FROM -1 INTO +1 is a trigger; everything else either changes
// the recorded side without triggering, or produces no change at all.

import type { Instant } from "@/lib/market-quote";
import type { Reliability } from "@/lib/quote-reliability";
import { isTrustworthy } from "@/lib/since-last-check";

export type ConditionType = "PRICE_LEVEL" | "DAY_MOVE";
export type Direction = "ABOVE" | "BELOW" | "UP" | "DOWN";
export type AlertState = "ACTIVE" | "TRIGGERED" | "DISABLED";
export type Side = -1 | 1;

export const MAX_DAY_MOVE_THRESHOLD_PERCENT = 50;

export type AlertForEvaluation = {
  conditionType: ConditionType;
  direction: Direction;
  thresholdValue: number;
  state: AlertState;
  lastSide: Side | null;
  lastEvaluatedQuoteAt: Instant | null;
};

export type QuoteForEvaluation = {
  lastPrice: number;
  /** Slice C's existing derived day-change figure - never recomputed here. */
  changePercent: number | null;
  fetchedAt: Instant;
};

export type SkipReason = "DISABLED" | "UNTRUSTWORTHY" | "ALREADY_EVALUATED" | "MISSING_DATA";

export type EvaluationOutcome =
  | { kind: "SKIPPED"; reason: SkipReason }
  | { kind: "NO_CHANGE"; side: Side }
  | { kind: "SIDE_CHANGED"; previousSide: Side | null; newSide: Side }
  | { kind: "TRIGGERED"; previousSide: Side; newSide: Side };

/**
 * Which side of the configured condition the quote currently falls on.
 * `null` means the condition can't be evaluated from this quote at all
 * (DAY_MOVE with no usable previous-close-derived change percent) - this is
 * distinct from "not satisfied" and must never be treated as -1.
 */
export function deriveSide(
  alert: Pick<AlertForEvaluation, "conditionType" | "direction" | "thresholdValue">,
  quote: Pick<QuoteForEvaluation, "lastPrice" | "changePercent">,
): Side | null {
  if (alert.conditionType === "PRICE_LEVEL") {
    const satisfied =
      alert.direction === "ABOVE" ? quote.lastPrice >= alert.thresholdValue : quote.lastPrice <= alert.thresholdValue;
    return satisfied ? 1 : -1;
  }

  // DAY_MOVE: threshold is a magnitude; direction picks which sign it applies to.
  if (quote.changePercent === null || !Number.isFinite(quote.changePercent)) {
    return null;
  }
  const satisfied =
    alert.direction === "UP" ? quote.changePercent >= alert.thresholdValue : quote.changePercent <= -alert.thresholdValue;
  return satisfied ? 1 : -1;
}

export function evaluateAlert(
  alert: AlertForEvaluation,
  quote: QuoteForEvaluation,
  reliability: Reliability,
): EvaluationOutcome {
  if (alert.state === "DISABLED") {
    return { kind: "SKIPPED", reason: "DISABLED" };
  }
  if (!isTrustworthy(reliability)) {
    return { kind: "SKIPPED", reason: "UNTRUSTWORTHY" };
  }
  if (alert.lastEvaluatedQuoteAt !== null && quote.fetchedAt.getTime() <= alert.lastEvaluatedQuoteAt.getTime()) {
    return { kind: "SKIPPED", reason: "ALREADY_EVALUATED" };
  }

  const side = deriveSide(alert, quote);
  if (side === null) {
    return { kind: "SKIPPED", reason: "MISSING_DATA" };
  }

  if (alert.lastSide === null) {
    // First trustworthy evaluation: establish the side, never trigger.
    return { kind: "SIDE_CHANGED", previousSide: null, newSide: side };
  }
  if (alert.lastSide === side) {
    return { kind: "NO_CHANGE", side };
  }
  if (alert.lastSide === -1 && side === 1) {
    return { kind: "TRIGGERED", previousSide: -1, newSide: 1 };
  }
  // alert.lastSide === 1 && side === -1: re-arming, not a trigger.
  return { kind: "SIDE_CHANGED", previousSide: alert.lastSide, newSide: side };
}
