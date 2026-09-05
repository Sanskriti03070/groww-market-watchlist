// POST /api/alerts/:id/disable - freezes the alert: state -> DISABLED,
// last_side/last_evaluated_quote_at left untouched. Evaluation will skip it.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { alertNotFoundError } from "@/lib/errors";
import { handleRoute, jsonResponse } from "@/lib/http";
import { alertIdParamSchema, buildAlertView } from "@/lib/alerts/api";
import { disableAlert } from "@/lib/alerts/service";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const { id: rawId } = await context.params;
    const parsedId = alertIdParamSchema.safeParse(rawId);
    if (!parsedId.success) {
      throw alertNotFoundError();
    }

    const result = await disableAlert(db, ownerId, parsedId.data);
    if (!result.ok) {
      throw alertNotFoundError();
    }

    return jsonResponse({ alert: await buildAlertView(db, result.alert) });
  });
}
