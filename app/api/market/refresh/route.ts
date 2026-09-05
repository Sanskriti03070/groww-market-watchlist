// Triggers one market-data refresh cycle. Invoked only by external
// schedulers (cron-job.org ~every minute during market hours, GitHub
// Actions ~every 5 minutes as a fallback) - not part of the public product
// surface and not behind owner auth. It is protected by a single shared
// secret, MARKET_REFRESH_SECRET, sent as `Authorization: Bearer <secret>`.
// The existing database refresh lease is what actually prevents overlapping
// cycles when both schedulers fire close together.

import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { hasCompletedCycleSince } from "@/lib/db/quotes-repo";
import { refreshMarketData } from "@/lib/market/refresh-service";
import { regularSessionCloseFor } from "@/lib/nse-session-calendar";
import { handleRoute, jsonResponse } from "@/lib/http";
import { AppError } from "@/lib/errors";

// One refresh cycle gives the provider up to 20s (lib/market/nse-live-source.ts's
// CYCLE_DEADLINE_MS) before the transaction even opens; Vercel Hobby's
// default 10s function limit would kill it mid-cycle, leaving the lease
// held and no quotes written. This opts into the 60s Hobby ceiling.
export const maxDuration = 60;

const POST_CLOSE_WINDOW_MS = 5 * 60_000;

/** Constant-time secret comparison, independent of length (both sides are SHA-256'd to a fixed 32 bytes first). */
function secretsMatch(provided: string, expected: string): boolean {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

/**
 * The only gate on this endpoint. Fails closed: with no MARKET_REFRESH_SECRET
 * configured, nothing can authenticate. The secret is read solely from the
 * Authorization header - never a query parameter, never a cookie - and is
 * never written to a log line or a response body.
 */
function requireRefreshAuth(request: NextRequest): void {
  const expected = process.env.MARKET_REFRESH_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const provided = /^Bearer\s+(.+)$/i.exec(header.trim())?.[1].trim();

  if (!expected || !provided || !secretsMatch(provided, expected)) {
    throw new AppError(401, "unauthorized", "A valid refresh credential is required.");
  }
}

async function handleRefresh(request: NextRequest) {
  return handleRoute(async () => {
    requireRefreshAuth(request);

    const db = getDb();
    const mode = request.nextUrl.searchParams.get("mode");

    if (mode === "postClose") {
      const now = new Date();
      const regularClose = regularSessionCloseFor(now);
      const windowEnd = new Date(regularClose.getTime() + POST_CLOSE_WINDOW_MS);
      if (now < regularClose || now > windowEnd) {
        console.log(JSON.stringify({ event: "market_refresh_post_close_outside_window" }));
        return jsonResponse({ ran: false, reason: "outside_post_close_window" });
      }
      if (await hasCompletedCycleSince(db, regularClose)) {
        console.log(JSON.stringify({ event: "market_refresh_post_close_already_captured" }));
        return jsonResponse({ ran: false, reason: "already_captured" });
      }
    }

    const result = await refreshMarketData(db);
    return jsonResponse(result);
  });
}

// GET is the original contract; POST is accepted too so either scheduler can
// use whichever verb it defaults to. Same handler, same auth, same behavior.
export function GET(request: NextRequest) {
  return handleRefresh(request);
}

export function POST(request: NextRequest) {
  return handleRefresh(request);
}
