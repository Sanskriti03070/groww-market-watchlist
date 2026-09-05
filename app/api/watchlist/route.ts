// GET /api/watchlist - the canonical ordered list for the caller's owner,
// with each symbol's latest market state and since-last-check comparison
// attached. Market data is always present in shape (HTTP 200 either way) -
// degradation shows up as reliability, never as a failed request.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { handleRoute, jsonResponse } from "@/lib/http";
import { getDatabaseNow, getWatchlistWithQuotes } from "@/lib/db/quotes-repo";
import { getSessionSnapshot, istCalendarDateOf } from "@/lib/nse-session-calendar";
import { resolveReliability } from "@/lib/quote-reliability";
import { canAdvanceBaseline, evaluateSinceLastCheck, type SinceLastCheckState } from "@/lib/since-last-check";
import { issueObservationToken } from "@/lib/observation-token";

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function changePercentOf(lastPrice: string, previousClose: string): number | null {
  const last = Number(lastPrice);
  const prev = Number(previousClose);
  if (prev === 0) {
    return null;
  }
  return round2(((last - prev) / prev) * 100);
}

function toSinceLastCheckResponse(state: SinceLastCheckState) {
  switch (state.kind) {
    case "MEANINGFUL":
      return {
        kind: state.kind,
        direction: state.direction,
        deltaPercent: round2(state.deltaPercent),
        baselinePrice: state.baselinePrice,
        thresholdPercent: round2(state.thresholdPercent),
      };
    case "BELOW_THRESHOLD":
      return { kind: state.kind, deltaPercent: round2(state.deltaPercent), baselinePrice: state.baselinePrice };
    case "NOT_COMPARABLE":
      return { kind: state.kind, reason: state.reason };
    default:
      return { kind: state.kind };
  }
}

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const now = await getDatabaseNow(db);
    const session = getSessionSnapshot(now);
    const rows = await getWatchlistWithQuotes(db, ownerId);

    const items = rows.map((row) => {
      const reliability = resolveReliability({ fetchedAt: row.quote?.fetchedAt ?? null, now, session });

      const sinceLastCheck = evaluateSinceLastCheck(
        {
          reliability,
          // Unreachable-but-safe fallbacks: evaluateSinceLastCheck only
          // reads these once reliability is trustworthy, which requires a
          // real quote (see resolveReliability's fetchedAt:null -> UNAVAILABLE_NO_DATA).
          lastPrice: row.quote ? Number(row.quote.lastPrice) : 0,
          dayHigh: row.quote?.dayHigh != null ? Number(row.quote.dayHigh) : null,
          dayLow: row.quote?.dayLow != null ? Number(row.quote.dayLow) : null,
          previousClose: row.quote?.previousClose != null ? Number(row.quote.previousClose) : null,
          fetchedAt: row.quote?.fetchedAt ?? new Date(0),
        },
        row.observation
          ? {
              price: Number(row.observation.baselinePrice),
              observedAt: row.observation.observedAt,
              quoteFetchedAt: row.observation.quoteFetchedAt,
              sessionDate: row.observation.sessionDate,
            }
          : null,
      );

      const observationToken =
        row.quote && canAdvanceBaseline(sinceLastCheck)
          ? issueObservationToken({
              ownerId,
              symbol: row.symbol,
              quoteFetchedAt: row.quote.fetchedAt,
              sessionDate: istCalendarDateOf(row.quote.fetchedAt),
              issuedAt: now,
            })
          : undefined;

      return {
        symbol: row.symbol,
        position: row.position,
        addedAt: row.addedAt.toISOString(),
        quote: {
          lastPrice: row.quote?.lastPrice ?? null,
          previousClose: row.quote?.previousClose ?? null,
          dayOpen: row.quote?.dayOpen ?? null,
          dayHigh: row.quote?.dayHigh ?? null,
          dayLow: row.quote?.dayLow ?? null,
          weekHigh52: row.quote?.weekHigh52 ?? null,
          weekLow52: row.quote?.weekLow52 ?? null,
          volume: row.quote?.volume ?? null,
          fetchedAt: row.quote?.fetchedAt?.toISOString() ?? null,
          changePercent: row.quote ? changePercentOf(row.quote.lastPrice, row.quote.previousClose) : null,
          reliability,
        },
        sinceLastCheck: toSinceLastCheckResponse(sinceLastCheck),
        observationToken,
      };
    });

    const response = jsonResponse({
      items,
      marketContext: { session: session.state, now: now.toISOString() },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
