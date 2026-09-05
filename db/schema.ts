// Drizzle schema for Slice A: owner identity, the fixed symbol universe, and
// the single per-owner watchlist. See docs/ENGINEERING_DECISIONS.md for why
// there is no `watchlists` table.

import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
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

// One row per canonical symbol, overwritten on every refresh. There is
// deliberately no status/reliability column here: LIVE/STALE/UNAVAILABLE is
// derived at read time from fetched_at plus session state, never stored.
export const quotes = pgTable(
  "quotes",
  {
    symbol: text("symbol")
      .primaryKey()
      .references(() => symbols.symbol, { onDelete: "restrict" }),
    lastPrice: numeric("last_price", { precision: 14, scale: 4 }).notNull(),
    previousClose: numeric("previous_close", {
      precision: 14,
      scale: 4,
    }).notNull(),
    dayOpen: numeric("day_open", { precision: 14, scale: 4 }),
    dayHigh: numeric("day_high", { precision: 14, scale: 4 }),
    dayLow: numeric("day_low", { precision: 14, scale: 4 }),
    weekHigh52: numeric("week_high_52", { precision: 14, scale: 4 }),
    weekLow52: numeric("week_low_52", { precision: 14, scale: 4 }),
    volume: bigint("volume", { mode: "number" }),
    providerTs: timestamp("provider_ts", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  },
  (table) => [
    check("quotes_last_price_check", sql`${table.lastPrice} > 0`),
    check("quotes_previous_close_check", sql`${table.previousClose} > 0`),
  ],
);

// Singleton row (id is always 'global') holding the shared poller's lease
// and cycle/backoff state. The CHECK, not application code, is what
// prevents a second row from ever existing.
export const marketRefreshState = pgTable(
  "market_refresh_state",
  {
    id: text("id").primaryKey(),
    leaseHolder: text("lease_holder"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    cycleStartedAt: timestamp("cycle_started_at", { withTimezone: true }),
    cycleCompletedAt: timestamp("cycle_completed_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    backoffUntil: timestamp("backoff_until", { withTimezone: true }),
  },
  (table) => [check("market_refresh_state_id_check", sql`${table.id} = 'global'`)],
);

// One row per (owner, symbol): the baseline the owner last acknowledged
// seeing. Only ever written from a trustworthy (LIVE/LAST_CLOSE) quote - see
// docs/ENGINEERING_DECISIONS.md. No history: a new acknowledgement replaces
// the baseline outright, and removing the symbol deletes the row.
export const symbolObservations = pgTable(
  "symbol_observations",
  {
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "restrict" }),
    baselinePrice: numeric("baseline_price", { precision: 14, scale: 4 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    quoteFetchedAt: timestamp("quote_fetched_at", { withTimezone: true }).notNull(),
    sessionDate: date("session_date").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ownerId, table.symbol] }),
    check("symbol_observations_baseline_price_check", sql`${table.baselinePrice} > 0`),
  ],
);

// -1 = below the configured side, +1 = at/above it. Shared by alerts.last_side
// and alert_triggers.previous_side/new_side so the state machine and its
// trigger history use one consistent encoding.
export const alertConditionType = pgEnum("alert_condition_type", ["PRICE_LEVEL", "DAY_MOVE"]);
export const alertDirection = pgEnum("alert_direction", ["ABOVE", "BELOW", "UP", "DOWN"]);
export const alertState = pgEnum("alert_state", ["ACTIVE", "TRIGGERED", "DISABLED"]);

// A crossing is a transition, not a property of one quote - last_side is
// the side observed as of last_evaluated_quote_at, and only a transition
// into the configured side produces a row in alert_triggers. HIGHLIGHTED is
// derived at read time (D3) and is never a column here.
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "restrict" }),
    conditionType: alertConditionType("condition_type").notNull(),
    direction: alertDirection("direction").notNull(),
    thresholdValue: numeric("threshold_value", { precision: 14, scale: 4 }).notNull(),
    state: alertState("state").notNull().default("ACTIVE"),
    lastSide: smallint("last_side"),
    lastEvaluatedQuoteAt: timestamp("last_evaluated_quote_at", { withTimezone: true }),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("alerts_threshold_value_check", sql`${table.thresholdValue} > 0`),
    check("alerts_last_side_check", sql`${table.lastSide} is null or ${table.lastSide} in (-1, 1)`),
    check(
      "alerts_direction_matches_condition_type_check",
      sql`(${table.conditionType} = 'PRICE_LEVEL' and ${table.direction} in ('ABOVE', 'BELOW')) or (${table.conditionType} = 'DAY_MOVE' and ${table.direction} in ('UP', 'DOWN'))`,
    ),
    index("alerts_owner_id_idx").on(table.ownerId),
    // Evaluation reads "non-disabled alerts for symbol X" - a partial index
    // keyed on that exact shape, rather than a general (symbol, state) index.
    index("alerts_symbol_evaluation_idx")
      .on(table.symbol)
      .where(sql`${table.state} <> 'DISABLED'`),
  ],
);

// One row per FALSE->TRUE crossing. Structured facts only, not UI copy.
// quote_fetched_at is the observation that caused the trigger, and
// UNIQUE(alert_id, quote_fetched_at) is what makes "at most one trigger per
// crossing" a database guarantee rather than an application promise.
export const alertTriggers = pgTable(
  "alert_triggers",
  {
    id: uuid("id").primaryKey(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alerts.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id, { onDelete: "cascade" }),
    symbol: text("symbol")
      .notNull()
      .references(() => symbols.symbol, { onDelete: "restrict" }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull(),
    quoteFetchedAt: timestamp("quote_fetched_at", { withTimezone: true }).notNull(),
    observedPrice: numeric("observed_price", { precision: 14, scale: 4 }).notNull(),
    thresholdValue: numeric("threshold_value", { precision: 14, scale: 4 }).notNull(),
    conditionType: alertConditionType("condition_type").notNull(),
    direction: alertDirection("direction").notNull(),
    previousSide: smallint("previous_side").notNull(),
    newSide: smallint("new_side").notNull(),
    dayChangePercent: numeric("day_change_percent", { precision: 14, scale: 4 }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  },
  (table) => [
    unique("alert_triggers_alert_id_quote_fetched_at_unique").on(table.alertId, table.quoteFetchedAt),
    check("alert_triggers_observed_price_check", sql`${table.observedPrice} > 0`),
    check("alert_triggers_threshold_value_check", sql`${table.thresholdValue} > 0`),
    check("alert_triggers_previous_side_check", sql`${table.previousSide} in (-1, 1)`),
    check("alert_triggers_new_side_check", sql`${table.newSide} in (-1, 1)`),
    index("alert_triggers_alert_id_idx").on(table.alertId),
    index("alert_triggers_owner_id_idx").on(table.ownerId),
  ],
);
