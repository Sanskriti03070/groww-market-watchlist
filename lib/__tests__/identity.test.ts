import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createOwner, resolveOwner } from "@/lib/auth";
import { createTestOwner, getTestDb } from "./test-db";

function requestWithCookie(token: string) {
  return new NextRequest("http://localhost/api/watchlist", {
    headers: token ? { cookie: `watchlist_token=${token}` } : {},
  });
}

function requestWithBearer(token: string) {
  return new NextRequest("http://localhost/api/watchlist", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("identity", () => {
  it("rejects a request with no credential at all", async () => {
    const result = await resolveOwner(getTestDb(), requestWithCookie(""));
    expect(result).toEqual({ ok: false, reason: "missing_credential" });
  });

  it("rejects a well-formed but unknown token", async () => {
    const result = await resolveOwner(getTestDb(), requestWithCookie("not-a-real-token"));
    expect(result).toEqual({ ok: false, reason: "invalid_credential" });
  });

  it("creates an owner with a token that then resolves via cookie", async () => {
    const { token, ownerId } = await createOwner(getTestDb());
    expect(token).toBeTruthy();
    expect(ownerId).toBeTruthy();

    const result = await resolveOwner(getTestDb(), requestWithCookie(token));
    expect(result).toEqual({ ok: true, ownerId });
  });

  it("resolves an owner via the Authorization bearer header too", async () => {
    const { token, ownerId } = await createTestOwner();
    const result = await resolveOwner(getTestDb(), requestWithBearer(token));
    expect(result).toEqual({ ok: true, ownerId });
  });

  it("two calls to createOwner never collide on the same token", async () => {
    const a = await createOwner(getTestDb());
    const b = await createOwner(getTestDb());
    expect(a.token).not.toEqual(b.token);
    expect(a.ownerId).not.toEqual(b.ownerId);
  });
});
