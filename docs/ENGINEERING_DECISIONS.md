# Engineering Decisions

### 1. PostgreSQL is the source of truth
**Context:** The watchlist must stay consistent across reloads, sessions, and multiple tabs.\
**Choice:** PostgreSQL owns watchlist membership and order. Mutations return the canonical ordered list, which the client adopts.\
**Why:** One authority for state makes consistency and concurrent changes predictable.

### 2. One owner, one watchlist
**Context:** The challenge asks for a watchlist, not a portfolio-management system.\
**Choice:** Each owner has one implicit watchlist; there is no `watchlists` table.\
**Why:** Multiple watchlists add complexity without improving the core product.

### 3. Reordering is concurrency-sensitive
**Context:** Two tabs can try to reorder the same watchlist at the same time.\
**Choice:** Reorder submits the complete intended ordering. A stale request is rejected with `409` rather than silently overwriting newer state.\
**Why:** Explicit conflicts are safer and easier to reason about than silent last-write-wins behavior.

### 4. Provider identifiers stay at the boundary
**Context:** Market-data providers have their own instrument identifiers.\
**Choice:** The application uses a canonical symbol and stores the provider identifier separately.\
**Why:** The rest of the product should not depend on which market-data provider we use.