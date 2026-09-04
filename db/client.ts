// Production database connection: Neon Postgres via the Pool/WebSocket
// driver, per the approved architecture. The Pool/WebSocket driver (rather
// than the HTTP driver) is required because owner mutations use interactive
// transactions (`db.transaction(...)` with `SELECT ... FOR UPDATE`).
//
// The pool is created lazily, on first use, rather than at module load.
// Next.js imports route handler modules while collecting route data at
// build time, before any request-scoped environment (like DATABASE_URL) is
// necessarily available; constructing the pool eagerly would make `next
// build` fail outside an environment with a live database configured.

import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

neonConfig.webSocketConstructor = ws;

let cached: NeonDatabase<typeof schema> | null = null;

export function getDb(): NeonDatabase<typeof schema> {
  if (cached) {
    return cached;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  const pool = new Pool({ connectionString });
  cached = drizzle(pool, { schema });
  return cached;
}
