import { describe, expect, it } from "vitest";
import { createTestOwner, getTestDb } from "./test-db";
import { addSymbolToWatchlist, removeSymbolFromWatchlist } from "@/lib/watchlist";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";

const S = SYMBOL_UNIVERSE.map((s) => s.symbol);

describe("remove", () => {
  it("removes a present symbol and compacts positions", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, S[0]);
    await addSymbolToWatchlist(db, ownerId, S[1]);
    await addSymbolToWatchlist(db, ownerId, S[2]);

    const items = await removeSymbolFromWatchlist(db, ownerId, S[0]);

    expect(items.map((i) => i.symbol)).toEqual([S[1], S[2]]);
    expect(items.map((i) => i.position)).toEqual([0, 1]);
  });

  it("removing an absent symbol is idempotent and leaves state untouched", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, S[0]);

    const items = await removeSymbolFromWatchlist(db, ownerId, S[5]);

    expect(items.map((i) => i.symbol)).toEqual([S[0]]);
    expect(items.map((i) => i.position)).toEqual([0]);
  });

  it("removing from an empty watchlist is idempotent", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    const items = await removeSymbolFromWatchlist(db, ownerId, S[0]);

    expect(items).toEqual([]);
  });

  it("repeated add/remove cycles keep positions dense (0..n-1, no gaps)", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await addSymbolToWatchlist(db, ownerId, S[cycle]);
      await addSymbolToWatchlist(db, ownerId, S[cycle + 10]);
      const afterAdds = await removeSymbolFromWatchlist(db, ownerId, S[cycle]);
      expect(afterAdds.map((i) => i.position)).toEqual(afterAdds.map((_, idx) => idx));
    }

    const final = await removeSymbolFromWatchlist(db, ownerId, "__never_added__");
    expect(final.map((i) => i.position)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(final.map((i) => i.position)).size).toBe(final.length);
  });
});
