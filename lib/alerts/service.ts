// Business orchestration for alerts: ownership/watchlist-membership checks,
// creation/edit caps, side-seeding from the current trustworthy quote, and
// version-checked edits - all under the same owner-row-lock discipline
// lib/watchlist.ts uses, so alert mutations for one owner serialize the
// same way watchlist mutations do. No SQL here (see lib/alerts/repo.ts) and
// no market-data provider knowledge (see lib/alerts/evaluate.ts).
//
// Quote trustworthiness (LIVE/LAST_CLOSE vs STALE/UNAVAILABLE) is derived
// once, by the caller, the same way app/api/watchlist/route.ts already does
// for since-last-check (getDatabaseNow + getSessionSnapshot +
// resolveReliability) - see docs/ENGINEERING_DECISIONS.md #7. This module
// never re-derives it, so it stays free of wall-clock/session dependence
// and every seeding decision here is a pure function of its inputs.

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "@/db/types";
import { owners, symbols as symbolsTable, watchlistItems } from "@/db/schema";
import * as repo from "@/lib/alerts/repo";
import type { AlertRow, AlertTriggerRow } from "@/lib/alerts/repo";
import {
  deriveSide,
  evaluateAlert,
  MAX_DAY_MOVE_THRESHOLD_PERCENT,
  type ConditionType,
  type Direction,
  type EvaluationOutcome,
  type Side,
} from "@/lib/alerts/evaluate";
import { changePercentOf, type Decimal, type Instant } from "@/lib/market-quote";
import type { Reliability } from "@/lib/quote-reliability";

export const MAX_ALERTS_PER_SYMBOL = 5;
export const MAX_ALERTS_PER_OWNER = 50;
const MAX_PRICE_LEVEL_MULTIPLE_OF_CURRENT = 10;

/** The current quote snapshot, already established as trustworthy by the caller - null means no trustworthy quote is available. */
export type TrustworthyQuoteSnapshot = {
  lastPrice: number;
  /** Slice C's existing derived day-change figure, at full precision - never recomputed here. */
  changePercent: number | null;
  fetchedAt: Instant;
};

/** Serializes every alert mutation for this owner behind the same row lock lib/watchlist.ts uses. */
async function lockOwner(tx: Database, ownerId: string): Promise<void> {
  await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, ownerId)).for("update");
}

function isDirectionValidFor(conditionType: ConditionType, direction: Direction): boolean {
  return conditionType === "PRICE_LEVEL"
    ? direction === "ABOVE" || direction === "BELOW"
    : direction === "UP" || direction === "DOWN";
}

function isThresholdWithinBasicBounds(conditionType: ConditionType, thresholdValue: number): boolean {
  if (!Number.isFinite(thresholdValue) || thresholdValue <= 0) {
    return false;
  }
  return conditionType !== "DAY_MOVE" || thresholdValue <= MAX_DAY_MOVE_THRESHOLD_PERCENT;
}

/**
 * PRICE_LEVEL creation-only invariant: the target must actually be on the
 * not-yet-satisfied side of the current trustworthy price - ABOVE strictly
 * above it, BELOW strictly below it; equality is invalid either way. This
 * only constrains a fresh alert's initial configuration, so it never
 * conflicts with the general "seed from wherever the price already is,
 * never fire immediately" rule that edit/enable still rely on (docs
 * #11-12) - creation's seed simply always lands on the not-yet-satisfied
 * side (-1) once this passes. Skipped when no trustworthy quote exists yet
 * to validate against, same as the 10x extreme-value bound below.
 */
function isPriceLevelTargetOnCorrectSide(direction: Direction, thresholdValue: number, currentPrice: number): boolean {
  return direction === "ABOVE" ? thresholdValue > currentPrice : thresholdValue < currentPrice;
}

type SeedResult = { lastSide: Side | null; lastEvaluatedQuoteAt: Instant | null };

/**
 * Seeds/reseeds last_side from an already-resolved trustworthy quote, or
 * leaves it null if none is available - used identically by creation,
 * edit, and enable, none of which ever trigger immediately (see
 * docs/ENGINEERING_DECISIONS.md #11-12).
 */
function seedSide(
  currentQuote: TrustworthyQuoteSnapshot | null,
  conditionType: ConditionType,
  direction: Direction,
  thresholdValue: number,
): SeedResult {
  if (currentQuote === null) {
    return { lastSide: null, lastEvaluatedQuoteAt: null };
  }
  const side = deriveSide(
    { conditionType, direction, thresholdValue },
    { lastPrice: currentQuote.lastPrice, changePercent: currentQuote.changePercent },
  );
  // side === null only for DAY_MOVE with no usable change percent - same as
  // "no trustworthy quote" for seeding purposes: leave unseeded.
  return { lastSide: side, lastEvaluatedQuoteAt: side === null ? null : currentQuote.fetchedAt };
}

