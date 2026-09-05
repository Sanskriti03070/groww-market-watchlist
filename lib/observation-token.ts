// Opaque, HMAC-signed, server-issued tokens that let the client acknowledge
// a specific trustworthy observation without the client ever supplying a
// price. Not encrypted - the payload carries no provider data or secrets,
// just identifiers the server re-verifies against its own state on ack.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { CanonicalSymbol, Instant } from "@/lib/market-quote";

const TOKEN_TTL_MS = 10 * 60_000;

type TokenPayload = {
  ownerId: string;
  symbol: CanonicalSymbol;
  quoteFetchedAt: string;
  sessionDate: string;
  issuedAt: string;
};

function secret(): string {
  const value = process.env.OBSERVATION_TOKEN_SECRET;
  if (!value) {
    throw new Error("OBSERVATION_TOKEN_SECRET is not set.");
  }
  return value;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

export function issueObservationToken(input: {
  ownerId: string;
  symbol: CanonicalSymbol;
  quoteFetchedAt: Instant;
  sessionDate: string;
  issuedAt: Instant;
}): string {
  const payload: TokenPayload = {
    ownerId: input.ownerId,
    symbol: input.symbol,
    quoteFetchedAt: input.quoteFetchedAt.toISOString(),
    sessionDate: input.sessionDate,
    issuedAt: input.issuedAt.toISOString(),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export type VerifiedObservationToken = {
  ownerId: string;
  symbol: CanonicalSymbol;
  quoteFetchedAt: Instant;
  sessionDate: string;
};

export type TokenRejectionReason = "INVALID_SIGNATURE" | "EXPIRED";

export function verifyObservationToken(
  token: string,
  now: Instant,
): { ok: true; payload: VerifiedObservationToken } | { ok: false; reason: TokenRejectionReason } {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return { ok: false, reason: "INVALID_SIGNATURE" };
  }

  const expected = Buffer.from(sign(encodedPayload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "INVALID_SIGNATURE" };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "INVALID_SIGNATURE" };
  }

  const issuedAtMs = new Date(payload.issuedAt).getTime();
  if (!Number.isFinite(issuedAtMs) || now.getTime() - issuedAtMs > TOKEN_TTL_MS) {
    return { ok: false, reason: "EXPIRED" };
  }

  return {
    ok: true,
    payload: {
      ownerId: payload.ownerId,
      symbol: payload.symbol,
      quoteFetchedAt: new Date(payload.quoteFetchedAt),
      sessionDate: payload.sessionDate,
    },
  };
}
