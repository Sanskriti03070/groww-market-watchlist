import { describe, expect, it } from "vitest";
import * as repo from "@/lib/alerts/repo";
import {
  createAlert,
  evaluateAlertsForRefreshedSymbols,
  getAlert,
  type QuoteObservation,
  type TrustworthyQuoteSnapshot,
} from "@/lib/alerts/service";
import { addSymbolToWatchlist } from "@/lib/watchlist";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";
import { createTestOwner, getTestDb } from "@/lib/__tests__/test-db";

const EQUITY_SYMBOLS = SYMBOL_UNIVERSE.filter((s) => s.kind === "EQUITY").map((s) => s.symbol);
const SYMBOL = EQUITY_SYMBOLS[10];
const OTHER_SYMBOL = EQUITY_SYMBOLS[11];

// Before every fetchedAt used below - creation's seed evaluation must never
// collide with (or postdate) a test's own observations.
const SEED_TIME = new Date("2026-06-01T00:00:00.000Z");

function observation(
  symbol: string,
  lastPrice: number,
  fetchedAt: Date,
  reliability: QuoteObservation["reliability"] = "LIVE",
  previousClose = 1400,
): QuoteObservation {
  return { symbol, lastPrice: lastPrice.toFixed(4), previousClose: previousClose.toFixed(4), fetchedAt, reliability };
}

async function setupAlert(symbol: string, threshold: number, currentQuote: TrustworthyQuoteSnapshot | null) {
  const db = getTestDb();
  const { ownerId } = await createTestOwner();
  await addSymbolToWatchlist(db, ownerId, symbol);
  const created = await createAlert(db, {
    ownerId,
    symbol,
    conditionType: "PRICE_LEVEL",
    direction: "ABOVE",
    thresholdValue: threshold,
    currentQuote,
  });
  if (!created.ok) throw new Error("test setup failed");
  return { db, ownerId, alert: created.alert };
}

/** An alert already armed at side -1 (below threshold), so a test's first observation exercises a real transition instead of the from-null "establish only" case. */
async function setupArmedBelowAlert(symbol: string, threshold = 1400) {
  return setupAlert(symbol, threshold, { lastPrice: threshold - 50, changePercent: null, fetchedAt: SEED_TIME });
}

