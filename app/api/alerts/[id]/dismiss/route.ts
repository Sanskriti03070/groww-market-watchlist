// POST /api/alerts/:id/dismiss - acknowledges the latest unacknowledged
// trigger (if any) and returns the alert to ACTIVE. Idempotent: succeeds
// the same way whether or not there was anything to acknowledge. Trigger
// history is retained either way.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { alertNotFoundError } from "@/lib/errors";
import { handleRoute, jsonResponse } from "@/lib/http";
import { alertIdParamSchema, buildAlertView } from "@/lib/alerts/api";
import { dismissAlert } from "@/lib/alerts/service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const { id: rawId } = await context.params;
    const parsedId = alertIdParamSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw alertNotFoundError();
    }

    const result = await dismissAlert(db, ownerId, parsedId.data);
    if (!result.ok) {
      throw alertNotFoundError();
    }

    return jsonResponse({ alert: await buildAlertView(db, result.alert) });
  });
}
