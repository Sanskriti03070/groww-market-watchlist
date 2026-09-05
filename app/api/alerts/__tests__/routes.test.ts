// HTTP-level tests for the alert API. getDb() is redirected to the shared
// embedded-postgres test database so the real route handlers, real auth,
// and real Zod validation all run against it - nothing here is mocked
// beyond that one connection swap.

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", async () => {
  const { getTestDb } = await import("@/lib/__tests__/test-db");
  return { getDb: () => getTestDb() };
});

import { DELETE, PATCH } from "@/app/api/alerts/[id]/route";
import { POST as DISABLE } from "@/app/api/alerts/[id]/disable/route";
import { POST as DISMISS } from "@/app/api/alerts/[id]/dismiss/route";
import { POST as ENABLE } from "@/app/api/alerts/[id]/enable/route";
import { GET, POST } from "@/app/api/alerts/route";
import { alerts, owners } from "@/db/schema";
import type { Database } from "@/db/types";
import * as alertsRepo from "@/lib/alerts/repo";
import { AUTH_COOKIE, hashToken } from "@/lib/auth";
import { getDatabaseNow, upsertSuccessfulQuote } from "@/lib/db/quotes-repo";
import { getSessionSnapshot } from "@/lib/nse-session-calendar";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";
import { addSymbolToWatchlist } from "@/lib/watchlist";
import { createTestOwner, getTestDb } from "@/lib/__tests__/test-db";

const EQUITY_SYMBOLS = SYMBOL_UNIVERSE.filter((s) => s.kind === "EQUITY").map((s) => s.symbol);
const ALERTS_URL = "http://localhost/api/alerts";

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

function authed(url: string, token: string, init: { method?: string; body?: string; headers?: HeadersInit } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `${AUTH_COOKIE}=${token}`);
  return new NextRequest(url, { method: init.method, body: init.body, headers });
}

