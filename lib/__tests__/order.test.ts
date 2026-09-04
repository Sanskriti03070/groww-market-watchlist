import { describe, expect, it } from "vitest";
import { createTestOwner, getTestDb } from "./test-db";
import { addSymbolToWatchlist, getWatchlist, reorderWatchlist } from "@/lib/watchlist";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";

const S = SYMBOL_UNIVERSE.map((s) => s.symbol);

async function seedThree(ownerId: string) {
  const db = getTestDb();
  await addSymbolToWatchlist(db, ownerId, S[0]);
  await addSymbolToWatchlist(db, ownerId, S[1]);
  await addSymbolToWatchlist(db, ownerId, S[2]);
}

describe("order", () => {
  it("applies a valid full-permutation reorder", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await seedThree(ownerId);

    const items = await reorderWatchlist(db, ownerId, [S[2], S[0], S[1]]);

    expect(items.map((i) => i.symbol)).toEqual([S[2], S[0], S[1]]);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("submitting the same order twice is idempotent", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await seedThree(ownerId);

    await reorderWatchlist(db, ownerId, [S[2], S[0], S[1]]);
    const items = await reorderWatchlist(db, ownerId, [S[2], S[0], S[1]]);

    expect(items.map((i) => i.symbol)).toEqual([S[2], S[0], S[1]]);
    expect(items.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("a permutation missing a current member is rejected with no mutation", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await seedThree(ownerId);

    await expect(reorderWatchlist(db, ownerId, [S[0], S[1]])).rejects.toMatchObject({
      status: 409,
      code: "stale_membership",
    });

    const unchanged = await getWatchlist(db, ownerId);
    expect(unchanged.map((i) => i.symbol)).toEqual([S[0], S[1], S[2]]);
    expect(unchanged.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("a permutation with an extra, non-member symbol is rejected with no mutation", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await seedThree(ownerId);

    await expect(reorderWatchlist(db, ownerId, [S[0], S[1], S[2], S[3]])).rejects.toMatchObject({
      status: 409,
      code: "stale_membership",
    });

    const unchanged = await getWatchlist(db, ownerId);
    expect(unchanged.map((i) => i.symbol)).toEqual([S[0], S[1], S[2]]);
    expect(unchanged.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("final positions after reorder are always dense with no gaps or duplicates", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await seedThree(ownerId);

    const items = await reorderWatchlist(db, ownerId, [S[1], S[2], S[0]]);
    const positions = items.map((i) => i.position).sort((a, b) => a - b);

    expect(positions).toEqual([0, 1, 2]);
    expect(new Set(positions).size).toBe(3);
  });
});
