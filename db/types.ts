// A driver-agnostic type for the query surface `lib/watchlist.ts` needs.
// Production code passes the Neon Pool/WebSocket-backed instance from
// `db/client.ts`; tests pass a node-postgres-backed instance pointed at a
// real local Postgres (see lib/__tests__/test-db.ts). Both are
// `drizzle-orm/pg-core` databases against the same schema and the same SQL
// dialect, so business logic is written once against this shared shape.

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;
