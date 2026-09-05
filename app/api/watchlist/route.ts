// GET /api/watchlist - the canonical ordered list for the caller's owner,
// with each symbol's latest market state attached. Market data is always
// present in shape (HTTP 200 either way) - degradation shows up as
// reliability, never as a failed request.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { handleRoute, jsonResponse } from "@/lib/http";
import { getDatabaseNow, getWatchlistWithQuotes } from "@/lib/db/quotes-repo";
import { getSessionSnapshot } from "@/lib/nse-session-calendar";
import { resolveReliability } from "@/lib/quote-reliability";

function changePercentOf(lastPrice: string, previousClose: string): number | null {
  const last = Number(lastPrice);
  const prev = Number(previousClose);
  if (prev === 0) {
    return null;
  }
  return Math.round(((last - prev) / prev) * 10_000) / 100; // 2 decimal places
}

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const now = await getDatabaseNow(db);
    const session = getSessionSnapshot(now);
    const rows = await getWatchlistWithQuotes(db, ownerId);

    const items = rows.map((row) => ({
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
        reliability: resolveReliability({ fetchedAt: row.quote?.fetchedAt ?? null, now, session }),
      },
    }));

    const response = jsonResponse({
      items,
      marketContext: { session: session.state, now: now.toISOString() },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}
