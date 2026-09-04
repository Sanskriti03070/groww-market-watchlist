// PUT /api/watchlist/order - replace the whole order with a permutation of
// current membership. Stale membership (a symbol added/removed since the
// client last fetched) -> 409, no change made.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handleRoute, jsonResponse, readJsonBody } from "@/lib/http";
import { parseOrderBody } from "@/lib/validation";
import { reorderWatchlist } from "@/lib/watchlist";

export async function PUT(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const body = parseOrderBody(await readJsonBody(request));
    if (!body) {
      throw new AppError(
        422,
        "invalid_body",
        'Expected a JSON body shaped { "symbols": string[] } with no duplicates.',
      );
    }

    const items = await reorderWatchlist(db, ownerId, body.symbols);
    return jsonResponse({ items });
  });
}
