// Loads DATABASE_URL for standalone scripts (drizzle-kit, the seed script)
// that run outside `next dev`/`next build` and so don't get Next's own env
// file loading for free. Next's own precedence is .env.local over .env;
// mirrored here with Node's built-in loader, no dependency needed.

import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}
