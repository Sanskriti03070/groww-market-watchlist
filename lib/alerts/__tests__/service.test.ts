import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { alerts, alertTriggers, owners, watchlistItems } from "@/db/schema";
import * as repo from "@/lib/alerts/repo";
import {
  createAlert,
  deleteAlert,
  disableAlert,
  dismissAlert,
  editAlert,
  enableAlert,
  getAlert,
  MAX_ALERTS_PER_OWNER,
  MAX_ALERTS_PER_SYMBOL,
  type TrustworthyQuoteSnapshot,
} from "@/lib/alerts/service";
import { addSymbolToWatchlist, removeSymbolFromWatchlist } from "@/lib/watchlist";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";
import { createTestOwner, getTestDb } from "@/lib/__tests__/test-db";
import { INACTIVE_TEST_SYMBOL } from "@/lib/__tests__/global-setup";

const EQUITY_SYMBOLS = SYMBOL_UNIVERSE.filter((s) => s.kind === "EQUITY" && s.symbol !== INACTIVE_TEST_SYMBOL).map(
  (s) => s.symbol,
);
const SYMBOL = EQUITY_SYMBOLS[0];
const OTHER_SYMBOL = EQUITY_SYMBOLS[1];

function quote(lastPrice: number, changePercent: number | null = null, fetchedAt = new Date()): TrustworthyQuoteSnapshot {
  return { lastPrice, changePercent, fetchedAt };
}

async function setupOwnerWithSymbol(symbol: string = SYMBOL) {
  const db = getTestDb();
  const { ownerId } = await createTestOwner();
  await addSymbolToWatchlist(db, ownerId, symbol);
  return { db, ownerId };
}

