// GET /api/watchlist's alert integration: alerts appear per item using
// this same request's already-fetched quote/reliability, since-last-check
// (Slice C) keeps working unchanged, and a symbol with no alerts just gets
// an empty array.

import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async () => {
  const { getTestDb } = await import("@/lib/__tests__/test-db");
  return { getDb: () => getTestDb() };
});

import { GET } from "@/app/api/watchlist/route";
import { alerts } from "@/db/schema";
import { createAlert } from "@/lib/alerts/service";
import { AUTH_COOKIE } from "@/lib/auth";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";
import { addSymbolToWatchlist } from "@/lib/watchlist";
import { createTestOwner, getTestDb } from "@/lib/__tests__/test-db";

const EQUITY_SYMBOLS = SYMBOL_UNIVERSE.filter((s) => s.kind === "EQUITY").map((s) => s.symbol);

function authed(url: string, token: string) {
  return new NextRequest(url, { headers: { cookie: `${AUTH_COOKIE}=${token}` } });
}

describe("GET /api/watchlist - alert integration", () => {
  it("attaches each symbol's alerts, and a symbol with none gets an empty array", async () => {
    const db = getTestDb();
    const withAlert = EQUITY_SYMBOLS[40];
    const withoutAlert = EQUITY_SYMBOLS[41];
    const { ownerId, token } = await createTestOwner();

    await addSymbolToWatchlist(db, ownerId, withAlert);
    await addSymbolToWatchlist(db, ownerId, withoutAlert);
    const created = await createAlert(db, {
      ownerId,
      symbol: withAlert,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    if (!created.ok) throw new Error("setup failed");

    const response = await GET(authed("http://localhost/api/watchlist", token));
    expect(response.status).toBe(200);
    const body = await response.json();

    const withAlertItem = body.items.find((item: { symbol: string }) => item.symbol === withAlert);
    const withoutAlertItem = body.items.find((item: { symbol: string }) => item.symbol === withoutAlert);

    expect(withAlertItem.alerts).toHaveLength(1);
    expect(withAlertItem.alerts[0].id).toBe(created.alert.id);
    expect(withAlertItem.alerts[0].presentation).not.toBe("TRIGGERED"); // never-evaluated quote, seeded null
    expect(withoutAlertItem.alerts).toEqual([]);

    // Since-last-check (Slice C) is untouched by the alert integration.
    expect(withAlertItem.sinceLastCheck).toBeDefined();
    expect(withoutAlertItem.sinceLastCheck).toBeDefined();
  });

  it("a DISABLED alert still appears on its (still-present) watchlist item, showing DISABLED rather than being dropped", async () => {
    const db = getTestDb();
    const symbol = EQUITY_SYMBOLS[42];
    const { ownerId, token } = await createTestOwner();
    await addSymbolToWatchlist(db, ownerId, symbol);
    const created = await createAlert(db, {
      ownerId,
      symbol,
      conditionType: "PRICE_LEVEL",
      direction: "ABOVE",
      thresholdValue: 1400,
      currentQuote: null,
    });
    if (!created.ok) throw new Error("setup failed");
    await db.update(alerts).set({ state: "DISABLED" }).where(eq(alerts.id, created.alert.id));

    const response = await GET(authed("http://localhost/api/watchlist", token));
    const body = await response.json();
    const item = body.items.find((entry: { symbol: string }) => entry.symbol === symbol);
    expect(item.alerts).toHaveLength(1);
    expect(item.alerts[0].presentation).toBe("DISABLED");
  });
});
