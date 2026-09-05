// PATCH /api/alerts/:id - edits threshold/direction with optimistic
// concurrency; reseeds from the current trustworthy quote and returns to
// ACTIVE without ever triggering immediately.
// DELETE /api/alerts/:id - removes the alert; its trigger history cascades
// via the alert_triggers.alert_id FK.
//
// A malformed or unowned id behaves identically to a real, absent one -
// both are just "not found".

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { AppError, alertNotFoundError, alertVersionConflictError, invalidAlertThresholdError } from "@/lib/errors";
import { handleRoute, jsonResponse, readJsonBody } from "@/lib/http";
import { alertIdParamSchema, buildAlertView, currentTrustworthyQuote, editAlertBodySchema } from "@/lib/alerts/api";
import { deleteAlert, editAlert, getAlert } from "@/lib/alerts/service";

async function requireAlertId(context: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await context.params;
  const parsed = alertIdParamSchema.safeParse(id);
  if (!parsed.success) {
    throw alertNotFoundError();
  }
  return parsed.data;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);
    const id = await requireAlertId(context);

    const parsed = editAlertBodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new AppError(422, "invalid_body", "Expected a valid { expectedVersion, thresholdValue, direction } body.");
    }
    const body = parsed.data;

    // The alert's own symbol (not client-supplied) drives the reseed quote.
    const existing = await getAlert(db, ownerId, id);
    if (!existing) {
      throw alertNotFoundError();
    }
    const currentQuote = await currentTrustworthyQuote(db, existing.symbol);

    const result = await editAlert(db, {
      ownerId,
      id,
      expectedVersion: body.expectedVersion,
      thresholdValue: body.thresholdValue,
      direction: body.direction,
      currentQuote,
    });

    if (!result.ok) {
      if (result.error === "ALERT_NOT_FOUND") throw alertNotFoundError();
      if (result.error === "VERSION_CONFLICT") throw alertVersionConflictError();
      throw invalidAlertThresholdError();
    }

    return jsonResponse({ alert: await buildAlertView(db, result.alert) });
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);
    const id = await requireAlertId(context);

    const result = await deleteAlert(db, ownerId, id);
    if (!result.ok) {
      throw alertNotFoundError();
    }
    return jsonResponse({ ok: true });
  });
}
