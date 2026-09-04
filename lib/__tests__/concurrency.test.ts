import { describe, expect, it } from "vitest";
import { createTestOwner, getTestDb } from "./test-db";
import { addSymbolToWatchlist, getWatchlist, removeSymbolFromWatchlist, reorderWatchlist } from "@/lib/watchlist";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";

const S = SYMBOL_UNIVERSE.map((s) => s.symbol);

/** No duplicate symbols, positions are exactly {0,...,n-1}. */
function expectDenseAndUnique(items: Array<{ symbol: string; position: number }>) {
  const positions = items.map((i) => i.position).sort((a, b) => a - b);
  expect(positions).toEqual(items.map((_, idx) => idx));
  expect(new Set(items.map((i) => i.symbol)).size).toBe(items.length);
}

describe("concurrency", () => {
  it("concurrent add/add/remove for one owner serializes to a consistent, dense final state", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, S[0]);

    await Promise.all([
      addSymbolToWatchlist(db, ownerId, S[1]),
      addSymbolToWatchlist(db, ownerId, S[2]),
      removeSymbolFromWatchlist(db, ownerId, S[0]),
    ]);

    const final = await getWatchlist(db, ownerId);
    expectDenseAndUnique(final);
    expect(final.map((i) => i.symbol).sort()).toEqual([S[1], S[2]].sort());
  });

  it("different owners never contend: concurrent mutations for two owners don't affect each other", async () => {
    const db = getTestDb();
    const ownerA = await createTestOwner();
    const ownerB = await createTestOwner();

    await Promise.all([
      addSymbolToWatchlist(db, ownerA.ownerId, S[0]),
      addSymbolToWatchlist(db, ownerB.ownerId, S[1]),
    ]);

    const [finalA, finalB] = await Promise.all([getWatchlist(db, ownerA.ownerId), getWatchlist(db, ownerB.ownerId)]);
    expect(finalA.map((i) => i.symbol)).toEqual([S[0]]);
    expect(finalB.map((i) => i.symbol)).toEqual([S[1]]);
  });

  it("reorder racing remove: either the reorder sees stale membership (409) or it applies before the remove, but the end state is always dense and never corrupted", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, S[0]);
    await addSymbolToWatchlist(db, ownerId, S[1]);
    await addSymbolToWatchlist(db, ownerId, S[2]);

    const results = await Promise.allSettled([
      removeSymbolFromWatchlist(db, ownerId, S[0]),
      reorderWatchlist(db, ownerId, [S[0], S[1], S[2]]),
    ]);

    // The remove is unconditional and always succeeds; the reorder either
    // applies (if it acquired the lock first) or is rejected as stale (if
    // it ran after the remove changed membership) - never anything else.
    const reorderOutcome = results[1];
    if (reorderOutcome.status === "rejected") {
      expect(reorderOutcome.reason).toMatchObject({ status: 409, code: "stale_membership" });
    }

    const final = await getWatchlist(db, ownerId);
    expectDenseAndUnique(final);
    expect(final.map((i) => i.symbol).sort()).toEqual([S[1], S[2]].sort());
  });

  it("two concurrent reorders of the same membership: last write wins, final state is always a clean permutation", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, S[0]);
    await addSymbolToWatchlist(db, ownerId, S[1]);
    await addSymbolToWatchlist(db, ownerId, S[2]);

    const orderA = [S[2], S[1], S[0]];
    const orderB = [S[1], S[0], S[2]];

    await Promise.all([reorderWatchlist(db, ownerId, orderA), reorderWatchlist(db, ownerId, orderB)]);

    const final = await getWatchlist(db, ownerId);
    expectDenseAndUnique(final);
    const finalOrder = final.map((i) => i.symbol);
    const matchesA = JSON.stringify(finalOrder) === JSON.stringify(orderA);
    const matchesB = JSON.stringify(finalOrder) === JSON.stringify(orderB);
    expect(matchesA || matchesB).toBe(true);
  });
});
