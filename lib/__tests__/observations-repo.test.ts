import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { symbolObservations } from "@/db/schema";
import { upsertObservationIfNewer } from "@/lib/db/observations-repo";
import { addSymbolToWatchlist, removeSymbolFromWatchlist } from "@/lib/watchlist";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";
import { createTestOwner, getTestDb } from "./test-db";

const SYMBOL = SYMBOL_UNIVERSE[0].symbol;

async function readObservation(ownerId: string, symbol: string) {
  const db = getTestDb();
  const [row] = await db
    .select({ baselinePrice: symbolObservations.baselinePrice, quoteFetchedAt: symbolObservations.quoteFetchedAt })
    .from(symbolObservations)
    .where(and(eq(symbolObservations.ownerId, ownerId), eq(symbolObservations.symbol, symbol)));
  return row ?? null;
}

function obs(ownerId: string, symbol: string, price: string, fetchedAt: Date) {
  return {
    ownerId,
    symbol,
    baselinePrice: price,
    observedAt: fetchedAt,
    quoteFetchedAt: fetchedAt,
    sessionDate: "2026-06-03",
  };
}

describe("upsertObservationIfNewer", () => {
  it("creates a baseline on the first trustworthy acknowledgement", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const t1 = new Date("2026-06-03T04:00:00.000Z");

    const advanced = await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "100.00", t1));

    expect(advanced).toBe(true);
    expect(await readObservation(ownerId, SYMBOL)).toEqual({ baselinePrice: "100.0000", quoteFetchedAt: t1 });
  });

  it("rapid visits advance the baseline 100 -> 104 -> 105, never back to the original", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const t1 = new Date("2026-06-03T04:00:00.000Z");
    const t2 = new Date("2026-06-03T04:30:00.000Z");
    const t3 = new Date("2026-06-03T05:00:00.000Z");

    await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "100.00", t1));
    await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "104.00", t2));
    await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "105.00", t3));

    expect(await readObservation(ownerId, SYMBOL)).toEqual({ baselinePrice: "105.0000", quoteFetchedAt: t3 });
  });

  it("duplicate acknowledgement of the same observation is harmless", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const t1 = new Date("2026-06-03T04:00:00.000Z");

    const first = await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "100.00", t1));
    const second = await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "100.00", t1));

    expect(first).toBe(true);
    expect(second).toBe(false); // not strictly newer - no-op, not an error
    expect(await readObservation(ownerId, SYMBOL)).toEqual({ baselinePrice: "100.0000", quoteFetchedAt: t1 });
  });

  it("an older (reordered/retried) acknowledgement can never overwrite a newer one", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const older = new Date("2026-06-03T04:00:00.000Z");
    const newer = new Date("2026-06-03T05:00:00.000Z");

    await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "105.00", newer));
    const advanced = await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "100.00", older));

    expect(advanced).toBe(false);
    expect(await readObservation(ownerId, SYMBOL)).toEqual({ baselinePrice: "105.0000", quoteFetchedAt: newer });
  });

  it("concurrent first-acknowledgement attempts produce exactly one row, and the newer observation wins", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const t1 = new Date("2026-06-03T04:00:00.000Z");
    const t2 = new Date("2026-06-03T04:00:01.000Z");

    await Promise.all([
      upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "100.00", t1)),
      upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "101.00", t2)),
    ]);

    const rows = await db
      .select({ quoteFetchedAt: symbolObservations.quoteFetchedAt })
      .from(symbolObservations)
      .where(and(eq(symbolObservations.ownerId, ownerId), eq(symbolObservations.symbol, SYMBOL)));

    expect(rows).toHaveLength(1);
    expect(await readObservation(ownerId, SYMBOL)).toEqual({ baselinePrice: "101.0000", quoteFetchedAt: t2 });
  });

  it("a failed batch member rolls back the whole acknowledgement transaction, including otherwise-valid members", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const t1 = new Date("2026-06-03T04:00:00.000Z");

    await expect(
      db.transaction(async (tx) => {
        await upsertObservationIfNewer(tx, obs(ownerId, SYMBOL, "100.00", t1));
        // Violates the symbol FK - forces the whole transaction to fail.
        await upsertObservationIfNewer(tx, obs(ownerId, "NOT-A-REAL-SYMBOL", "1.00", t1));
      }),
    ).rejects.toThrow();

    expect(await readObservation(ownerId, SYMBOL)).toBeNull();
  });
});

describe("watchlist removal integration", () => {
  it("removing a symbol deletes its observation in the same transaction; re-adding starts NO_BASELINE", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    const t1 = new Date("2026-06-03T04:00:00.000Z");

    await addSymbolToWatchlist(db, ownerId, SYMBOL);
    await upsertObservationIfNewer(db, obs(ownerId, SYMBOL, "100.00", t1));
    expect(await readObservation(ownerId, SYMBOL)).not.toBeNull();

    await removeSymbolFromWatchlist(db, ownerId, SYMBOL);
    expect(await readObservation(ownerId, SYMBOL)).toBeNull();

    await addSymbolToWatchlist(db, ownerId, SYMBOL);
    expect(await readObservation(ownerId, SYMBOL)).toBeNull(); // fresh lifecycle, not the old baseline
  });
});
