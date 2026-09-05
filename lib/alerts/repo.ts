// SQL only - no business rules (caps, seeding, cross-field validation live
// in lib/alerts/service.ts). Mirrors the read/write split already used in
// lib/db/quotes-repo.ts and lib/db/observations-repo.ts.

import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/types";
import { alerts, alertTriggers, symbols as symbolsTable } from "@/db/schema";
import type { AlertState, ConditionType, Direction, Side } from "@/lib/alerts/evaluate";
import type { Instant } from "@/lib/market-quote";

export type AlertRow = {
  id: string;
  ownerId: string;
  symbol: string;
  conditionType: ConditionType;
  direction: Direction;
  thresholdValue: string;
  state: AlertState;
  lastSide: Side | null;
  lastEvaluatedQuoteAt: Instant | null;
  version: number;
  createdAt: Instant;
  updatedAt: Instant;
};

export type AlertTriggerRow = {
  id: string;
  alertId: string;
  ownerId: string;
  symbol: string;
  triggeredAt: Instant;
  quoteFetchedAt: Instant;
  observedPrice: string;
  thresholdValue: string;
  conditionType: ConditionType;
  direction: Direction;
  previousSide: Side;
  newSide: Side;
  dayChangePercent: string | null;
  acknowledgedAt: Instant | null;
};

const ALERT_COLUMNS = {
  id: alerts.id,
  ownerId: alerts.ownerId,
  symbol: alerts.symbol,
  conditionType: alerts.conditionType,
  direction: alerts.direction,
  thresholdValue: alerts.thresholdValue,
  state: alerts.state,
  lastSide: alerts.lastSide,
  lastEvaluatedQuoteAt: alerts.lastEvaluatedQuoteAt,
  version: alerts.version,
  createdAt: alerts.createdAt,
  updatedAt: alerts.updatedAt,
};

// Drizzle types a `smallint` column as plain `number`; the DB CHECK
// constraints guarantee these are always exactly -1 or 1, so rows read back
// are narrowed to `Side` here, once, rather than at every call site.
type RawAlertRow = Omit<AlertRow, "lastSide"> & { lastSide: number | null };
type RawAlertTriggerRow = Omit<AlertTriggerRow, "previousSide" | "newSide"> & { previousSide: number; newSide: number };

function toAlertRow(row: RawAlertRow): AlertRow {
  return { ...row, lastSide: row.lastSide as Side | null };
}

function toAlertTriggerRow(row: RawAlertTriggerRow): AlertTriggerRow {
  return { ...row, previousSide: row.previousSide as Side, newSide: row.newSide as Side };
}

const TRIGGER_COLUMNS = {
  id: alertTriggers.id,
  alertId: alertTriggers.alertId,
  ownerId: alertTriggers.ownerId,
  symbol: alertTriggers.symbol,
  triggeredAt: alertTriggers.triggeredAt,
  quoteFetchedAt: alertTriggers.quoteFetchedAt,
  observedPrice: alertTriggers.observedPrice,
  thresholdValue: alertTriggers.thresholdValue,
  conditionType: alertTriggers.conditionType,
  direction: alertTriggers.direction,
  previousSide: alertTriggers.previousSide,
  newSide: alertTriggers.newSide,
  dayChangePercent: alertTriggers.dayChangePercent,
  acknowledgedAt: alertTriggers.acknowledgedAt,
};

export async function insertAlert(
  db: Database,
  input: {
    id: string;
    ownerId: string;
    symbol: string;
    conditionType: ConditionType;
    direction: Direction;
    thresholdValue: string;
    lastSide: Side | null;
    lastEvaluatedQuoteAt: Instant | null;
    now: Instant;
  },
): Promise<AlertRow> {
  const [row] = await db
    .insert(alerts)
    .values({
      id: input.id,
      ownerId: input.ownerId,
      symbol: input.symbol,
      conditionType: input.conditionType,
      direction: input.direction,
      thresholdValue: input.thresholdValue,
      state: "ACTIVE",
      lastSide: input.lastSide,
      lastEvaluatedQuoteAt: input.lastEvaluatedQuoteAt,
      version: 0,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning(ALERT_COLUMNS);
  return toAlertRow(row);
}

export async function getAlertById(db: Database, ownerId: string, id: string): Promise<AlertRow | null> {
  const [row] = await db
    .select(ALERT_COLUMNS)
    .from(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.ownerId, ownerId)));
  return row ? toAlertRow(row) : null;
}

export async function listAlertsByOwner(db: Database, ownerId: string): Promise<AlertRow[]> {
  const rows = await db.select(ALERT_COLUMNS).from(alerts).where(eq(alerts.ownerId, ownerId)).orderBy(desc(alerts.createdAt));
  return rows.map(toAlertRow);
}

