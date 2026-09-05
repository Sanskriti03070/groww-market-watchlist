// D4's read-model + request-validation layer: turns persisted AlertRow/
// AlertTriggerRow data into the locked user-facing view (derived
// presentation, distance-to-target, sort/filter), and validates request
// bodies/params for app/api/alerts/*. No SQL here (see lib/alerts/repo.ts)
// - callers pass in already-fetched quote/trigger/symbol-status data.

import { z } from "zod";
import type { Database } from "@/db/types";
import type { AlertRow, AlertTriggerRow } from "@/lib/alerts/repo";
import type { ConditionType, Direction } from "@/lib/alerts/evaluate";
import { distancePercentIfEligible, isHighlighted } from "@/lib/alerts/highlight";
import { getDatabaseNow, getQuotesForSymbols } from "@/lib/db/quotes-repo";
import * as repo from "@/lib/alerts/repo";
import { changePercentOf, type Instant } from "@/lib/market-quote";
import { getSessionSnapshot } from "@/lib/nse-session-calendar";
import { resolveReliability, type Reliability } from "@/lib/quote-reliability";
import { isTrustworthy } from "@/lib/since-last-check";
import { isValidSymbolFormat } from "@/lib/validation";
import type { TrustworthyQuoteSnapshot } from "@/lib/alerts/service";

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

const symbolSchema = z.string().refine(isValidSymbolFormat, "Not a recognized symbol format.");
const conditionTypeSchema = z.enum(["PRICE_LEVEL", "DAY_MOVE"]);
const directionSchema = z.enum(["ABOVE", "BELOW", "UP", "DOWN"]);
const thresholdValueSchema = z.number().finite().positive();

export const createAlertBodySchema = z.object({
  symbol: symbolSchema,
  conditionType: conditionTypeSchema,
  direction: directionSchema,
  thresholdValue: thresholdValueSchema,
});
export type CreateAlertBody = z.infer<typeof createAlertBodySchema>;

export const editAlertBodySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  thresholdValue: thresholdValueSchema,
  direction: directionSchema,
});
export type EditAlertBody = z.infer<typeof editAlertBodySchema>;

export const alertIdParamSchema = z.uuid();

export const ALERT_SORTS = ["attention", "nearest", "recentlyTriggered", "recentlyCreated"] as const;
export type AlertSort = (typeof ALERT_SORTS)[number];
const alertSortSchema = z.enum(ALERT_SORTS);

export const ALERT_FILTERS = ["all", "active", "nearTarget", "triggered"] as const;
export type AlertFilter = (typeof ALERT_FILTERS)[number];
const alertFilterSchema = z.enum(ALERT_FILTERS);

export function parseAlertSort(raw: string | null): AlertSort | null {
  const result = alertSortSchema.safeParse(raw ?? "attention");
  return result.success ? result.data : null;
}

export function parseAlertFilter(raw: string | null): AlertFilter | null {
  const result = alertFilterSchema.safeParse(raw ?? "all");
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// The locked user-facing alert view
// ---------------------------------------------------------------------------

export type AlertPresentation = "ACTIVE" | "HIGHLIGHTED" | "TRIGGERED" | "DISABLED" | "NOT_EVALUATING";

export type AlertView = {
  id: string;
  symbol: string;
  conditionType: ConditionType;
  direction: Direction;
  thresholdValue: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  presentation: AlertPresentation;
  distancePercent: number | null;
  lastTriggeredAt: string | null;
  hasUnacknowledgedTrigger: boolean;
};

/** The live quote context needed for presentation, or null when no quote exists at all for the symbol. Full precision throughout - never the display-rounded figures. */
export type PresentationQuote = {
  reliability: Reliability;
  lastPrice: number;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  previousClose: number | null;
};

function derivePresentation(
  alert: Pick<AlertRow, "state" | "conditionType" | "direction" | "thresholdValue">,
  isSymbolActive: boolean,
  quote: PresentationQuote | null,
): AlertPresentation {
  if (alert.state === "DISABLED") {
    return "DISABLED";
  }
  if (!isSymbolActive) {
    return "NOT_EVALUATING";
  }
  if (alert.state === "TRIGGERED") {
    return "TRIGGERED";
  }
  if (quote !== null && isHighlighted({ alertState: alert.state, thresholdValue: Number(alert.thresholdValue), conditionType: alert.conditionType, direction: alert.direction, ...quote })) {
    return "HIGHLIGHTED";
  }
  return "ACTIVE";
}

export function toAlertView(
  alert: AlertRow,
  context: { isSymbolActive: boolean; quote: PresentationQuote | null; latestTrigger: AlertTriggerRow | null },
): AlertView {
  return {
    id: alert.id,
    symbol: alert.symbol,
    conditionType: alert.conditionType,
    direction: alert.direction,
    thresholdValue: alert.thresholdValue,
    version: alert.version,
    createdAt: alert.createdAt.toISOString(),
    updatedAt: alert.updatedAt.toISOString(),
    presentation: derivePresentation(alert, context.isSymbolActive, context.quote),
    distancePercent:
      context.quote === null
        ? null
        : distancePercentIfEligible({
            alertState: alert.state,
            conditionType: alert.conditionType,
            direction: alert.direction,
            thresholdValue: Number(alert.thresholdValue),
            ...context.quote,
          }),
    lastTriggeredAt: context.latestTrigger?.triggeredAt.toISOString() ?? null,
    hasUnacknowledgedTrigger: alert.state === "TRIGGERED",
  };
}

// ---------------------------------------------------------------------------
// Filtering and sorting
// ---------------------------------------------------------------------------

export function filterAlertViews(views: AlertView[], filter: AlertFilter): AlertView[] {
  switch (filter) {
    case "active":
      return views.filter((v) => v.presentation === "ACTIVE" || v.presentation === "HIGHLIGHTED");
    case "nearTarget":
      return views.filter((v) => v.presentation === "HIGHLIGHTED");
    case "triggered":
      return views.filter((v) => v.hasUnacknowledgedTrigger);
    case "all":
    default:
      return views;
  }
}

function byIdAsc(a: AlertView, b: AlertView): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareNullsLastAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/** ISO timestamps compare lexicographically the same as chronologically. */
function compareTimestampNullsLastDesc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : a > b ? -1 : 0;
}