function jsonRequest(url: string, token: string, method: string, body: unknown) {
  return authed(url, token, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function ownerWithSymbol(symbol: string) {
  const db = getTestDb();
  const { ownerId, token } = await createTestOwner();
  await addSymbolToWatchlist(db, ownerId, symbol);
  return { db, ownerId, token };
}

async function ownerIdForToken(db: Database, token: string): Promise<string> {
  const [row] = await db.select({ id: owners.id }).from(owners).where(eq(owners.tokenHash, hashToken(token)));
  if (!row) throw new Error("test setup: token not found");
  return row.id;
}

async function createViaApi(token: string, body: unknown) {
  const response = await POST(jsonRequest(ALERTS_URL, token, "POST", body));
  return { status: response.status, body: await response.json() };
}

let symbolIndex = 30;
function freshSymbol() {
  return EQUITY_SYMBOLS[symbolIndex++];
}

describe("auth", () => {
  it("rejects every alert endpoint with no credential", async () => {
    const id = randomUUID();
    expect((await GET(new NextRequest(ALERTS_URL))).status).toBe(401);
    expect((await POST(new NextRequest(ALERTS_URL, { method: "POST" }))).status).toBe(401);
    expect((await PATCH(new NextRequest(`${ALERTS_URL}/${id}`, { method: "PATCH" }), withId(id))).status).toBe(401);
    expect((await DELETE(new NextRequest(`${ALERTS_URL}/${id}`, { method: "DELETE" }), withId(id))).status).toBe(401);
    expect((await ENABLE(new NextRequest(`${ALERTS_URL}/${id}/enable`, { method: "POST" }), withId(id))).status).toBe(401);
  });
});

describe("owner isolation", () => {
  it("another owner's token can neither read, edit, enable, disable, dismiss, nor delete the alert", async () => {
    const symbol = freshSymbol();
    const { token: ownerAToken } = await ownerWithSymbol(symbol);
    const created = await createViaApi(ownerAToken, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    expect(created.status).toBe(201);
    const id = created.body.alert.id;

    const { token: ownerBToken } = await createTestOwner();

    expect(
      (
        await PATCH(
          jsonRequest(`${ALERTS_URL}/${id}`, ownerBToken, "PATCH", { expectedVersion: 0, thresholdValue: 1500, direction: "ABOVE" }),
          withId(id),
        )
      ).status,
    ).toBe(404);
    expect((await ENABLE(authed(`${ALERTS_URL}/${id}/enable`, ownerBToken, { method: "POST" }), withId(id))).status).toBe(404);
    expect((await DISABLE(authed(`${ALERTS_URL}/${id}/disable`, ownerBToken, { method: "POST" }), withId(id))).status).toBe(404);
    expect((await DISMISS(authed(`${ALERTS_URL}/${id}/dismiss`, ownerBToken, { method: "POST" }), withId(id))).status).toBe(404);
    expect((await DELETE(authed(`${ALERTS_URL}/${id}`, ownerBToken, { method: "DELETE" }), withId(id))).status).toBe(404);

    // Owner A's own alert is untouched by every rejected attempt above.
    const list = await GET(authed(ALERTS_URL, ownerAToken));
    const listBody = await list.json();
    expect(listBody.alerts).toHaveLength(1);
    expect(listBody.alerts[0].id).toBe(id);
  });
});

describe("tampered ids", () => {
  it("a non-UUID id behaves as not-found, not a validation error", async () => {
    const { token } = await createTestOwner();
    expect(
      (
        await PATCH(
          jsonRequest(`${ALERTS_URL}/not-a-uuid`, token, "PATCH", { expectedVersion: 0, thresholdValue: 10, direction: "ABOVE" }),
          withId("not-a-uuid"),
        )
      ).status,
    ).toBe(404);
    expect((await DELETE(authed(`${ALERTS_URL}/not-a-uuid`, token, { method: "DELETE" }), withId("not-a-uuid"))).status).toBe(404);
  });

  it("a well-formed but unowned/nonexistent UUID is also not-found", async () => {
    const { token } = await createTestOwner();
    const id = randomUUID();
    expect((await DELETE(authed(`${ALERTS_URL}/${id}`, token, { method: "DELETE" }), withId(id))).status).toBe(404);
  });
});

describe("create validation, caps, and watchlist membership", () => {
  it("rejects a malformed body with 422 (Zod)", async () => {
    const { token } = await createTestOwner();
    const result = await createViaApi(token, { symbol: "RELIANCE", conditionType: "NOT_A_TYPE", direction: "ABOVE", thresholdValue: 10 });
    expect(result.status).toBe(422);
  });

  it("rejects a symbol not on the caller's watchlist with 422", async () => {
    const { token } = await createTestOwner();
    const symbol = freshSymbol();
    const result = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 10 });
    expect(result.status).toBe(422);
  });

  it("rejects a non-positive threshold and an out-of-range DAY_MOVE threshold with 422", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    expect((await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 0 })).status).toBe(422);
    expect((await createViaApi(token, { symbol, conditionType: "DAY_MOVE", direction: "UP", thresholdValue: 51 })).status).toBe(422);
  });

  it("enforces the 5-per-symbol cap with 409", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    for (let i = 0; i < 5; i++) {
      const result = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1000 + i });
      expect(result.status).toBe(201);
    }
    const sixth = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 2000 });
    expect(sixth.status).toBe(409);
  });

  it("allows duplicate alert configurations on the same symbol", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    const first = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const second = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.alert.id).not.toBe(second.body.alert.id);
  });
});

describe("create seeds from the current trustworthy quote without ever triggering immediately", () => {
  it("a quote already on the trigger side seeds the alert but does not create a trigger", async () => {
    const symbol = freshSymbol();
    const { db, token } = await ownerWithSymbol(symbol);

    const now = await getDatabaseNow(db);
    const session = getSessionSnapshot(now);
    const fetchedAt = session.state === "OPEN" ? now : new Date((session.lastCompleted?.close.getTime() ?? now.getTime()) - 30_000);
    await upsertSuccessfulQuote(db, {
      symbol,
      lastPrice: "1450.0000",
      previousClose: "1400.0000",
      dayOpen: null,
      dayHigh: null,
      dayLow: null,
      weekHigh52: null,
      weekLow52: null,
      volume: null,
      providerTs: null,
      fetchedAt,
    });

    const result = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1500 });
    expect(result.status).toBe(201);
    expect(result.body.alert.presentation).not.toBe("TRIGGERED");

    const ownerId = await ownerIdForToken(db, token);
    const triggers = await alertsRepo.listTriggersByAlert(db, ownerId, result.body.alert.id);
    expect(triggers).toHaveLength(0);
  });
});

