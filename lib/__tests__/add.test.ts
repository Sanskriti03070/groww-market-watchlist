import { describe, expect, it } from "vitest";
import { INACTIVE_TEST_SYMBOL } from "./global-setup";
import { createTestOwner, getTestDb } from "./test-db";
import { addSymbolToWatchlist, MAX_WATCHLIST_SIZE } from "@/lib/watchlist";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";

const ACTIVE_SYMBOLS = SYMBOL_UNIVERSE.map((s) => s.symbol).filter((s) => s !== INACTIVE_TEST_SYMBOL);

describe("add", () => {
  it("adds a symbol at the next dense position", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    const items = await addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[0]);

    expect(items).toEqual([{ symbol: ACTIVE_SYMBOLS[0], position: 0, addedAt: expect.any(String) }]);
  });

  it("rejects an unknown symbol", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    await expect(addSymbolToWatchlist(db, ownerId, "NOTREAL")).rejects.toMatchObject({
      status: 422,
      code: "unknown_symbol",
    });
  });

  it("rejects a known but inactive symbol", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    await expect(addSymbolToWatchlist(db, ownerId, INACTIVE_TEST_SYMBOL)).rejects.toMatchObject({
      status: 422,
      code: "inactive_symbol",
    });
  });

  it("adding the same symbol twice is idempotent", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    await addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[0]);
    await addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[1]);
    const items = await addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[0]);

    expect(items.map((i) => i.symbol)).toEqual([ACTIVE_SYMBOLS[0], ACTIVE_SYMBOLS[1]]);
    expect(items.map((i) => i.position)).toEqual([0, 1]);
  });

  it("two simultaneous adds of the SAME symbol for one owner end with exactly one row", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    const results = await Promise.all([
      addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[0]),
      addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[0]),
    ]);

    for (const items of results) {
      expect(items.map((i) => i.symbol)).toEqual([ACTIVE_SYMBOLS[0]]);
    }
  });

  it("two simultaneous adds of DIFFERENT symbols for one owner both end up present with dense positions", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    await Promise.all([
      addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[0]),
      addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[1]),
    ]);

    const items = await addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[0]); // idempotent read-through
    const symbols = items.map((i) => i.symbol).sort();
    expect(symbols).toEqual([ACTIVE_SYMBOLS[0], ACTIVE_SYMBOLS[1]].sort());
    expect(items.map((i) => i.position).sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it("accepts the 50th item and rejects the 51st", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    expect(ACTIVE_SYMBOLS.length).toBeGreaterThanOrEqual(MAX_WATCHLIST_SIZE + 1);

    let items: Awaited<ReturnType<typeof addSymbolToWatchlist>> = [];
    for (let i = 0; i < MAX_WATCHLIST_SIZE; i += 1) {
      items = await addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[i]);
    }
    expect(items).toHaveLength(MAX_WATCHLIST_SIZE);

    await expect(addSymbolToWatchlist(db, ownerId, ACTIVE_SYMBOLS[MAX_WATCHLIST_SIZE])).rejects.toMatchObject({
      status: 422,
      code: "max_size_exceeded",
    });
  });

  it("different owners never contend: concurrent adds for different owners both succeed independently", async () => {
    const db = getTestDb();
    const ownerA = await createTestOwner();
    const ownerB = await createTestOwner();

    const [itemsA, itemsB] = await Promise.all([
      addSymbolToWatchlist(db, ownerA.ownerId, ACTIVE_SYMBOLS[0]),
      addSymbolToWatchlist(db, ownerB.ownerId, ACTIVE_SYMBOLS[0]),
    ]);

    expect(itemsA).toEqual([{ symbol: ACTIVE_SYMBOLS[0], position: 0, addedAt: expect.any(String) }]);
    expect(itemsB).toEqual([{ symbol: ACTIVE_SYMBOLS[0], position: 0, addedAt: expect.any(String) }]);
  });
});