describe("createAlert", () => {
  it("creates an alert with no trustworthy quote available: last_side stays null, never triggers", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();

    const result = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alert.state).toBe("ACTIVE");
    expect(result.alert.lastSide).toBeNull();
    expect(result.alert.lastEvaluatedQuoteAt).toBeNull();
    expect(result.alert.thresholdValue).toBe("1400.0000");
  });

  it("creating with a trustworthy quote seeds the not-yet-satisfied side without triggering", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const fetchedAt = new Date("2026-06-03T05:00:00.000Z");

    const result = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: quote(1350, null, fetchedAt),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.alert.lastSide).toBe(-1);
    expect(result.alert.lastEvaluatedQuoteAt).toEqual(fetchedAt);
    // No trigger row was created by creation itself.
    const triggers = await repo.listTriggersByAlert(db, ownerId, result.alert.id);
    expect(triggers).toHaveLength(0);
  });

  it("rejects a symbol that is not on the owner's watchlist", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    const result = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });

    expect(result).toEqual({ ok: false, error: "SYMBOL_NOT_ON_WATCHLIST" });
  });

  it("rejects an inactive symbol even if it were somehow on the watchlist", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    // INACTIVE_TEST_SYMBOL can't be added via addSymbolToWatchlist (it
    // rejects inactive symbols itself), so the row is inserted directly to
    // isolate the alert-creation check from the watchlist-add check.
    await db.insert(watchlistItems).values({
      id: randomUUID(),
      ownerId,
      symbol: INACTIVE_TEST_SYMBOL,
      position: 0,
      addedAt: new Date(),
    });

    const result = await createAlert(db, {
      ownerId,
      symbol: INACTIVE_TEST_SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 10,
      currentQuote: null,
    });

    expect(result).toEqual({ ok: false, error: "SYMBOL_INACTIVE" });
  });

  it("rejects a non-positive threshold and a DAY_MOVE threshold above 50%", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();

    const zero = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 0,
      currentQuote: null,
    });
    expect(zero).toEqual({ ok: false, error: "INVALID_THRESHOLD" });

    const tooLarge = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "DAY_MOVE",
      direction: "UP",
      thresholdValue: 50.01,
      currentQuote: null,
    });
    expect(tooLarge).toEqual({ ok: false, error: "INVALID_THRESHOLD" });
  });

  it("rejects a PRICE_LEVEL threshold more than 10x the current trustworthy price", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();

    const result = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1001,
      currentQuote: quote(100),
    });

    expect(result).toEqual({ ok: false, error: "INVALID_THRESHOLD" });
  });

  describe("PRICE_LEVEL target must be on the not-yet-satisfied side of the current trustworthy price", () => {
    it("ABOVE: rejects a target below the current price", async () => {
      const { db, ownerId } = await setupOwnerWithSymbol();
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "ABOVE",
        thresholdValue: 900,
        currentQuote: quote(1130),
      });
      expect(result).toEqual({ ok: false, error: "INVALID_THRESHOLD" });
    });

    it("ABOVE: rejects a target equal to the current price", async () => {
      const { db, ownerId } = await setupOwnerWithSymbol();
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "ABOVE",
        thresholdValue: 1130,
        currentQuote: quote(1130),
      });
      expect(result).toEqual({ ok: false, error: "INVALID_THRESHOLD" });
    });

    it("ABOVE: accepts a target above the current price", async () => {
      const { db, ownerId } = await setupOwnerWithSymbol();
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "ABOVE",
        thresholdValue: 1200,
        currentQuote: quote(1130),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.alert.lastSide).toBe(-1); // not yet satisfied - never fires on creation
    });

    it("BELOW: rejects a target above the current price", async () => {
      const { db, ownerId } = await setupOwnerWithSymbol();
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "BELOW",
        thresholdValue: 1200,
        currentQuote: quote(1130),
      });
      expect(result).toEqual({ ok: false, error: "INVALID_THRESHOLD" });
    });

    it("BELOW: rejects a target equal to the current price", async () => {
      const { db, ownerId } = await setupOwnerWithSymbol();
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "BELOW",
        thresholdValue: 1130,
        currentQuote: quote(1130),
      });
      expect(result).toEqual({ ok: false, error: "INVALID_THRESHOLD" });
    });

    it("BELOW: accepts a target below the current price", async () => {
      const { db, ownerId } = await setupOwnerWithSymbol();
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "BELOW",
        thresholdValue: 900,
        currentQuote: quote(1130),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.alert.lastSide).toBe(-1); // not yet satisfied - never fires on creation
    });

    it("is skipped (creation still allowed) when no trustworthy quote exists yet to validate against", async () => {
      const { db, ownerId } = await setupOwnerWithSymbol();
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "ABOVE",
        thresholdValue: 900, // would be invalid against a currentPrice of 1130, but there is none yet
        currentQuote: null,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.alert.lastSide).toBeNull();
    });
  });

  it("enforces the 5-alerts-per-symbol cap", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();

    for (let i = 0; i < MAX_ALERTS_PER_SYMBOL; i++) {
      const result = await createAlert(db, {
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "ABOVE",
        thresholdValue: 1000 + i,
        currentQuote: null,
      });
      expect(result.ok).toBe(true);
    }

    const sixth = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 2000,
      currentQuote: null,
    });
    expect(sixth).toEqual({ ok: false, error: "SYMBOL_CAP_EXCEEDED" });
  });

  it("enforces the 50-alerts-per-owner cap across symbols", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const symbolsNeeded = MAX_ALERTS_PER_OWNER / MAX_ALERTS_PER_SYMBOL + 1; // +1 fresh symbol for the boundary attempt
    const symbols = EQUITY_SYMBOLS.slice(0, symbolsNeeded);
    for (const symbol of symbols) {
      await addSymbolToWatchlist(db, ownerId, symbol);
    }

    for (let s = 0; s < symbolsNeeded - 1; s++) {
      for (let i = 0; i < MAX_ALERTS_PER_SYMBOL; i++) {
        const result = await createAlert(db, {
          ownerId,
          symbol: symbols[s],
          conditionType: "PRICE_LEVEL",
          direction: "ABOVE",
          thresholdValue: 1000 + i,
          currentQuote: null,
        });
        expect(result.ok).toBe(true);
      }
    }

    const boundarySymbol = symbols[symbolsNeeded - 1];
    const overflow = await createAlert(db, {
      ownerId,
      symbol: boundarySymbol,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 999,
      currentQuote: null,
    });
    expect(overflow).toEqual({ ok: false, error: "OWNER_CAP_EXCEEDED" });
  });

  it("allows duplicate alert configurations on the same symbol", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();

    const first = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    const second = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.alert.id).not.toBe(second.alert.id);
  });
});

