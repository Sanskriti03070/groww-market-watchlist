// POST /api/watchlist/items - add a symbol. Idempotent: adding a symbol
// already on the watchlist is a no-op that returns the canonical list.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handleRoute, jsonResponse, readJsonBody } from "@/lib/http";
import { parseAddItemBody } from "@/lib/validation";
import { addSymbolToWatchlist } from "@/lib/watchlist";

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const body = parseAddItemBody(await readJsonBody(request));
    if (!body) {
      throw new AppError(422, "invalid_body", 'Expected a JSON body shaped { "symbol": string }.');
    }

    const items = await addSymbolToWatchlist(db, ownerId, body.symbol);
    return jsonResponse({ items });
  });
}
