// Core watchlist mutation/query logic. Every mutation locks the owner row
// with SELECT ... FOR UPDATE first, so all mutations for one owner serialize
// while different owners never contend with each other.

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import type { Database } from "@/db/types";
import { owners, symbolObservations, symbols, watchlistItems } from "@/db/schema";
import {
  inactiveSymbolError,
  maxSizeExceededError,
  staleMembershipError,
  unknownSymbolError,
} from "@/lib/errors";

export const MAX_WATCHLIST_SIZE = 50;

export type WatchlistItemView = {
  symbol: string;
  position: number;
  addedAt: string;
};

/** Serializes every mutation for this owner behind a single row lock. */
async function lockOwner(tx: Database, ownerId: string): Promise<void> {
  await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, ownerId)).for("update");
}

async function readCanonical(tx: Database, ownerId: string): Promise<WatchlistItemView[]> {
  const rows = await tx
    .select({
      symbol: watchlistItems.symbol,
      position: watchlistItems.position,
      addedAt: watchlistItems.addedAt,
    })
    .from(watchlistItems)
    .where(eq(watchlistItems.ownerId, ownerId))
    .orderBy(asc(watchlistItems.position));

  return rows.map((row) => ({
    symbol: row.symbol,
    position: row.position,
    addedAt: row.addedAt.toISOString(),
  }));
}

export async function getWatchlist(db: Database, ownerId: string): Promise<WatchlistItemView[]> {
  return readCanonical(db, ownerId);
}

export async function addSymbolToWatchlist(
  db: Database,
  ownerId: string,
  symbol: string,
): Promise<WatchlistItemView[]> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const current = await tx
      .select({ symbol: watchlistItems.symbol })
      .from(watchlistItems)
      .where(eq(watchlistItems.ownerId, ownerId));

    // Idempotent: already on the watchlist, nothing to do.
    if (current.some((row) => row.symbol === symbol)) {
      return readCanonical(tx, ownerId);
    }

    if (current.length >= MAX_WATCHLIST_SIZE) {
      throw maxSizeExceededError(MAX_WATCHLIST_SIZE);
    }

    const [reference] = await tx
      .select({ isActive: symbols.isActive })
      .from(symbols)
      .where(eq(symbols.symbol, symbol))
      .limit(1);

    if (!reference) {
      throw unknownSymbolError(symbol);
    }
    if (!reference.isActive) {
      throw inactiveSymbolError(symbol);
    }

    await tx.insert(watchlistItems).values({
      id: randomUUID(),
      ownerId,
      symbol,
      position: current.length,
      addedAt: new Date(),
    });

    return readCanonical(tx, ownerId);
  });
}

export async function removeSymbolFromWatchlist(
  db: Database,
  ownerId: string,
  symbol: string,
): Promise<WatchlistItemView[]> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const [removed] = await tx
      .delete(watchlistItems)
      .where(and(eq(watchlistItems.ownerId, ownerId), eq(watchlistItems.symbol, symbol)))
      .returning({ position: watchlistItems.position });

    // Idempotent: already absent, nothing to compact or clean up.
    if (removed) {
      // Compact positions to stay dense (0..n-1). This single statement can
      // transiently re-derive a value another untouched row already holds
      // while Postgres is processing rows internally; the (owner_id,
      // position) constraint is DEFERRABLE INITIALLY DEFERRED specifically
      // so that is checked only at commit, not per row.
      await tx
        .update(watchlistItems)
        .set({ position: sql`${watchlistItems.position} - 1` })
        .where(and(eq(watchlistItems.ownerId, ownerId), gt(watchlistItems.position, removed.position)));

      // A removed symbol's since-last-check baseline never survives the
      // removal - re-adding it later starts a fresh lifecycle (NO_BASELINE).
      await tx
        .delete(symbolObservations)
        .where(and(eq(symbolObservations.ownerId, ownerId), eq(symbolObservations.symbol, symbol)));
    }

    return readCanonical(tx, ownerId);
  });
}

export async function reorderWatchlist(
  db: Database,
  ownerId: string,
  desiredSymbols: string[],
): Promise<WatchlistItemView[]> {
  return db.transaction(async (tx) => {
    await lockOwner(tx, ownerId);

    const current = await tx
      .select({ symbol: watchlistItems.symbol })
      .from(watchlistItems)
      .where(eq(watchlistItems.ownerId, ownerId));

    if (!isExactPermutation(current.map((row) => row.symbol), desiredSymbols)) {
      throw staleMembershipError();
    }

    // Same reason as the REMOVE compaction: positions are rewritten one at a
    // time inside a transaction whose (owner_id, position) uniqueness is
    // deferred to commit, so intermediate collisions are not a problem.
    for (let position = 0; position < desiredSymbols.length; position += 1) {
      await tx
        .update(watchlistItems)
        .set({ position })
        .where(and(eq(watchlistItems.ownerId, ownerId), eq(watchlistItems.symbol, desiredSymbols[position])));
    }

    return readCanonical(tx, ownerId);
  });
}

function isExactPermutation(current: string[], desired: string[]): boolean {
  if (current.length !== desired.length) {
    return false;
  }
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  if (desiredSet.size !== desired.length) {
    // Caller is expected to have already rejected duplicates as invalid
    // input (422); treated as non-permutation here as a defensive fallback.
    return false;
  }
  for (const symbol of currentSet) {
    if (!desiredSet.has(symbol)) {
      return false;
    }
  }
  return true;
}