export type CreateAlertInput = {
  ownerId: string;
  symbol: string;
  conditionType: ConditionType;
  direction: Direction;
  thresholdValue: number;
  currentQuote: TrustworthyQuoteSnapshot | null;
};

export type CreateAlertError =
  | "INVALID_THRESHOLD"
  | "SYMBOL_NOT_ON_WATCHLIST"
  | "SYMBOL_INACTIVE"
  | "SYMBOL_CAP_EXCEEDED"
  | "OWNER_CAP_EXCEEDED";

export type CreateAlertResult = { ok: true; alert: AlertRow } | { ok: false; error: CreateAlertError };

/**
 * Creation order matches the locked rules: cheap/static validation first,
 * then the PRICE_LEVEL current-price checks (need currentQuote), then
 * ownership/membership, then caps, and only then the insert itself.
 */
export async function createAlert(db: Database, input: CreateAlertInput): Promise<CreateAlertResult> {
  if (!isDirectionValidFor(input.conditionType, input.direction)) {
    return { ok: false, error: "INVALID_THRESHOLD" };
  }
  if (!isThresholdWithinBasicBounds(input.conditionType, input.thresholdValue)) {
    return { ok: false, error: "INVALID_THRESHOLD" };
  }
  if (input.conditionType === "PRICE_LEVEL" && input.currentQuote !== null) {
    const currentPrice = input.currentQuote.lastPrice;
    if (!isPriceLevelTargetOnCorrectSide(input.direction, input.thresholdValue, currentPrice)) {
      return { ok: false, error: "INVALID_THRESHOLD" };
    }
    if (input.thresholdValue > currentPrice * MAX_PRICE_LEVEL_MULTIPLE_OF_CURRENT) {
      return { ok: false, error: "INVALID_THRESHOLD" };
    }
  }

  return db.transaction(async (tx) => {
    await lockOwner(tx, input.ownerId);

    const [membership] = await tx
      .select({ symbol: watchlistItems.symbol })
      .from(watchlistItems)
      .where(and(eq(watchlistItems.ownerId, input.ownerId), eq(watchlistItems.symbol, input.symbol)));
    if (!membership) {
      return { ok: false, error: "SYMBOL_NOT_ON_WATCHLIST" };
    }

    const [symbolRow] = await tx
      .select({ isActive: symbolsTable.isActive })
      .from(symbolsTable)
      .where(eq(symbolsTable.symbol, input.symbol));
    if (!symbolRow || !symbolRow.isActive) {
      return { ok: false, error: "SYMBOL_INACTIVE" };
    }

    // Sequential, not Promise.all: both queries run over the same
    // transaction connection, which processes one statement at a time
    // anyway - concurrent dispatch here would buy nothing.
    const symbolCount = await repo.countAlertsForSymbol(tx, input.ownerId, input.symbol);
    if (symbolCount >= MAX_ALERTS_PER_SYMBOL) {
      return { ok: false, error: "SYMBOL_CAP_EXCEEDED" };
    }
    const ownerCount = await repo.countAlertsForOwner(tx, input.ownerId);
    if (ownerCount >= MAX_ALERTS_PER_OWNER) {
      return { ok: false, error: "OWNER_CAP_EXCEEDED" };
    }

    const seed = seedSide(input.currentQuote, input.conditionType, input.direction, input.thresholdValue);
    const alert = await repo.insertAlert(tx, {
      id: randomUUID(),
      ownerId: input.ownerId,
      symbol: input.symbol,
      conditionType: input.conditionType,
      direction: input.direction,
      thresholdValue: input.thresholdValue.toFixed(4),
      lastSide: seed.lastSide,
      lastEvaluatedQuoteAt: seed.lastEvaluatedQuoteAt,
      now: new Date(),
    });
    return { ok: true, alert };
  });
}

export type EditAlertInput = {
  ownerId: string;
  id: string;
  expectedVersion: number;
  thresholdValue: number;
  direction: Direction;
  currentQuote: TrustworthyQuoteSnapshot | null;
};

export type EditAlertError = "ALERT_NOT_FOUND" | "INVALID_THRESHOLD" | "VERSION_CONFLICT";
export type EditAlertResult = { ok: true; alert: AlertRow } | { ok: false; error: EditAlertError };

