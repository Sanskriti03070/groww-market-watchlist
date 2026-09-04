// Capability-token identity. The token identifies an OWNER, not a
// watchlist (there is exactly one watchlist per owner - see
// docs/ENGINEERING_DECISIONS.md). Only SHA-256(token) is ever persisted;
// the plaintext token exists solely in the response body and the outgoing
// cookie the moment it is issued.

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import type { Database } from "@/db/types";
import { owners } from "@/db/schema";
import { AppError } from "@/lib/errors";

export const AUTH_COOKIE = "watchlist_token";
const TOKEN_BYTES = 32;
// Chrome/most browsers cap Max-Age at ~400 days; this is that ceiling.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/** Creates a new owner and its capability token. Never called implicitly by a GET. */
export async function createOwner(db: Database): Promise<{ token: string; ownerId: string }> {
  const token = generateToken();
  const now = new Date();
  const ownerId = randomUUID();

  await db.insert(owners).values({ id: ownerId, tokenHash: hashToken(token), createdAt: now, lastSeenAt: now });

  return { token, ownerId };
}

function extractToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match) {
      return match[1].trim();
    }
  }
  return request.cookies.get(AUTH_COOKIE)?.value ?? null;
}

export type AuthResult =
  | { ok: true; ownerId: string }
  | { ok: false; reason: "missing_credential" | "invalid_credential" };

/** Resolves the owner for a request from its bearer token or auth cookie. */
export async function resolveOwner(db: Database, request: NextRequest): Promise<AuthResult> {
  const token = extractToken(request);
  if (!token) {
    return { ok: false, reason: "missing_credential" };
  }

  const [row] = await db
    .select({ id: owners.id })
    .from(owners)
    .where(eq(owners.tokenHash, hashToken(token)))
    .limit(1);

  if (!row) {
    return { ok: false, reason: "invalid_credential" };
  }

  await db.update(owners).set({ lastSeenAt: new Date() }).where(eq(owners.id, row.id));

  return { ok: true, ownerId: row.id };
}

/** Resolves the owner or throws the matching 401 AppError. */
export async function requireOwner(db: Database, request: NextRequest): Promise<string> {
  const result = await resolveOwner(db, request);
  if (!result.ok) {
    const message =
      result.reason === "missing_credential"
        ? "A capability token is required."
        : "The provided capability token is not valid.";
    throw new AppError(401, result.reason, message);
  }
  return result.ownerId;
}
