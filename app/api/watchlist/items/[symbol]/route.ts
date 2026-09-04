// DELETE /api/watchlist/items/:symbol - remove a symbol. Idempotent:
// removing a symbol that isn't present (or an ill-formed path segment,
// which by construction can't be a member) is a no-op.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { handleRoute, jsonResponse } from "@/lib/http";
import { isValidSymbolFormat } from "@/lib/validation";
import { getWatchlist, removeSymbolFromWatchlist } from "@/lib/watchlist";

export async function DELETE(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);
    const { symbol: rawSymbol } = await context.params;
    const symbol = decodeURIComponent(rawSymbol);

    if (!isValidSymbolFormat(symbol)) {
      const items = await getWatchlist(db, ownerId);
      return jsonResponse({ items });
    }

    const items = await removeSymbolFromWatchlist(db, ownerId, symbol);
    return jsonResponse({ items });
  });
}