/** Threshold and/or direction only - conditionType is fixed at creation. Re-seeds last_side; never triggers immediately (docs/ENGINEERING_DECISIONS.md #12). */
export async function editAlert(db: Database, input: EditAlertInput): Promise<EditAlertResult> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, input.ownerId);

    const existing = await repo.getAlertById(tx, input.ownerId, input.id);
    if (!existing) {
      return { ok: false, error: "ALERT_NOT_FOUND" };
    }
    if (!isDirectionValidFor(existing.conditionType, input.direction)) {
      return { ok: false, error: "INVALID_THRESHOLD" };
    }
    if (!isThresholdWithinBasicBounds(existing.conditionType, input.thresholdValue)) {
      return { ok: false, error: "INVALID_THRESHOLD" };
    }

    const seed = seedSide(input.currentQuote, existing.conditionType, input.direction, input.thresholdValue);
    const updated = await repo.updateAlertWithVersion(tx, {
      id: input.id,
      ownerId: input.ownerId,
      expectedVersion: input.expectedVersion,
      thresholdValue: input.thresholdValue.toFixed(4),
      direction: input.direction,
      lastSide: seed.lastSide,
      lastEvaluatedQuoteAt: seed.lastEvaluatedQuoteAt,
      now: new Date(),
    });
    if (!updated) {
      return { ok: false, error: "VERSION_CONFLICT" };
    }
    return { ok: true, alert: updated };
  });
}

export type EnableAlertResult = { ok: true; alert: AlertRow } | { ok: false; error: "ALERT_NOT_FOUND" };

/** Re-seeds last_side from an already-resolved trustworthy quote, same as edit; never triggers immediately. */
export async function enableAlert(
  db: Database,
  ownerId: string,
  id: string,
  currentQuote: TrustworthyQuoteSnapshot | null,
): Promise<EnableAlertResult> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const existing = await repo.getAlertById(tx, ownerId, id);
    if (!existing) {
      return { ok: false, error: "ALERT_NOT_FOUND" };
    }

    const seed = seedSide(currentQuote, existing.conditionType, existing.direction, Number(existing.thresholdValue));
    const updated = await repo.enableAlert(tx, {
      id,
      ownerId,
      lastSide: seed.lastSide,
      lastEvaluatedQuoteAt: seed.lastEvaluatedQuoteAt,
      now: new Date(),
    });
    return updated ? { ok: true, alert: updated } : { ok: false, error: "ALERT_NOT_FOUND" };
  });
}

export type DisableAlertResult = { ok: true; alert: AlertRow } | { ok: false; error: "ALERT_NOT_FOUND" };

/** last_side/last_evaluated_quote_at are left frozen - evaluation skips a DISABLED alert regardless. */
export async function disableAlert(db: Database, ownerId: string, id: string): Promise<DisableAlertResult> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const updated = await repo.disableAlert(tx, ownerId, id, new Date());
    return updated ? { ok: true, alert: updated } : { ok: false, error: "ALERT_NOT_FOUND" };
  });
}

export type DismissAlertResult = { ok: true; alert: AlertRow } | { ok: false; error: "ALERT_NOT_FOUND" };

/** Idempotent: acknowledges the latest unacknowledged trigger (if any) and returns the alert to ACTIVE either way. Trigger history is retained. */
export async function dismissAlert(db: Database, ownerId: string, id: string): Promise<DismissAlertResult> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const existing = await repo.getAlertById(tx, ownerId, id);
    if (!existing) {
      return { ok: false, error: "ALERT_NOT_FOUND" };
    }

    const now = new Date();
    const latestTrigger = await repo.getLatestTrigger(tx, ownerId, id);
    if (latestTrigger && latestTrigger.acknowledgedAt === null) {
      await repo.acknowledgeTrigger(tx, latestTrigger.id, now);
    }

    const updated = await repo.reactivateAfterDismiss(tx, ownerId, id, now);
    return updated ? { ok: true, alert: updated } : { ok: false, error: "ALERT_NOT_FOUND" };
  });
}

export type DeleteAlertResult = { ok: true } | { ok: false; error: "ALERT_NOT_FOUND" };

/** Trigger rows cascade via the alert_triggers.alert_id FK - nothing else to clean up here. */
export async function deleteAlert(db: Database, ownerId: string, id: string): Promise<DeleteAlertResult> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const deleted = await repo.deleteAlert(tx, ownerId, id);
    return deleted ? { ok: true } : { ok: false, error: "ALERT_NOT_FOUND" };
  });
}

export async function listAlerts(db: Database, ownerId: string): Promise<AlertRow[]> {
  return repo.listAlertsByOwner(db, ownerId);
}

export async function getAlert(db: Database, ownerId: string, id: string): Promise<AlertRow | null> {
  return repo.getAlertById(db, ownerId, id);
}

export async function listAlertTriggers(db: Database, ownerId: string, alertId: string): Promise<AlertTriggerRow[]> {
  return repo.listTriggersByAlert(db, ownerId, alertId);
}

export type ApplyEvaluationOutcomeInput = {
  alertId: string;
  ownerId: string;
  symbol: string;
  conditionType: ConditionType;
  direction: Direction;
  thresholdValue: string;
  outcome: EvaluationOutcome;
  quoteFetchedAt: Instant;
  observedPrice: string;
  dayChangePercent: string | null;
  now: Instant;
};