/**
 * D3's write-side evaluation set: every non-disabled alert on any of the
 * given symbols, locked FOR UPDATE for the duration of the refresh cycle's
 * write transaction so evaluation can't race a concurrent edit/enable/
 * disable/dismiss on the same alert row. Symbols are pre-filtered by the
 * caller to those just successfully refreshed - this makes no freshness
 * decisions of its own.
 */
export async function listEvaluableAlertsForSymbols(db: Database, symbols: string[]): Promise<AlertRow[]> {
  if (symbols.length === 0) {
    return [];
  }
  const rows = await db
    .select(ALERT_COLUMNS)
    .from(alerts)
    .where(and(inArray(alerts.symbol, symbols), ne(alerts.state, "DISABLED")))
    .for("update");
  return rows.map(toAlertRow);
}

export async function countAlertsForSymbol(db: Database, ownerId: string, symbol: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alerts)
    .where(and(eq(alerts.ownerId, ownerId), eq(alerts.symbol, symbol)));
  return row?.count ?? 0;
}

export async function countAlertsForOwner(db: Database, ownerId: string): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(alerts).where(eq(alerts.ownerId, ownerId));
  return row?.count ?? 0;
}

/** Optimistic-concurrency edit: threshold/direction, re-armed to ACTIVE with a freshly seeded side. Returns null on a version mismatch (or if the alert doesn't belong to this owner). */
export async function updateAlertWithVersion(
  db: Database,
  input: {
    id: string;
    ownerId: string;
    expectedVersion: number;
    thresholdValue: string;
    direction: Direction;
    lastSide: Side | null;
    lastEvaluatedQuoteAt: Instant | null;
    now: Instant;
  },
): Promise<AlertRow | null> {
  const [row] = await db
    .update(alerts)
    .set({
      thresholdValue: input.thresholdValue,
      direction: input.direction,
      state: "ACTIVE",
      lastSide: input.lastSide,
      lastEvaluatedQuoteAt: input.lastEvaluatedQuoteAt,
      version: sql`${alerts.version} + 1`,
      updatedAt: input.now,
    })
    .where(and(eq(alerts.id, input.id), eq(alerts.ownerId, input.ownerId), eq(alerts.version, input.expectedVersion)))
    .returning(ALERT_COLUMNS);
  return row ? toAlertRow(row) : null;
}

export async function enableAlert(
  db: Database,
  input: { id: string; ownerId: string; lastSide: Side | null; lastEvaluatedQuoteAt: Instant | null; now: Instant },
): Promise<AlertRow | null> {
  const [row] = await db
    .update(alerts)
    .set({ state: "ACTIVE", lastSide: input.lastSide, lastEvaluatedQuoteAt: input.lastEvaluatedQuoteAt, updatedAt: input.now })
    .where(and(eq(alerts.id, input.id), eq(alerts.ownerId, input.ownerId)))
    .returning(ALERT_COLUMNS);
  return row ? toAlertRow(row) : null;
}

/** last_side/last_evaluated_quote_at are left untouched - evaluation will skip a disabled alert regardless. */
export async function disableAlert(db: Database, ownerId: string, id: string, now: Instant): Promise<AlertRow | null> {
  const [row] = await db
    .update(alerts)
    .set({ state: "DISABLED", updatedAt: now })
    .where(and(eq(alerts.id, id), eq(alerts.ownerId, ownerId)))
    .returning(ALERT_COLUMNS);
  return row ? toAlertRow(row) : null;
}

/** Dismiss's state-only reset: no threshold/direction/side change, no version bump - just clearing the "unacknowledged trigger" marker. */
export async function reactivateAfterDismiss(db: Database, ownerId: string, id: string, now: Instant): Promise<AlertRow | null> {
  const [row] = await db
    .update(alerts)
    .set({ state: "ACTIVE", updatedAt: now })
    .where(and(eq(alerts.id, id), eq(alerts.ownerId, ownerId)))
    .returning(ALERT_COLUMNS);
  return row ? toAlertRow(row) : null;
}

/** Symbol-lifecycle integration: watchlist removal disables (never deletes) every non-disabled alert on that symbol, so trigger history and the owner's alert intent survive a later re-add. See lib/watchlist.ts. */
export async function disableAlertsForSymbol(db: Database, ownerId: string, symbol: string, now: Instant): Promise<void> {
  await db
    .update(alerts)
    .set({ state: "DISABLED", updatedAt: now })
    .where(and(eq(alerts.ownerId, ownerId), eq(alerts.symbol, symbol), ne(alerts.state, "DISABLED")));
}

export async function deleteAlert(db: Database, ownerId: string, id: string): Promise<boolean> {
  const result = await db
    .delete(alerts)
    .where(and(eq(alerts.id, id), eq(alerts.ownerId, ownerId)))
    .returning({ id: alerts.id });
  return result.length > 0;
}

