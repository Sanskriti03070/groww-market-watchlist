// POST /api/alerts/:id/enable - re-seeds from the current trustworthy quote
// and returns the alert to ACTIVE, without ever triggering immediately.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { alertNotFoundError } from "@/lib/errors";
import { handleRoute, jsonResponse } from "@/lib/http";
import { alertIdParamSchema, buildAlertView, currentTrustworthyQuote } from "@/lib/alerts/api";
import { enableAlert, getAlert } from "@/lib/alerts/service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const { id: rawId } = await context.params;
    const parsedId = alertIdParamSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw alertNotFoundError();
    }
    const id = parsedId.data;

    const existing = await getAlert(db, ownerId, id);
    if (!existing) {
      throw alertNotFoundError();
    }
    const currentQuote = await currentTrustworthyQuote(db, existing.symbol);

    const result = await enableAlert(db, ownerId, id, currentQuote);
    if (!result.ok) {
      throw alertNotFoundError();
    }

    return jsonResponse({ alert: await buildAlertView(db, result.alert) });
  });
}
