# Maintainable Code & Comments — Code of Conduct

Scope: all implementation work in this repository, whether written by a human or by
Claude Code.

This document has two jobs. The first is to keep the code maintainable. The second,
and the more important one, is to keep the implementation faithful to engineering
decisions that were already made deliberately. Sections 1 and 2 are the enforcement
mechanism; the rest is craft.

---

## 1. The stop rule

**The implementer owns implementation. The implementer does not own architecture.**

If a task appears to require any of the following, stop and surface the conflict
before writing code:

- changing an approved decision, invariant, or state-ownership boundary
- adding a library, service, cache tier, queue, or infrastructure component
- adding an architectural layer (repository/service/adapter) not already agreed
- changing an API contract, request shape, or error code
- changing the database schema or a constraint
- working around a design constraint because it makes the task easier

Surfacing means: describe the conflict, name the decision it collides with, and
propose the smallest change that would resolve it. Then wait.

"The design made this awkward" is a reason to raise it, not a licence to route
around it. Awkwardness is often the constraint doing its job.

---

## 2. Locked decisions — implement these, do not reinterpret them

These are settled. Treat each as a constraint on the code, not a suggestion.

**State ownership**
- Postgres is the single source of truth for watchlist membership and order.
- Every mutation endpoint returns the full canonical ordered list. The client
  replaces its state with that response; it never holds authority.
- Market state is server-owned. The browser never calls the upstream price source.

**Identity**
- The capability token identifies an **owner**, not a watchlist.
- `owners.token_hash` stores a hash. The plaintext token exists only in the URL and
  one httpOnly cookie, never as a join key, never in a log line.
- No owner id appears in any request path, body, or query. Authorization derives
  from the cookie alone.
- Owner creation happens on POST, never as a side effect of a GET.

**Watchlist model**
- There is no `watchlists` table. One owner, one implicit list.
- `symbols.symbol` is our canonical key. `provider_symbol` is a column. Upstream
  naming never leaks into keys or user-facing state.
- Symbols are deactivated via `is_active`, never deleted. FK is RESTRICT.

**Ordering**
- Dense integer positions. The positions of an owner's items are exactly
  `0 … n-1`, always, after every mutation.
- `UNIQUE (owner_id, position)` is DEFERRABLE INITIALLY DEFERRED. Bulk reorder is
  allowed to pass through colliding intermediate states and must commit valid.
- Reorder is a full desired-order permutation. A submitted array that is not an
  exact permutation of the owner's current items is a 409, and nothing is written.
- All mutations for one owner serialize on a `SELECT … FOR UPDATE` of the owner row.

**Persistence**
- Neon `drizzle-orm/neon-serverless` Pool driver. The HTTP driver cannot do
  interactive transactions and three planned features need them.
- Add, remove, reorder are each one transaction. There is no partial success.

**Future keys** (decided now, built later — do not create these tables early)
- Last-seen snapshots key on `(owner_id, symbol)` so a remove/re-add preserves the
  since-last-check baseline.
- Conditions key on `item_id` and cascade, because a condition on a removed stock
  has no subject.

**Market data and conditions** (when those slices arrive)
- One shared poller behind a lease. Never per-client fetching.
- Reliability (LIVE / STALE / UNAVAILABLE) is **derived at read** from
  `fetched_at` plus session state. It is never stored as a flag.
- Conditions evaluate only against LIVE data. STALE and UNAVAILABLE freeze
  evaluation entirely — no trigger, no un-trigger.
- The word "paused" is reserved for user-initiated pause. System-forced evaluation
  freeze must never use it, in code identifiers or in UI copy.
- The price source sits behind one interface with Live and Replay implementations.
  No call site may depend on which one is active.
- No buy / sell / recommendation framing anywhere in copy or naming. The system
  reports that the thing the user asked to watch has happened.

---

## 3. Code

**Names.** Intention-revealing and specific. `assertDenseOrder` over `checkOrder`.
`triggeredAt` over `date`. Avoid generic containers — no `utils.ts`, no `helpers.ts`,
no `types.ts` holding unrelated things. Name a module after what it does.

**Functions.** Small because they do one thing, not small because of a line count
target. A function that reads top to bottom without a scroll is usually right.
Prefer early returns over nesting.

**Types.** TypeScript strict. No `any`. Model states as discriminated unions rather
than optional-field soup — a condition anchor is a union of kinds, not a struct with
four nullable columns' worth of optional fields. Make illegal states unrepresentable
where the type system can do it cheaply; don't contort the types where it can't.

**Errors.** Fail with the actual cause. No blanket `catch` that returns a generic
message and swallows what happened. Every non-200 response maps to a specific,
documented status: 401 missing credential, 404 unknown token, 409 stale state, 422
validation. Validate every inbound request with Zod, and validate every upstream
payload with Zod — a malformed upstream response degrades one symbol, it does not
throw and take down a cycle.

**Boundaries.** Route handlers parse, authorize, and delegate. Business logic and
invariant enforcement live below them, not inside them. SQL does not appear in a
route handler.

**Duplication.** Two similar things are two things. Extract on the third occurrence,
or when the duplicated logic is an invariant that must not drift. Duplication is
cheaper to fix than the wrong abstraction.

**Proportion.** The watchlist holds at most 50 rows and the universe holds 53. Write
code proportional to those numbers. If a solution's justification is a scale this
product does not have, it is the wrong solution.

---

## 4. Comments

Sparse and load-bearing. A comment exists to carry information the code cannot.

Write one for: a non-obvious *why*, an invariant a future edit could silently break,
concurrency or ordering reasoning, an external-system limitation, a deliberate
deviation from the obvious approach.

```ts
// Deferred until commit: a bulk reorder necessarily passes through duplicate
// positions mid-statement. A non-deferrable unique index rejects the whole update.

// Seeded from the current tick at arm time, otherwise a condition created while
// already true fires immediately on the next poll and the bell becomes noise.

// Anchors come from completed daily bars only, so a stock setting a new 52-week
// high today is measured against yesterday's. Deliberate: the alternative is
// recomputing an unchanged value 240 times an hour.
```

Do not write:

```ts
// Update the checkpoint with the current price.   <- narrates the code
// Loop through the items                          <- explains syntax
// Helper function to get the user                 <- repeats the name
// Robust error handling for reliability           <- says nothing
```

If a comment is explaining *what* the code does, the fix is usually a better name or
a smaller function, not a better comment.

---

## 5. Patterns to avoid

- An abstraction layer with one implementation and no second one planned
- An interface introduced "for testability" when the concrete type is already testable
- Speculative parameters, options objects, or config for cases that do not exist
- Defensive checks with no reachable failure mode behind them
- Wrapper functions that only forward arguments
- A class where a function suffices
- Clever one-liners that need a comment to be read
- Repetitive boilerplate that a loop or a shared type would remove
- Inconsistent naming for the same concept across layers

Every abstraction earns its existence by removing a real, present problem.

---

## 6. Before finishing

- Does this match the approved design, including the parts that were inconvenient?
- Did I add anything the task did not require?
- Is every invariant in section 2 that this code touches still guaranteed — and is
  there a test that proves it, not a comment that asserts it?
- Are the names understandable without reading the implementation?
- Is there an abstraction here with exactly one caller?
- Does every comment carry information the code cannot?
- Could someone modify this in six months without breaking something invisible?
- Does this read as deliberate engineering rather than generated thoroughness?

---

## Final rule

Simplicity over cleverness. Clarity over abstraction. When implementation conflicts
with an approved decision, surface it — do not improvise.

The goal is not code that looks sophisticated. The goal is code that is correct,
deliberate, and explainable to the engineer who has to inherit it.