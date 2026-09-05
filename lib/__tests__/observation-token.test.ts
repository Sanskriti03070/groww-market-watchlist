process.env.OBSERVATION_TOKEN_SECRET = "test-secret-do-not-use-in-production";

import { describe, expect, it } from "vitest";
import { issueObservationToken, verifyObservationToken } from "@/lib/observation-token";

const issuedAt = new Date("2026-06-03T05:00:00.000Z");
const quoteFetchedAt = new Date("2026-06-03T04:55:00.000Z");

function makeToken() {
  return issueObservationToken({ ownerId: "owner-1", symbol: "RELIANCE", quoteFetchedAt, sessionDate: "2026-06-03", issuedAt });
}

describe("observation tokens", () => {
  it("round-trips a valid token", () => {
    const token = makeToken();
    const result = verifyObservationToken(token, issuedAt);
    expect(result).toEqual({
      ok: true,
      payload: { ownerId: "owner-1", symbol: "RELIANCE", quoteFetchedAt, sessionDate: "2026-06-03" },
    });
  });

  it("rejects a token past its 10 minute expiry", () => {
    const token = makeToken();
    const justAfterExpiry = new Date(issuedAt.getTime() + 10 * 60_000 + 1);
    expect(verifyObservationToken(token, justAfterExpiry)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("accepts a token at exactly the expiry boundary", () => {
    const token = makeToken();
    const atExpiry = new Date(issuedAt.getTime() + 10 * 60_000);
    expect(verifyObservationToken(token, atExpiry).ok).toBe(true);
  });

  it("rejects a token whose payload was tampered with", () => {
    const token = makeToken();
    const [encodedPayload, signature] = token.split(".");
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    payload.symbol = "TCS"; // attacker tries to redirect the ack to a different symbol
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const tampered = `${tamperedPayload}.${signature}`;

    expect(verifyObservationToken(tampered, issuedAt)).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("rejects a token with a garbage signature", () => {
    const [encodedPayload] = makeToken().split(".");
    expect(verifyObservationToken(`${encodedPayload}.not-a-real-signature`, issuedAt)).toEqual({
      ok: false,
      reason: "INVALID_SIGNATURE",
    });
  });

  it("rejects a malformed token shape", () => {
    expect(verifyObservationToken("not-a-token", issuedAt)).toEqual({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  // Owner-mismatch itself is enforced by the caller (compare payload.ownerId
  // to the authenticated capability owner) - this proves the payload
  // carries the real owner unmodified for that check to be meaningful.
  it("carries the issuing owner in the verified payload, unmodifiable without invalidating the signature", () => {
    const result = verifyObservationToken(makeToken(), issuedAt);
    expect(result.ok && result.payload.ownerId).toBe("owner-1");
  });
});
