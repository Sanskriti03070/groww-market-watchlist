// Writing `symbol_observations`. Reads happen through the joined query in
// lib/db/quotes-repo.ts (getWatchlistWithQuotes) - there is no separate
// read path here because GET /api/watchlist is the only reader.

import { sql } from "drizzle-orm";
import type { Database } from "@/db/types";
import { symbolObservations } from "@/db/schema";
import type { CanonicalSymbol, Instant } from "@/lib/market-quote";

/**
 * Inserts the observation, or updates it only when the incoming
 * quoteFetchedAt is strictly newer than what's stored. This is the
 * monotonic rule that makes acknowledgement safe under retries, duplicate
 * tabs, and reordered requests: an older observation can never overwrite a
 * newer one. Returns whether the row actually advanced.
 */
export async function upsertObservationIfNewer(
  db: Database,
  input: {
    ownerId: string;
    symbol: CanonicalSymbol;
    baselinePrice: string;
    observedAt: Instant;
    quoteFetchedAt: Instant;
    sessionDate: string;
  },
): Promise<boolean> {
  const values = {
    ownerId: input.ownerId,
    symbol: input.symbol,
    baselinePrice: input.baselinePrice,
    observedAt: input.observedAt,
    quoteFetchedAt: input.quoteFetchedAt,
    sessionDate: input.sessionDate,
  };

  const result = await db
    .insert(symbolObservations)
    .values(values)
    .onConflictDoUpdate({
      target: [symbolObservations.ownerId, symbolObservations.symbol],
      set: values,
      setWhere: sql`${symbolObservations.quoteFetchedAt} < excluded.quote_fetched_at`,
    })
    .returning({ symbol: symbolObservations.symbol });

  return result.length > 0;
}