describe("evaluateAlertsForRefreshedSymbols", () => {
  it("evaluates alerts on symbols with an observation and produces a trigger on a genuine crossing", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);
    const fetchedAt = new Date("2026-06-03T05:00:00.000Z");

    await evaluateAlertsForRefreshedSymbols(db, fetchedAt, [observation(SYMBOL, 1450, fetchedAt)]);

    const updated = await getAlert(db, ownerId, alert.id);
    expect(updated?.state).toBe("TRIGGERED");
    expect(updated?.lastSide).toBe(1);
    expect(updated?.lastEvaluatedQuoteAt).toEqual(fetchedAt);

    const triggers = await repo.listTriggersByAlert(db, ownerId, alert.id);
    expect(triggers).toHaveLength(1);
    expect(triggers[0].observedPrice).toBe("1450.0000");
    expect(triggers[0].quoteFetchedAt).toEqual(fetchedAt);
  });

  it("leaves an alert untouched when its symbol has no observation (a failed refresh symbol)", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);

    await evaluateAlertsForRefreshedSymbols(db, new Date(), [observation(OTHER_SYMBOL, 1450, new Date())]);

    const unchanged = await getAlert(db, ownerId, alert.id);
    expect(unchanged?.state).toBe("ACTIVE");
    expect(unchanged?.lastSide).toBe(-1); // still exactly as seeded at creation
    expect(unchanged?.lastEvaluatedQuoteAt).toEqual(SEED_TIME);
  });

  it("partial refresh: only the symbol with an observation evaluates, the other is untouched", async () => {
    const a = await setupArmedBelowAlert(SYMBOL);
    const b = await setupArmedBelowAlert(OTHER_SYMBOL);
    const fetchedAt = new Date("2026-06-03T05:00:00.000Z");

    await evaluateAlertsForRefreshedSymbols(a.db, fetchedAt, [observation(SYMBOL, 1450, fetchedAt)]);

    expect((await getAlert(a.db, a.ownerId, a.alert.id))?.lastSide).toBe(1);
    expect((await getAlert(b.db, b.ownerId, b.alert.id))?.lastSide).toBe(-1); // untouched
  });

  it("STALE and UNAVAILABLE observations never change last_side, last_evaluated_quote_at, or state", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);
    const fetchedAt = new Date("2026-06-03T05:00:00.000Z");

    await evaluateAlertsForRefreshedSymbols(db, fetchedAt, [observation(SYMBOL, 1450, fetchedAt, "STALE")]);
    let unchanged = await getAlert(db, ownerId, alert.id);
    expect(unchanged?.lastSide).toBe(-1);
    expect(unchanged?.lastEvaluatedQuoteAt).toEqual(SEED_TIME);
    expect(unchanged?.state).toBe("ACTIVE");

    await evaluateAlertsForRefreshedSymbols(db, fetchedAt, [observation(SYMBOL, 1450, fetchedAt, "UNAVAILABLE_TOO_OLD")]);
    unchanged = await getAlert(db, ownerId, alert.id);
    expect(unchanged?.lastSide).toBe(-1);
  });

  it("a DISABLED alert (e.g. its symbol left the watchlist) is never selected for evaluation", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);
    const disabled = await repo.disableAlert(db, ownerId, alert.id, new Date());
    expect(disabled?.state).toBe("DISABLED");

    await evaluateAlertsForRefreshedSymbols(db, new Date(), [observation(SYMBOL, 1450, new Date())]);

    const stillDisabled = await getAlert(db, ownerId, alert.id);
    expect(stillDisabled?.state).toBe("DISABLED");
    expect(stillDisabled?.lastSide).toBe(-1); // frozen at whatever it was when disabled
  });

  it("identical or older fetched_at is skipped (monotonic guard) - no re-evaluation, no duplicate trigger", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);
    const t1 = new Date("2026-06-03T05:00:00.000Z");
    const older = new Date("2026-06-03T04:30:00.000Z"); // after SEED_TIME, but before t1

    await evaluateAlertsForRefreshedSymbols(db, t1, [observation(SYMBOL, 1450, t1)]); // genuine crossing -> trigger
    await evaluateAlertsForRefreshedSymbols(db, t1, [observation(SYMBOL, 1460, t1)]); // same fetchedAt again -> skip
    await evaluateAlertsForRefreshedSymbols(db, t1, [observation(SYMBOL, 1470, older)]); // older fetchedAt -> skip

    const triggers = await repo.listTriggersByAlert(db, ownerId, alert.id);
    expect(triggers).toHaveLength(1); // only the genuine crossing produced anything
    expect(triggers[0].observedPrice).toBe("1450.0000");
  });

  it("LAST_CLOSE evaluates once (establishing state from null) but a repeat at the same fetched_at is skipped", async () => {
    const { db, ownerId, alert } = await setupAlert(SYMBOL, 1400, null);
    const closeFetchedAt = new Date("2026-06-03T10:00:00.000Z");

    await evaluateAlertsForRefreshedSymbols(db, closeFetchedAt, [observation(SYMBOL, 1350, closeFetchedAt, "LAST_CLOSE")]);
    const afterFirst = await getAlert(db, ownerId, alert.id);
    expect(afterFirst?.lastSide).toBe(-1); // established, not triggered - it was seeded from null
    expect(afterFirst?.lastEvaluatedQuoteAt).toEqual(closeFetchedAt);

    // A later visit/refresh that captures the same frozen post-close quote
    // (same fetched_at) must not evaluate again.
    await evaluateAlertsForRefreshedSymbols(db, closeFetchedAt, [observation(SYMBOL, 1450, closeFetchedAt, "LAST_CLOSE")]);
    const afterRepeat = await getAlert(db, ownerId, alert.id);
    expect(afterRepeat?.lastSide).toBe(-1); // untouched - the 1450 observation was never evaluated
  });

  it("a new session's newer quote resumes evaluation after a frozen LAST_CLOSE, including an overnight gap across the threshold", async () => {
    const { db, ownerId, alert } = await setupAlert(SYMBOL, 1400, null);
    const fridayClose = new Date("2026-06-05T10:00:00.000Z");
    const mondayOpen = new Date("2026-06-08T04:00:00.000Z");

    await evaluateAlertsForRefreshedSymbols(db, fridayClose, [observation(SYMBOL, 1390, fridayClose, "LAST_CLOSE")]);
    expect((await getAlert(db, ownerId, alert.id))?.lastSide).toBe(-1);

    // Market gapped open above the threshold Monday - never observed exactly
    // at 1400, but the crossing is still recorded, using the actual price.
    await evaluateAlertsForRefreshedSymbols(db, mondayOpen, [observation(SYMBOL, 1425, mondayOpen, "LIVE")]);

    const afterGap = await getAlert(db, ownerId, alert.id);
    expect(afterGap?.state).toBe("TRIGGERED");
    expect(afterGap?.lastSide).toBe(1);

    const [trigger] = await repo.listTriggersByAlert(db, ownerId, alert.id);
    expect(trigger.observedPrice).toBe("1425.0000"); // the real observed price, never the unobserved threshold
    expect(trigger.quoteFetchedAt).toEqual(mondayOpen);
  });

  it("below -> above -> below -> above creates exactly one trigger per crossing (two total)", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);
    const t1 = new Date("2026-06-03T04:00:00.000Z");
    const t2 = new Date("2026-06-03T05:00:00.000Z");
    const t3 = new Date("2026-06-03T06:00:00.000Z");

    await evaluateAlertsForRefreshedSymbols(db, t1, [observation(SYMBOL, 1450, t1)]); // trigger #1
    await evaluateAlertsForRefreshedSymbols(db, t2, [observation(SYMBOL, 1350, t2)]); // re-arm
    await evaluateAlertsForRefreshedSymbols(db, t3, [observation(SYMBOL, 1460, t3)]); // trigger #2

    const triggers = await repo.listTriggersByAlert(db, ownerId, alert.id);
    expect(triggers).toHaveLength(2);
  });

  it("concurrent duplicate evaluation of the same observation cannot create duplicate triggers", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);
    const fetchedAt = new Date("2026-06-03T05:00:00.000Z");
    const obs = [observation(SYMBOL, 1450, fetchedAt)];

    await Promise.all([
      evaluateAlertsForRefreshedSymbols(db, fetchedAt, obs),
      evaluateAlertsForRefreshedSymbols(db, fetchedAt, obs),
    ]);

    const triggers = await repo.listTriggersByAlert(db, ownerId, alert.id);
    expect(triggers).toHaveLength(1);
    const finalAlert = await getAlert(db, ownerId, alert.id);
    expect(finalAlert?.state).toBe("TRIGGERED");
    expect(finalAlert?.lastSide).toBe(1);
  });

  it("evaluating with no observations at all is a harmless no-op", async () => {
    const { db, ownerId, alert } = await setupArmedBelowAlert(SYMBOL);
    await evaluateAlertsForRefreshedSymbols(db, new Date(), []);
    expect((await getAlert(db, ownerId, alert.id))?.lastSide).toBe(-1);
  });

  it("DAY_MOVE with no usable previous close (previousClose 0) is skipped, not treated as a trigger", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, SYMBOL);
    const created = await createAlert(db, {
      ownerId,
      symbol: SYMBOL,
      conditionType: "DAY_MOVE",
      direction: "UP",
      thresholdValue: 3,
      currentQuote: null,
    });
    if (!created.ok) throw new Error("setup failed");

    const fetchedAt = new Date("2026-06-03T05:00:00.000Z");
    await evaluateAlertsForRefreshedSymbols(db, fetchedAt, [observation(SYMBOL, 1450, fetchedAt, "LIVE", 0)]);

    const unchanged = await getAlert(db, ownerId, created.alert.id);
    expect(unchanged?.lastSide).toBeNull();
    expect(unchanged?.lastEvaluatedQuoteAt).toBeNull();
  });
});
