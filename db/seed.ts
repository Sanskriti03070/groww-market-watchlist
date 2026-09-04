// Seeds the fixed symbol universe. Idempotent: re-running updates name,
// kind, and provider_symbol for existing rows but never touches is_active,
// so deactivating a symbol survives a reseed.
//
// Usage: npm run db:seed

import "./load-env";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";
import { SYMBOL_UNIVERSE } from "@/lib/symbol-universe";

neonConfig.webSocketConstructor = ws;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });

  for (const entry of SYMBOL_UNIVERSE) {
    await db
      .insert(schema.symbols)
      .values({
        symbol: entry.symbol,
        name: entry.name,
        kind: entry.kind,
        providerSymbol: entry.providerSymbol,
      })
      .onConflictDoUpdate({
        target: schema.symbols.symbol,
        set: {
          name: entry.name,
          kind: entry.kind,
          providerSymbol: entry.providerSymbol,
        },
      });
  }

  console.log(`Seeded ${SYMBOL_UNIVERSE.length} symbols.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
