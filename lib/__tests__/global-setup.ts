// Test-only infrastructure. Spins up one real, ephemeral local Postgres
// (via `embedded-postgres`) for the whole test run, applies the actual
// Drizzle migrations against it, and seeds the real fixed symbol universe.
//
// This is deliberately a REAL Postgres, not a mock: the invariants this
// slice must prove (SELECT ... FOR UPDATE serialization, the deferrable
// UNIQUE(owner_id, position) constraint, FK/CHECK enforcement) are
// properties of Postgres itself and cannot be honestly verified against a
// fake. It is test-only tooling, not an addition to the application's
// architecture - production code only ever talks to Neon (see
// db/client.ts).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema";
import { SYMBOL_UNIVERSE } from "../symbol-universe";

const PORT = Number(process.env.TEST_PG_PORT ?? 55491);
const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../db/migrations", import.meta.url));

export const TEST_DB_INFO_FILE = path.join(tmpdir(), "groww-watchlist-test-db.json");
// Seeded inactive so tests can exercise "adding an inactive symbol is rejected".
export const INACTIVE_TEST_SYMBOL = "UPL";

export default async function setup() {
  const databaseDir = mkdtempSync(path.join(tmpdir(), "groww-watchlist-pg-"));

  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "test",
    password: "test",
    port: PORT,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase("watchlist_test");

  const connectionString = `postgres://test:test@localhost:${PORT}/watchlist_test`;
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  for (const entry of SYMBOL_UNIVERSE) {
    await db.insert(schema.symbols).values(entry);
  }
  await db
    .update(schema.symbols)
    .set({ isActive: false })
    .where(eq(schema.symbols.symbol, INACTIVE_TEST_SYMBOL));

  await pool.end();

  writeFileSync(TEST_DB_INFO_FILE, JSON.stringify({ connectionString }), "utf8");

  return async () => {
    rmSync(TEST_DB_INFO_FILE, { force: true });
    await pg.stop();
    rmSync(databaseDir, { recursive: true, force: true });
  };
}