// Attention's own bucket order: recently triggered, then near target, then
// plain active, then frozen (inactive-symbol), then explicitly disabled.
const ATTENTION_RANK: Record<AlertPresentation, number> = {
  TRIGGERED: 0,
  HIGHLIGHTED: 1,
  ACTIVE: 2,
  NOT_EVALUATING: 3,
  DISABLED: 4,
};

export function sortAlertViews(views: AlertView[], sort: AlertSort): AlertView[] {
  const sorted = [...views];
  switch (sort) {
    case "nearest":
      sorted.sort((a, b) => compareNullsLastAsc(a.distancePercent, b.distancePercent) || byIdAsc(a, b));
      break;
    case "recentlyTriggered":
      sorted.sort((a, b) => compareTimestampNullsLastDesc(a.lastTriggeredAt, b.lastTriggeredAt) || byIdAsc(a, b));
      break;
    case "recentlyCreated":
      sorted.sort((a, b) => compareTimestampNullsLastDesc(a.createdAt, b.createdAt) || byIdAsc(a, b));
      break;
    case "attention":
    default:
      sorted.sort((a, b) => {
        const rank = ATTENTION_RANK[a.presentation] - ATTENTION_RANK[b.presentation];
        if (rank !== 0) return rank;
        if (a.presentation === "TRIGGERED") {
          return compareTimestampNullsLastDesc(a.lastTriggeredAt, b.lastTriggeredAt) || byIdAsc(a, b);
        }
        if (a.presentation === "HIGHLIGHTED" || a.presentation === "ACTIVE") {
          return compareNullsLastAsc(a.distancePercent, b.distancePercent) || byIdAsc(a, b);
        }
        return compareTimestampNullsLastDesc(a.createdAt, b.createdAt) || byIdAsc(a, b);
      });
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Quote/reliability lookup for the API layer (DB reads only - never a live
// provider fetch; see lib/market/refresh-service.ts for the only place that
// happens).
// ---------------------------------------------------------------------------

export function toPresentationQuote(
  quote: { lastPrice: string; previousClose: string; dayHigh: string | null; dayLow: string | null; fetchedAt: Instant } | undefined,
  now: Instant,
  session: ReturnType<typeof getSessionSnapshot>,
): PresentationQuote | null {
  if (!quote) {
    return null;
  }
  return {
    reliability: resolveReliability({ fetchedAt: quote.fetchedAt, now, session }),
    lastPrice: Number(quote.lastPrice),
    changePercent: changePercentOf(quote.lastPrice, quote.previousClose),
    dayHigh: quote.dayHigh === null ? null : Number(quote.dayHigh),
    dayLow: quote.dayLow === null ? null : Number(quote.dayLow),
    previousClose: Number(quote.previousClose),
  };
}

/** The current trustworthy quote for one symbol, for seeding on create/edit/enable - null if unavailable or untrustworthy. Never used as evaluation truth, only as a one-time seed (see lib/alerts/service.ts). */
export async function currentTrustworthyQuote(db: Database, symbol: string): Promise<TrustworthyQuoteSnapshot | null> {
  const now = await getDatabaseNow(db);
  const session = getSessionSnapshot(now);
  const quotes = await getQuotesForSymbols(db, [symbol]);
  const quote = quotes.get(symbol);
  if (!quote) {
    return null;
  }
  const reliability = resolveReliability({ fetchedAt: quote.fetchedAt, now, session });
  if (!isTrustworthy(reliability)) {
    return null;
  }
  return { lastPrice: Number(quote.lastPrice), changePercent: changePercentOf(quote.lastPrice, quote.previousClose), fetchedAt: quote.fetchedAt };
}

/** Builds every AlertView for one owner's alerts in a handful of batched reads - never one query per alert. Used by GET /api/alerts and by app/api/watchlist/route.ts's alert integration. */
export async function buildAlertViews(db: Database, alertRows: AlertRow[]): Promise<AlertView[]> {
  if (alertRows.length === 0) {
    return [];
  }
  const symbols = [...new Set(alertRows.map((a) => a.symbol))];
  const now = await getDatabaseNow(db);
  const session = getSessionSnapshot(now);

  const [quotes, activeStatuses, latestTriggers] = await Promise.all([
    getQuotesForSymbols(db, symbols),
    repo.getSymbolActiveStatuses(db, symbols),
    repo.getLatestTriggersForAlerts(
      db,
      alertRows.map((a) => a.id),
    ),
  ]);

  return alertRows.map((alert) =>
    toAlertView(alert, {
      isSymbolActive: activeStatuses.get(alert.symbol) ?? false,
      quote: toPresentationQuote(quotes.get(alert.symbol), now, session),
      latestTrigger: latestTriggers.get(alert.id) ?? null,
    }),
  );
}

/** The single-alert form of buildAlertViews, for the mutation endpoints' responses. */
export async function buildAlertView(db: Database, alert: AlertRow): Promise<AlertView> {
  const [view] = await buildAlertViews(db, [alert]);
  return view;
}