describe("owner isolation", () => {
  it("an owner cannot read, edit, or delete another owner's alert", async () => {
    const { db, ownerId: ownerA } = await setupOwnerWithSymbol();
    const { ownerId: ownerB } = await createTestOwner();

    const created = await createAlert(db, {
      ownerId: ownerA,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await getAlert(db, ownerB, created.alert.id)).toBeNull();

    const editAsB = await editAlert(db, {
      ownerId: ownerB,
      id: created.alert.id,
      expectedVersion: 0,
      thresholdValue: 1500,
      direction: "ABOVE",
      currentQuote: null,
    });
    expect(editAsB).toEqual({ ok: false, error: "ALERT_NOT_FOUND" });

    const deleteAsB = await deleteAlert(db, ownerB, created.alert.id);
    expect(deleteAsB).toEqual({ ok: false, error: "ALERT_NOT_FOUND" });

    // Untouched from owner A's perspective.
    expect(await getAlert(db, ownerA, created.alert.id)).not.toBeNull();
  });
});

describe("editAlert", () => {
  it("edits threshold/direction with a matching version, re-seeds last_side, and never triggers immediately", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: quote(1300),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.alert.lastSide).toBe(-1);

    const fetchedAt = new Date("2026-06-03T06:00:00.000Z");
    const edited = await editAlert(db, {
      ownerId,
      id: created.alert.id,
      expectedVersion: created.alert.version,
      thresholdValue: 1300,
      direction: "BELOW",
      currentQuote: quote(1295, null, fetchedAt),
    });

    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.alert.direction).toBe("BELOW");
    expect(edited.alert.thresholdValue).toBe("1300.0000");
    expect(edited.alert.state).toBe("ACTIVE");
    expect(edited.alert.lastSide).toBe(1); // 1295 <= 1300 -> satisfied, seeded not triggered
    expect(edited.alert.lastEvaluatedQuoteAt).toEqual(fetchedAt);
    expect(edited.alert.version).toBe(created.alert.version + 1);

    const triggers = await repo.listTriggersByAlert(db, ownerId, created.alert.id);
    expect(triggers).toHaveLength(0);
  });

  it("rejects a stale version with VERSION_CONFLICT and leaves the alert unchanged", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const conflict = await editAlert(db, {
      ownerId,
      id: created.alert.id,
      expectedVersion: created.alert.version + 1, // stale
      thresholdValue: 1500,
      direction: "ABOVE",
      currentQuote: null,
    });
    expect(conflict).toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const unchanged = await getAlert(db, ownerId, created.alert.id);
    expect(unchanged?.thresholdValue).toBe("1400.0000");
    expect(unchanged?.version).toBe(created.alert.version);
  });
});

describe("enable/disable", () => {
  it("disable freezes last_side and marks DISABLED; enable re-seeds and returns to ACTIVE", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: quote(1350), // valid at creation: not yet satisfied
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.alert.lastSide).toBe(-1);

    // Simulate a later refresh-cycle evaluation having already crossed to
    // the satisfied side (D3) - disable must freeze whatever side is
    // currently recorded, not just the value it was seeded with.
    await db.update(alerts).set({ lastSide: 1 }).where(eq(alerts.id, created.alert.id));

    const disabled = await disableAlert(db, ownerId, created.alert.id);
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    expect(disabled.alert.state).toBe("DISABLED");
    expect(disabled.alert.lastSide).toBe(1); // frozen, untouched

    const fetchedAt = new Date("2026-06-03T07:00:00.000Z");
    const enabled = await enableAlert(db, ownerId, created.alert.id, quote(1350, null, fetchedAt));
    expect(enabled.ok).toBe(true);
    if (!enabled.ok) return;
    expect(enabled.alert.state).toBe("ACTIVE");
    expect(enabled.alert.lastSide).toBe(-1); // re-seeded from the new quote
    expect(enabled.alert.lastEvaluatedQuoteAt).toEqual(fetchedAt);
  });

  it("returns ALERT_NOT_FOUND for an unknown id", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    expect(await disableAlert(db, ownerId, randomUUID())).toEqual({ ok: false, error: "ALERT_NOT_FOUND" });
    expect(await enableAlert(db, ownerId, randomUUID(), null)).toEqual({ ok: false, error: "ALERT_NOT_FOUND" });
  });
});

describe("dismissAlert", () => {
  it("acknowledges the latest trigger and returns the alert to ACTIVE; retains trigger history; is idempotent", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const triggeredAt = new Date("2026-06-03T05:00:00.000Z");
    const quoteFetchedAt = new Date("2026-06-03T04:59:00.000Z");
    await db
      .update(alerts)
      .set({ state: "TRIGGERED", lastSide: 1, lastEvaluatedQuoteAt: quoteFetchedAt })
      .where(eq(alerts.id, created.alert.id));
    const trigger = await repo.insertAlertTriggerIfNew(db, {
      id: randomUUID(),
      alertId: created.alert.id,
      ownerId,
      symbol: SYMBOL,
      triggeredAt,
      quoteFetchedAt,
      observedPrice: "1450.0000",
      thresholdValue: "1400.0000",
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      previousSide: -1,
      newSide: 1,
      dayChangePercent: null,
    });
    expect(trigger).not.toBeNull();

    const dismissed = await dismissAlert(db, ownerId, created.alert.id);
    expect(dismissed.ok).toBe(true);
    if (!dismissed.ok) return;
    expect(dismissed.alert.state).toBe("ACTIVE");

    const [triggerRow] = await repo.listTriggersByAlert(db, ownerId, created.alert.id);
    expect(triggerRow.acknowledgedAt).not.toBeNull();

    // Idempotent: dismissing again succeeds and doesn't error on the
    // already-acknowledged trigger.
    const dismissedAgain = await dismissAlert(db, ownerId, created.alert.id);
    expect(dismissedAgain).toEqual({ ok: true, alert: expect.objectContaining({ state: "ACTIVE" }) });
  });

  it("dismissing an alert with no trigger history still succeeds and is a no-op beyond state", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const dismissed = await dismissAlert(db, ownerId, created.alert.id);
    expect(dismissed).toEqual({ ok: true, alert: expect.objectContaining({ state: "ACTIVE" }) });
  });
});

