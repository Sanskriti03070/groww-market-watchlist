-- The approved schema requires UNIQUE(owner_id, position) to be DEFERRABLE
-- INITIALLY DEFERRED: REMOVE (compacting positions) and REORDER (rewriting
-- the whole order) both write several rows of one owner's positions inside
-- a single transaction, and can transiently re-derive a value another
-- not-yet-updated row still holds, depending on the order Postgres happens
-- to process rows in. A non-deferrable (or deferred-but-checked-per-
-- statement) constraint would make that a real, order-dependent failure.
-- Deferring the check to COMMIT makes it depend only on the final state,
-- which is always the dense, non-colliding set {0, ..., n-1}.
--
-- Drizzle's pg-core `unique()` builder cannot express DEFERRABLE, so the
-- constraint from 0000 is dropped and recreated here as approved.

ALTER TABLE "watchlist_items" DROP CONSTRAINT "watchlist_items_owner_id_position_unique";
--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_owner_id_position_unique" UNIQUE ("owner_id", "position") DEFERRABLE INITIALLY DEFERRED;