/**
 * Applies one evaluateAlert() outcome atomically: SKIPPED/NO_CHANGE persist
 * nothing, SIDE_CHANGED advances last_side, and TRIGGERED both advances
 * last_side and inserts the trigger row (idempotently, via the
 * alert_triggers UNIQUE(alert_id, quote_fetched_at) constraint). This is
 * the reusable building block D3's refresh integration will call once per
 * (alert, quote) pair - it does not itself read a provider, iterate
 * alerts, or run on a schedule.
 */
export async function applyEvaluationOutcome(
  db: Database,
  input: ApplyEvaluationOutcomeInput,
): Promise<AlertTriggerRow | null> {
  const { outcome } = input;
  if (outcome.kind === "SKIPPED" || outcome.kind === "NO_CHANGE") {
    return null;
  }

  return db.transaction(async (tx) => {
    if (outcome.kind === "SIDE_CHANGED") {
      await repo.recordSideChange(tx, {
        id: input.alertId,
        newSide: outcome.newSide,
        quoteFetchedAt: input.quoteFetchedAt,
        now: input.now,
      });
      return null;
    }

    // outcome.kind === "TRIGGERED"
    await repo.markAlertTriggered(tx, {
      id: input.alertId,
      newSide: outcome.newSide,
      quoteFetchedAt: input.quoteFetchedAt,
      now: input.now,
    });
    return repo.insertAlertTriggerIfNew(tx, {
      id: randomUUID(),
      alertId: input.alertId,
      ownerId: input.ownerId,
      symbol: input.symbol,
      triggeredAt: input.now,
      quoteFetchedAt: input.quoteFetchedAt,
      observedPrice: input.observedPrice,
      thresholdValue: input.thresholdValue,
      conditionType: input.conditionType,
      direction: input.direction,
      previousSide: outcome.previousSide,
      newSide: outcome.newSide,
      dayChangePercent: input.dayChangePercent,
    });
  });
}

/**
 * One symbol's freshly-persisted quote, already reduced to what evaluation
 * needs, with reliability already resolved by the caller. See
 * lib/market/refresh-service.ts, which resolves database time/session/
 * reliability once per refresh cycle and builds one of these per symbol
 * actually updated that cycle - this module never re-derives any of that.
 */
export type QuoteObservation = {
  symbol: string;
  lastPrice: Decimal;
  previousClose: Decimal;
  fetchedAt: Instant;
  reliability: Reliability;
};

/**
 * The D3 write-side hook: evaluates every non-disabled alert on each given
 * symbol against that symbol's observation, applying each outcome
 * atomically. Must be called from inside the same write transaction that
 * persisted the quotes (T2) - this is what makes "quote + alert transition
 * + trigger insertion" one atomic unit, and it must never be called from a
 * read path. `now` is that same transaction's authoritative timestamp,
 * used only for created_at/updated_at-style bookkeeping (last_evaluated_
 * quote_at instead uses each observation's own fetchedAt, per the locked
 * observation-identity rule).
 */
export async function evaluateAlertsForRefreshedSymbols(
  db: Database,
  now: Instant,
  observations: QuoteObservation[],
): Promise<void> {
  if (observations.length === 0) {
    return;
  }
  const bySymbol = new Map(observations.map((observation) => [observation.symbol, observation]));
  const evaluableAlerts = await repo.listEvaluableAlertsForSymbols(db, [...bySymbol.keys()]);

  for (const alert of evaluableAlerts) {
    // Every alert here came back from an IN-list keyed on bySymbol, so this
    // is always present; the guard is defensive, not a real branch.
    const observation = bySymbol.get(alert.symbol);
    if (!observation) {
      continue;
    }

    const dayChangePercent = changePercentOf(observation.lastPrice, observation.previousClose);
    const outcome = evaluateAlert(
      {
        conditionType: alert.conditionType,
        direction: alert.direction,
        thresholdValue: Number(alert.thresholdValue),
        state: alert.state,
        lastSide: alert.lastSide,
        lastEvaluatedQuoteAt: alert.lastEvaluatedQuoteAt,
      },
      { lastPrice: Number(observation.lastPrice), changePercent: dayChangePercent, fetchedAt: observation.fetchedAt },
      observation.reliability,
    );

    await applyEvaluationOutcome(db, {
      alertId: alert.id,
      ownerId: alert.ownerId,
      symbol: alert.symbol,
      conditionType: alert.conditionType,
      direction: alert.direction,
      thresholdValue: alert.thresholdValue,
      outcome,
      quoteFetchedAt: observation.fetchedAt,
      observedPrice: observation.lastPrice,
      dayChangePercent: dayChangePercent === null ? null : dayChangePercent.toFixed(4),
      now,
    });
  }
}
