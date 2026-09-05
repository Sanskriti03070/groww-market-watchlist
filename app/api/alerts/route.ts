// GET /api/alerts - the caller's alerts, with derived presentation
// (ACTIVE/HIGHLIGHTED/TRIGGERED/DISABLED/NOT_EVALUATING), filtered and
// sorted per the locked read model. Never fetches from the market provider
// - only reads already-persisted quotes (see lib/market/refresh-service.ts
// for the only place a live fetch happens).
//
// POST /api/alerts - creates an alert. Seeds from the current trustworthy
// quote without ever triggering immediately (docs/ENGINEERING_DECISIONS.md
// #11).

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import {
  AppError,
  alertSymbolInactiveError,
  invalidAlertThresholdError,
  ownerAlertCapExceededError,
  symbolAlertCapExceededError,
  symbolNotOnWatchlistError,
} from "@/lib/errors";
import { handleRoute, jsonResponse, readJsonBody } from "@/lib/http";
import {
  buildAlertView,
  buildAlertViews,
  createAlertBodySchema,
  currentTrustworthyQuote,
  filterAlertViews,
  parseAlertFilter,
  parseAlertSort,
  sortAlertViews,
} from "@/lib/alerts/api";
import { createAlert, listAlerts, MAX_ALERTS_PER_OWNER, MAX_ALERTS_PER_SYMBOL, type CreateAlertError } from "@/lib/alerts/service";

function throwForCreateError(error: CreateAlertError, symbol: string): never {
  switch (error) {
    case "SYMBOL_NOT_ON_WATCHLIST":
      throw symbolNotOnWatchlistError(symbol);
    case "SYMBOL_INACTIVE":
      throw alertSymbolInactiveError(symbol);
    case "SYMBOL_CAP_EXCEEDED":
      throw symbolAlertCapExceededError(MAX_ALERTS_PER_SYMBOL);
    case "OWNER_CAP_EXCEEDED":
      throw ownerAlertCapExceededError(MAX_ALERTS_PER_OWNER);
    case "INVALID_THRESHOLD":
      throw invalidAlertThresholdError();
  }
}

export async function GET(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const sort = parseAlertSort(request.nextUrl.searchParams.get("sort"));
    const filter = parseAlertFilter(request.nextUrl.searchParams.get("filter"));
    if (sort === null || filter === null) {
      throw new AppError(422, "invalid_query", "Unrecognized sort or filter value.");
    }

    const alerts = await listAlerts(db, ownerId);
    const views = sortAlertViews(filterAlertViews(await buildAlertViews(db, alerts), filter), sort);

    const response = jsonResponse({ alerts: views });
    response.headers.set("Cache-Control", "no-store");
    return response;
  });
}

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const parsed = createAlertBodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new AppError(422, "invalid_body", "Expected a valid alert configuration.");
    }
    const body = parsed.data;

    const currentQuote = await currentTrustworthyQuote(db, body.symbol);
    const result = await createAlert(db, {
      ownerId,
      symbol: body.symbol,
      conditionType: body.conditionType,
      direction: body.direction,
      thresholdValue: body.thresholdValue,
      currentQuote,
    });

    if (!result.ok) {
      throwForCreateError(result.error, body.symbol);
    }

    const alert = await buildAlertView(db, result.alert);
    return jsonResponse({ alert }, 201);
  });
}
