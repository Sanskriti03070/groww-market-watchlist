CREATE TYPE "public"."symbol_kind" AS ENUM('EQUITY', 'INDEX');--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	CONSTRAINT "owners_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "symbols" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "symbol_kind" NOT NULL,
	"provider_symbol" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"position" integer NOT NULL,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "watchlist_items_owner_id_symbol_unique" UNIQUE("owner_id","symbol"),
	CONSTRAINT "watchlist_items_owner_id_position_unique" UNIQUE("owner_id","position"),
	CONSTRAINT "watchlist_items_position_check" CHECK ("watchlist_items"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watchlist_items_owner_id_position_idx" ON "watchlist_items" USING btree ("owner_id","position");