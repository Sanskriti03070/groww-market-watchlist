// POST /api/observations/ack - acknowledges one or more since-last-check
// observation tokens, advancing each symbol's baseline. Never trusts a
// client-supplied price: the price always comes from a fresh server-side
// read of the quotes row, verified against what the token was issued for.

import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handleRoute, jsonResponse, readJsonBody } from "@/lib/http";
import { getQuotesForSymbols } from "@/lib/db/quotes-repo";
import { upsertObservationIfNewer } from "@/lib/db/observations-repo";
import { verifyObservationToken, type TokenRejectionReason } from "@/lib/observation-token";
import { istCalendarDateOf } from "@/lib/nse-session-calendar";

const MAX_TOKENS = 100;

type RejectionReason = TokenRejectionReason | "SUPERSEDED" | "OWNER_MISMATCH";

function parseAckBody(body: unknown): { tokens: string[] } | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const { tokens } = body as Record<string, unknown>;
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > MAX_TOKENS) {
    return null;
  }
  if (!tokens.every((token) => typeof token === "string" && token.length > 0)) {
    return null;
  }
  return { tokens };
}

export async function POST(request: NextRequest) {
  return handleRoute(async () => {
    const db = getDb();
    const ownerId = await requireOwner(db, request);

    const body = parseAckBody(await readJsonBody(request));
    if (!body) {
      throw new AppError(422, "invalid_body", 'Expected a JSON body shaped { "tokens": string[] }, up to 100 tokens.');
    }

    const now = new Date();
    const rejected: { token: string; reason: RejectionReason }[] = [];
    const verified: { token: string; symbol: string; quoteFetchedAt: Date }[] = [];

    for (const token of body.tokens) {
      const result = verifyObservationToken(token, now);
      if (!result.ok) {
        rejected.push({ token, reason: result.reason });
        continue;
      }
      if (result.payload.ownerId !== ownerId) {
        rejected.push({ token, reason: "OWNER_MISMATCH" });
        continue;
      }
      verified.push({ token, symbol: result.payload.symbol, quoteFetchedAt: result.payload.quoteFetchedAt });
    }

    const acknowledged: string[] = [];

    if (verified.length > 0) {
      const symbols = [...new Set(verified.map((item) => item.symbol))];
      const currentQuotes = await getQuotesForSymbols(db, symbols); // never trust the token/client for price

      await db.transaction(async (tx) => {
        for (const item of verified) {
          const currentQuote = currentQuotes.get(item.symbol);
          // The quote has moved on since this token was issued - not an
          // error, just stale; the next render will offer a fresh token.
          if (!currentQuote || currentQuote.fetchedAt.getTime() !== item.quoteFetchedAt.getTime()) {
            rejected.push({ token: item.token, reason: "SUPERSEDED" });
            continue;
          }

          // Idempotent regardless of whether this call actually advances
          // the row: the baseline ends up at or beyond this observation
          // either way, which is what acknowledging it means.
          await upsertObservationIfNewer(tx, {
            ownerId,
            symbol: item.symbol,
            baselinePrice: currentQuote.lastPrice,
            observedAt: now,
            quoteFetchedAt: currentQuote.fetchedAt,
            sessionDate: istCalendarDateOf(currentQuote.fetchedAt),
          });
          acknowledged.push(item.token);
        }
      });
    }

    return jsonResponse({ acknowledged, rejected });
  });
}
