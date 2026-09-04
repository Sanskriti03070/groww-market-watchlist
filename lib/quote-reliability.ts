// Pure classification of a quote's reliability, given only when it was
// fetched, the current instant, and a read of the trading-session calendar
// (see lib/nse-session-calendar.ts). No I/O, no persistence, no price
// fields - reliability is derived here and only here, never stored.

import type { Instant } from "@/lib/market-quote";
import type { SessionSnapshot } from "@/lib/nse-session-calendar";

export type Reliability = "LIVE" | "STALE" | "LAST_CLOSE" | "UNAVAILABLE_NO_DATA" | "UNAVAILABLE_TOO_OLD";

export const FRESHNESS_CONFIG = {
  refreshIntervalMs: 60_000,
  freshWindowMs: 2 * 60_000,
  staleLimitMs: 900_000,
  closeCaptureWindowMs: 2 * 60_000,
} as const;

export function resolveReliability(input: {
  fetchedAt: Instant | null;
  now: Instant;
  session: SessionSnapshot;
}): Reliability {
  const { fetchedAt, now, session } = input;

  if (fetchedAt === null) {
    return "UNAVAILABLE_NO_DATA";
  }
  if (session.state === "OPEN") {
    return resolveOpenReliability(fetchedAt, now, session);
  }
  return resolveClosedMarketReliability(fetchedAt, session.lastCompleted);
}

function resolveOpenReliability(fetchedAt: Instant, now: Instant, session: SessionSnapshot): Reliability {
  const { freshWindowMs, staleLimitMs, closeCaptureWindowMs } = FRESHNESS_CONFIG;

  // Warm-up: just after today's open, the poller may not have refreshed
  // yet, so a capture still sitting near the *previous* session's close is
  // reported as LAST_CLOSE rather than run through the live-age formula
  // below, which would otherwise call it wildly stale on age alone.
  if (
    session.currentOpen !== null &&
    session.lastCompleted !== null &&
    now.getTime() - session.currentOpen.getTime() <= freshWindowMs &&
    fetchedAt.getTime() < session.currentOpen.getTime() &&
    fetchedAt.getTime() >= session.lastCompleted.close.getTime() - closeCaptureWindowMs
  ) {
    return "LAST_CLOSE";
  }

  const age = Math.max(0, now.getTime() - fetchedAt.getTime());
  if (age <= freshWindowMs) {
    return "LIVE";
  }
  if (age <= staleLimitMs) {
    return "STALE";
  }
  return "UNAVAILABLE_TOO_OLD";
}

function resolveClosedMarketReliability(
  fetchedAt: Instant,
  lastCompleted: SessionSnapshot["lastCompleted"],
): Reliability {
  if (lastCompleted === null) {
    return "UNAVAILABLE_TOO_OLD";
  }
  if (fetchedAt.getTime() >= lastCompleted.close.getTime() - FRESHNESS_CONFIG.closeCaptureWindowMs) {
    return "LAST_CLOSE";
  }
  if (fetchedAt.getTime() >= lastCompleted.open.getTime()) {
    return "STALE";
  }
  return "UNAVAILABLE_TOO_OLD";
}
