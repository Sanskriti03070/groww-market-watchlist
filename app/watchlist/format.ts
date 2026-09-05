// Shared, presentation-only formatting. Every value consumed here is
// already computed by the server (price, changePercent, reliability,
// distancePercent, ...) - nothing in this file derives market or alert
// truth, it only renders it.

export function formatPrice(value: string | number | null): string {
  if (value === null) {
    return "—";
  }
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) {
    return "—";
  }
  return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatSignedPercent(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const sign = value > 0 ? "+" : value < 0 ? "" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** The absolute ₹ move (lastPrice - previousClose) as small supporting text next to Day% - e.g. "+₹12.40". Simple display arithmetic over two already-fetched fields, not a derived market judgement. */
export function formatSignedPriceChange(lastPrice: string | null, previousClose: string | null): string {
  if (lastPrice === null || previousClose === null) {
    return "—";
  }
  const last = Number(lastPrice);
  const prev = Number(previousClose);
  if (!Number.isFinite(last) || !Number.isFinite(prev)) {
    return "—";
  }
  const diff = last - prev;
  const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  return `${sign}${formatPrice(Math.abs(diff))}`;
}

/** 2.4M / 845K / 12.6K style compaction. Null stays null - never coerced to 0, since a missing volume is a data-availability fact, not a real zero. */
export function formatVolume(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  if (value >= 1_000_000) {
    return `${round1(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${round1(value / 1_000)}K`;
  }
  return String(Math.round(value));
}

function round1(value: number): string {
  return (Math.round(value * 10) / 10).toString();
}

export type MovementTone = "up" | "down" | "flat";

export function movementTone(changePercent: number | null): MovementTone {
  if (changePercent === null || changePercent === 0) {
    return "flat";
  }
  return changePercent > 0 ? "up" : "down";
}

/** Compact "time ago" - seconds/minutes/hours/days, never more precise than the reader needs. */
export function formatRelativeTime(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now.getTime() - then);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export type Reliability = "LIVE" | "STALE" | "LAST_CLOSE" | "UNAVAILABLE_NO_DATA" | "UNAVAILABLE_TOO_OLD";

export type Freshness = { text: string; tone: "live" | "muted" | "stale" | "unavailable" };

/**
 * The locked, honest freshness copy - never a fixed "delayed by 15 minutes"
 * claim, since staleness is a real, variable condition, not a fixed policy.
 */
export function freshnessLabel(reliability: Reliability, fetchedAt: string | null, now: Date): Freshness {
  if (fetchedAt === null || reliability === "UNAVAILABLE_NO_DATA" || reliability === "UNAVAILABLE_TOO_OLD") {
    return { text: "Price unavailable", tone: "unavailable" };
  }
  const updated = formatRelativeTime(fetchedAt, now);
  if (reliability === "LIVE") {
    return { text: `Live · Updated ${updated}`, tone: "live" };
  }
  if (reliability === "LAST_CLOSE") {
    return { text: `Market closed · Updated ${updated}`, tone: "muted" };
  }
  return { text: `Stale · Updated ${updated}`, tone: "stale" };
}
