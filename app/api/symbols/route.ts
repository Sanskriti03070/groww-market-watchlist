// GET /api/symbols - the fixed symbol universe. There is no search endpoint;
// this is the whole (seeded, reference) list every time.

import { asc } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { symbols } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { handleRoute, jsonResponse } from "@/lib/http";

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    await requireOwner(db, request);

    const rows = await db
      .select({
        symbol: symbols.symbol,
        name: symbols.name,
        kind: symbols.kind,
        isActive: symbols.isActive,
      })
      .from(symbols)
      .orderBy(asc(symbols.symbol));

    return jsonResponse({ symbols: rows });
  });
}