describe("edit", () => {
  it("edits with a matching version, reseeds, and returns ACTIVE; a stale version is a 409 and changes nothing", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    const created = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const id = created.body.alert.id;
    const version = created.body.alert.version;

    const conflict = await PATCH(
      jsonRequest(`${ALERTS_URL}/${id}`, token, "PATCH", { expectedVersion: version + 1, thresholdValue: 1500, direction: "ABOVE" }),
      withId(id),
    );
    expect(conflict.status).toBe(409);

    const edited = await PATCH(
      jsonRequest(`${ALERTS_URL}/${id}`, token, "PATCH", { expectedVersion: version, thresholdValue: 1500, direction: "BELOW" }),
      withId(id),
    );
    expect(edited.status).toBe(200);
    const editedBody = await edited.json();
    expect(editedBody.alert.direction).toBe("BELOW");
    expect(editedBody.alert.thresholdValue).toBe("1500.0000");
    expect(editedBody.alert.presentation).not.toBe("TRIGGERED");
    expect(editedBody.alert.version).toBe(version + 1);
  });

  it("rejects an invalid edit body with 422", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    const created = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const id = created.body.alert.id;

    const result = await PATCH(
      jsonRequest(`${ALERTS_URL}/${id}`, token, "PATCH", { expectedVersion: "0", thresholdValue: 1500, direction: "ABOVE" }),
      withId(id),
    );
    expect(result.status).toBe(422);
  });
});

describe("enable/disable", () => {
  it("disable freezes the alert; enable reseeds and returns it to ACTIVE", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    const created = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const id = created.body.alert.id;

    const disabled = await DISABLE(authed(`${ALERTS_URL}/${id}/disable`, token, { method: "POST" }), withId(id));
    expect(disabled.status).toBe(200);
    expect((await disabled.json()).alert.presentation).toBe("DISABLED");

    const enabled = await ENABLE(authed(`${ALERTS_URL}/${id}/enable`, token, { method: "POST" }), withId(id));
    expect(enabled.status).toBe(200);
    const enabledBody = await enabled.json();
    expect(enabledBody.alert.presentation).not.toBe("DISABLED");
  });
});

describe("dismiss", () => {
  it("is idempotent and returns the alert to ACTIVE", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    const created = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const id = created.body.alert.id;

    const first = await DISMISS(authed(`${ALERTS_URL}/${id}/dismiss`, token, { method: "POST" }), withId(id));
    expect(first.status).toBe(200);
    const second = await DISMISS(authed(`${ALERTS_URL}/${id}/dismiss`, token, { method: "POST" }), withId(id));
    expect(second.status).toBe(200);
    expect((await second.json()).alert.presentation).not.toBe("TRIGGERED");
  });
});

describe("delete", () => {
  it("removes the alert and cascades its trigger history", async () => {
    const symbol = freshSymbol();
    const { db, token } = await ownerWithSymbol(symbol);
    const created = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const id = created.body.alert.id;
    const ownerId = await ownerIdForToken(db, token);

    await alertsRepo.insertAlertTriggerIfNew(db, {
      id: randomUUID(),
      alertId: id,
      ownerId,
      symbol,
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

    const result = await DELETE(authed(`${ALERTS_URL}/${id}`, token, { method: "DELETE" }), withId(id));
    expect(result.status).toBe(200);

    const remaining = await alertsRepo.listTriggersByAlert(db, ownerId, id);
    expect(remaining).toHaveLength(0);
    expect(await alertsRepo.getAlertById(db, ownerId, id)).toBeNull();
  });
});

describe("filters and sort via HTTP", () => {
  it("filter=triggered returns only alerts with an unacknowledged trigger", async () => {
    const symbol = freshSymbol();
    const { db, token } = await ownerWithSymbol(symbol);
    const created = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const id = created.body.alert.id;
    await db.update(alerts).set({ state: "TRIGGERED", lastSide: 1 }).where(eq(alerts.id, id));

    const untriggered = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "BELOW", thresholdValue: 100 });
    expect(untriggered.status).toBe(201);

    const filtered = await GET(authed(`${ALERTS_URL}?filter=triggered`, token));
    const body = await filtered.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].id).toBe(id);
  });

  it("rejects an unrecognized sort/filter value with 422", async () => {
    const { token } = await createTestOwner();
    const result = await GET(authed(`${ALERTS_URL}?sort=bogus`, token));
    expect(result.status).toBe(422);
  });
});

describe("response shape never leaks internal or provider fields", () => {
  it("the alert view exposes only the locked fields", async () => {
    const symbol = freshSymbol();
    const { token } = await ownerWithSymbol(symbol);
    const created = await createViaApi(token, { symbol, conditionType: "PRICE_LEVEL", direction: "ABOVE", thresholdValue: 1400 });
    const keys = Object.keys(created.body.alert).sort();
    expect(keys).toEqual(
      [
        "conditionType",
        "createdAt",
        "direction",
        "distancePercent",
        "hasUnacknowledgedTrigger",
        "id",
        "lastTriggeredAt",
        "presentation",
        "symbol",
        "thresholdValue",
        "updatedAt",
        "version",
      ].sort(),
    );
  });
});
