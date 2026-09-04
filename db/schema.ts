// Drizzle schema for Slice A: owner identity, the fixed symbol universe, and
// the single per-owner watchlist. See docs/ENGINEERING_DECISIONS.md for why
// there is no `watchlists` table.

import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Postgres `bytea`. Drizzle has no built-in bytea column, so it is defined as
// a custom type mapping directly to/from a Node Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const symbolKind = pgEnum("symbol_kind", ["EQUITY", "INDEX"]);

export const owners = pgTable("owners", {
  id: uuid("id").primaryKey(),
  tokenHash: bytea("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
});

export const symbols = pgTable("symbols", {
  symbol: text("symbol").primaryKey(),
  name: text("name").notNull(),
  kind: symbolKind("kind").notNull(),
  providerSymbol: text("provider_symbol").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("watchlist_items_owner_id_symbol_unique").on(
      table.ownerId,
      table.symbol,
    ),
    // The (owner_id, position) uniqueness constraint must be DEFERRABLE
    // INITIALLY DEFERRED so a reorder can write a whole new permutation of
    // positions inside one transaction without transiently colliding on the
    // old values. Drizzle's `unique()` builder cannot express DEFERRABLE, so
    // this constraint is declared here for type/introspection purposes and
    // is re-created as deferrable by a hand-written migration statement
    // (see db/migrations/0001_deferrable_position_unique.sql). Do not rely
    // on the constraint this line generates being the one actually enforced
    // in the database.
    unique("watchlist_items_owner_id_position_unique").on(
      table.ownerId,
      table.position,
    ),
    check("watchlist_items_position_check", sql`${table.position} >= 0`),
    index("watchlist_items_owner_id_position_idx").on(
      table.ownerId,
      table.position,
    ),
  ],
);