/** Advances the alert's recorded side after a non-triggering evaluation (establishing from null, or re-arming). */
export async function recordSideChange(
  db: Database,
  input: { id: string; newSide: Side; quoteFetchedAt: Instant; now: Instant },
): Promise<void> {
  await db
    .update(alerts)
    .set({ lastSide: input.newSide, lastEvaluatedQuoteAt: input.quoteFetchedAt, updatedAt: input.now })
    .where(eq(alerts.id, input.id));
}

/** Advances the recorded side to TRIGGERED state after a genuine crossing. Pair with insertAlertTriggerIfNew in the same transaction. */
export async function markAlertTriggered(
  db: Database,
  input: { id: string; newSide: Side; quoteFetchedAt: Instant; now: Instant },
): Promise<void> {
  await db
    .update(alerts)
    .set({ state: "TRIGGERED", lastSide: input.newSide, lastEvaluatedQuoteAt: input.quoteFetchedAt, updatedAt: input.now })
    .where(eq(alerts.id, input.id));
}

/** Idempotent: a duplicate (alert_id, quote_fetched_at) is a harmless no-op (returns null), not an error - this is what makes "at most one trigger per crossing" a DB guarantee. */
export async function insertAlertTriggerIfNew(
  db: Database,
  input: {
    id: string;
    alertId: string;
    ownerId: string;
    symbol: string;
    triggeredAt: Instant;
    quoteFetchedAt: Instant;
    observedPrice: string;
    thresholdValue: string;
    conditionType: ConditionType;
    direction: Direction;
    previousSide: Side;
    newSide: Side;
    dayChangePercent: string | null;
  },
): Promise<AlertTriggerRow | null> {
  const [row] = await db
    .insert(alertTriggers)
    .values(input)
    .onConflictDoNothing({ target: [alertTriggers.alertId, alertTriggers.quoteFetchedAt] })
    .returning(TRIGGER_COLUMNS);
  return row ? toAlertTriggerRow(row) : null;
}

export async function listTriggersByAlert(db: Database, ownerId: string, alertId: string): Promise<AlertTriggerRow[]> {
  const rows = await db
    .select(TRIGGER_COLUMNS)
    .from(alertTriggers)
    .where(and(eq(alertTriggers.alertId, alertId), eq(alertTriggers.ownerId, ownerId)))
    .orderBy(desc(alertTriggers.triggeredAt));
  return rows.map(toAlertTriggerRow);
}

export async function listTriggersByOwner(db: Database, ownerId: string): Promise<AlertTriggerRow[]> {
  const rows = await db
    .select(TRIGGER_COLUMNS)
    .from(alertTriggers)
    .where(eq(alertTriggers.ownerId, ownerId))
    .orderBy(desc(alertTriggers.triggeredAt));
  return rows.map(toAlertTriggerRow);
}

export async function getLatestTrigger(db: Database, ownerId: string, alertId: string): Promise<AlertTriggerRow | null> {
  const [row] = await db
    .select(TRIGGER_COLUMNS)
    .from(alertTriggers)
    .where(and(eq(alertTriggers.alertId, alertId), eq(alertTriggers.ownerId, ownerId)))
    .orderBy(desc(alertTriggers.triggeredAt))
    .limit(1);
  return row ? toAlertTriggerRow(row) : null;
}

/** No-op if already acknowledged - dismiss is idempotent. */
export async function acknowledgeTrigger(db: Database, id: string, now: Instant): Promise<void> {
  await db.update(alertTriggers).set({ acknowledgedAt: now }).where(eq(alertTriggers.id, id));
}

/**
 * The most recent trigger per alert (one row each, not full history) -
 * used for read-model presentation (D4): "recently triggered" sorting and
 * the trigger timestamp shown alongside a TRIGGERED alert. Full trigger
 * history stays available via listTriggersByAlert/listTriggersByOwner.
 */
export async function getLatestTriggersForAlerts(db: Database, alertIds: string[]): Promise<Map<string, AlertTriggerRow>> {
  if (alertIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([alertTriggers.alertId], TRIGGER_COLUMNS)
    .from(alertTriggers)
    .where(inArray(alertTriggers.alertId, alertIds))
    .orderBy(alertTriggers.alertId, desc(alertTriggers.triggeredAt));
  return new Map(rows.map((row) => [row.alertId, toAlertTriggerRow(row)]));
}

/** D4 read-model support: whether each of the given symbols is currently active, for the NOT_EVALUATING presentation state. */
export async function getSymbolActiveStatuses(db: Database, symbolList: string[]): Promise<Map<string, boolean>> {
  if (symbolList.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ symbol: symbolsTable.symbol, isActive: symbolsTable.isActive })
    .from(symbolsTable)
    .where(inArray(symbolsTable.symbol, symbolList));
  return new Map(rows.map((row) => [row.symbol, row.isActive]));
}