describe("delete", () => {
  it("deleting an alert cascades to its trigger rows", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await repo.insertAlertTriggerIfNew(db, {
      id: randomUUID(),
      alertId: created.alert.id,
      ownerId,
      symbol: SYMBOL,
      triggeredAt: new Date(),
      quoteFetchedAt: new Date(),
      observedPrice: "1450.0000",
      thresholdValue: "1400.0000",
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      previousSide: -1,
      newSide: 1,
      dayChangePercent: null,
    });

    const result = await deleteAlert(db, ownerId, created.alert.id);
    expect(result).toEqual({ ok: true });

    const remainingTriggers = await db.select().from(alertTriggers).where(eq(alertTriggers.alertId, created.alert.id));
    expect(remainingTriggers).toHaveLength(0);
  });
});

describe("FK/cascade at the owner boundary", () => {
  it("deleting an owner cascades to their alerts", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);

    await db.delete(owners).where(eq(owners.id, ownerId));

    const remaining = await db.select().from(alerts).where(eq(alerts.ownerId, ownerId));
    expect(remaining).toHaveLength(0);
  });
});

describe("trigger uniqueness", () => {
  it("UNIQUE(alert_id, quote_fetched_at) makes a duplicate trigger insert a harmless no-op", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol();
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const quoteFetchedAt = new Date("2026-06-03T05:00:00.000Z");
    const triggerInput = {
      alertId: created.alert.id,
      ownerId,
      symbol: SYMBOL,
      triggeredAt: new Date(),
      quoteFetchedAt,
      observedPrice: "1450.0000",
      thresholdValue: "1400.0000",
      conditionType: "PRICE_LEVEL" as const,
      direction: "ABOVE" as const,
      previousSide: -1 as const,
      newSide: 1 as const,
      dayChangePercent: null,
    };

    const first = await repo.insertAlertTriggerIfNew(db, { id: randomUUID(), ...triggerInput });
    const second = await repo.insertAlertTriggerIfNew(db, { id: randomUUID(), ...triggerInput });

    expect(first).not.toBeNull();
    expect(second).toBeNull();

    const rows = await repo.listTriggersByAlert(db, ownerId, created.alert.id);
    expect(rows).toHaveLength(1);
  });
});

describe("numeric constraints", () => {
  it("rejects a non-positive threshold at the database level", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, SYMBOL);

    await expect(
      repo.insertAlert(db, {
        id: randomUUID(),
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "ABOVE",
        thresholdValue: "0.0000",
        lastSide: null,
        lastEvaluatedQuoteAt: null,
        now: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("rejects a direction that does not match its condition type at the database level", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, SYMBOL);

    await expect(
      repo.insertAlert(db, {
        id: randomUUID(),
        ownerId,
        symbol: SYMBOL,
        conditionType: "PRICE_LEVEL",
        direction: "UP",
        thresholdValue: "10.0000",
        lastSide: null,
        lastEvaluatedQuoteAt: null,
        now: new Date(),
      }),
    ).rejects.toThrow();
  });
});

describe("symbol lifecycle", () => {
  it("removing a symbol from the watchlist disables (never deletes) its alerts; re-adding does not re-enable them", async () => {
    const { db, ownerId } = await setupOwnerWithSymbol(OTHER_SYMBOL);
    const created = await createAlert(db, {
      ownerId,
      symbol: OTHER_SYMBOL,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await removeSymbolFromWatchlist(db, ownerId, OTHER_SYMBOL);

    const afterRemoval = await getAlert(db, ownerId, created.alert.id);
    expect(afterRemoval?.state).toBe("DISABLED");

    await addSymbolToWatchlist(db, ownerId, OTHER_SYMBOL);
    const afterReadd = await getAlert(db, ownerId, created.alert.id);
    expect(afterReadd?.state).toBe("DISABLED"); // intent preserved, not silently re-enabled
  });
});
