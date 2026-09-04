// GET /api/watchlist - the canonical ordered list for the caller's owner.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { handleRoute, jsonResponse } from "@/lib/http";
import { getWatchlist } from "@/lib/watchlist";

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);
    const items = await getWatchlist(db, ownerId);
    return jsonResponse({ items });
  });
}
