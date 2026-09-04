import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { createTestOwner, getTestDb } from "./test-db";
import { addSymbolToWatchlist, getWatchlist } from "@/lib/watchlist";
import { symbols } from "@/db/schema";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";

const TOGGLE_SYMBOL = SYMBOL_UNIVERSE[0].symbol;

async function setActive(active: boolean) {
  await getTestDb().update(symbols).set({ isActive: active }).where(eq(symbols.symbol, TOGGLE_SYMBOL));
}

describe("reference data", () => {
  afterEach(async () => {
    await setActive(true); // restore, this symbol is shared seed data
  });

  it("a symbol already on the watchlist stays resolvable after it becomes inactive", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();

    await addSymbolToWatchlist(db, ownerId, TOGGLE_SYMBOL);
    await setActive(false);

    const items = await getWatchlist(db, ownerId);
    expect(items.map((i) => i.symbol)).toEqual([TOGGLE_SYMBOL]);
  });

  it("an inactive symbol cannot be newly added, even by a different owner", async () => {
    const db = getTestDb();
    const { ownerId } = await createTestOwner();
    await setActive(false);

    await expect(addSymbolToWatchlist(db, ownerId, TOGGLE_SYMBOL)).rejects.toMatchObject({
      status: 422,
      code: "inactive_symbol",
    });
  });
});
