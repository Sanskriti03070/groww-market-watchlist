// The locked D presentation copy for one alert - shared by the collapsed
// card and the details view so both always agree. Every value here comes
// from AlertView/Quote fields already provided by the backend; nothing is
// computed beyond formatting.

import { formatPercent, formatPrice, formatSignedPercent } from "./format";
import type { AlertDirection, AlertView, Quote } from "./api";

export type AlertCopyParts = { prefix: string; target: string; suffix: string };

/** Card/headline copy - present tense while watching, past tense once it has actually crossed. The target is split out so callers can style it distinctly. */
export function alertCopyParts(alert: AlertView): AlertCopyParts {
  const triggered = alert.presentation === "TRIGGERED";

  if (alert.conditionType === "PRICE_LEVEL") {
    const target = formatPrice(alert.thresholdValue);
    if (alert.direction === "ABOVE") {
      return triggered ? { prefix: "Crossed ", target, suffix: "" } : { prefix: "Price crosses ", target, suffix: "" };
    }
    return triggered ? { prefix: "Fell below ", target, suffix: "" } : { prefix: "Price falls below ", target, suffix: "" };
  }

  const target = `${Number(alert.thresholdValue)}%`;
  if (alert.direction === "UP") {
    return triggered
      ? { prefix: "Rose by ", target, suffix: " from current price" }
      : { prefix: "Rises by ", target, suffix: " from current price" };
  }
  return triggered
    ? { prefix: "Fell by ", target, suffix: " from current price" }
    : { prefix: "Falls by ", target, suffix: " from current price" };
}

/** "Current: ₹X" or "Today: +X%" - only shown when the symbol's current quote is actually known (i.e. it's still on the watchlist and has been fetched at least once). Never fabricated. */
export function currentValueLabel(alert: AlertView, quote: Quote | undefined): string | null {
  if (!quote) {
    return null;
  }
  if (alert.conditionType === "PRICE_LEVEL") {
    return quote.lastPrice === null ? null : `Current: ${formatPrice(quote.lastPrice)}`;
  }
  return quote.changePercent === null ? null : `Today: ${formatSignedPercent(quote.changePercent)}`;
}

/**
 * "How far from the target" for the details view - independent of
 * AlertView.distancePercent, which is gated to the near-target highlight's
 * own eligibility rules (ACTIVE + LIVE + pre-trigger side; see
 * lib/alerts/highlight.ts) and must stay that way. This is purely
 * descriptive current-market context, computed straight from the already-
 * fetched threshold and quote - never a second fetch, never a client value
 * treated as authoritative.
 *
 * Only ever shown for a trustworthy quote (LIVE or LAST_CLOSE): STALE or
 * unavailable data returns null so the UI never states a precise distance
 * from a price that may no longer reflect the market.
 */
export function distanceToTarget(alert: AlertView, quote: Quote | undefined): { text: string; percent: number } | null {
  if (!quote || (quote.reliability !== "LIVE" && quote.reliability !== "LAST_CLOSE")) {
    return null;
  }

  if (alert.conditionType === "PRICE_LEVEL") {
    if (quote.lastPrice === null) {
      return null;
    }
    const current = Number(quote.lastPrice);
    const target = Number(alert.thresholdValue);
    if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(target)) {
      return null;
    }
    const absolute = Math.abs(target - current);
    const percent = (absolute / current) * 100;
    return { text: `${formatPrice(absolute)} (${formatPercent(percent, 2)})`, percent };
  }

  if (quote.changePercent === null) {
    return null;
  }
  const target = Number(alert.thresholdValue);
  const percent = Math.abs(target - Math.abs(quote.changePercent));
  return { text: formatPercent(percent, 2), percent };
}

export const DIRECTION_LABEL: Record<AlertDirection, string> = {
  ABOVE: "Rises above",
  BELOW: "Falls below",
  UP: "Moves up",
  DOWN: "Moves down",
};

export const PRESENTATION_LABEL: Record<AlertView["presentation"], string> = {
  ACTIVE: "Active",
  HIGHLIGHTED: "Near target",
  TRIGGERED: "Triggered",
  DISABLED: "Disabled",
  NOT_EVALUATING: "Not evaluating",
};
