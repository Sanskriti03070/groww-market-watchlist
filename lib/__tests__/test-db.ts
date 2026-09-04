// Per-test-file connection to the shared embedded Postgres started by
// global-setup.ts, plus small helpers for building isolated test fixtures.
// Each test creates its own owner so tests never need to share or reset
// state between each other.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema";
import type { Database } from "../../db/types";
import { hashToken } from "../auth";
import { TEST_DB_INFO_FILE } from "./global-setup";

let pool: Pool | undefined;
let db: Database | undefined;

export function getTestDb(): Database {
  if (!db) {
    const { connectionString } = JSON.parse(readFileSync(TEST_DB_INFO_FILE, "utf8")) as {
      connectionString: string;
    };
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema }) as unknown as Database;
  }
  return db;
}

/** Inserts a fresh owner directly, bypassing the HTTP token-issuing flow. */
export async function createTestOwner(testDb: Database = getTestDb()): Promise<{
  ownerId: string;
  token: string;
}> {
  const token = `test-token-${randomUUID()}`;
  const ownerId = randomUUID();
  const now = new Date();
  await testDb.insert(schema.owners).values({
    id: ownerId,
    tokenHash: hashToken(token),
    createdAt: now,
    lastSeenAt: now,
  });
  return { ownerId, token };
}
