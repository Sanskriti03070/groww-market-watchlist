// Triggers one market-data refresh cycle. Called by Vercel Cron (see
// vercel.json) - not part of the public product surface, but not behind
// owner auth either, since it has nothing to do with a specific owner.
// Protected by CRON_SECRET when one is configured.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { hasCompletedCycleSince } from "@/lib/db/quotes-repo";
import { refreshMarketData } from "@/lib/market/refresh-service";
import { regularSessionCloseFor } from "@/lib/nse-session-calendar";
import { handleRoute, jsonResponse } from "@/lib/http";
import { AppError } from "@/lib/errors";

const POST_CLOSE_WINDOW_MS = 5 * 60_000;

function requireCronAuth(request: NextRequest): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return; // not configured (e.g. local dev) - nothing to check against
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    throw new AppError(401, "unauthorized", "Invalid cron credential.");
  }
}

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    requireCronAuth(request);

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
