CREATE TABLE "symbol_observations" (
	"owner_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"baseline_price" numeric(14, 4) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"quote_fetched_at" timestamp with time zone NOT NULL,
	"session_date" date NOT NULL,
	CONSTRAINT "symbol_observations_owner_id_symbol_pk" PRIMARY KEY("owner_id","symbol"),
	CONSTRAINT "symbol_observations_baseline_price_check" CHECK ("symbol_observations"."baseline_price" > 0)
);
--> statement-breakpoint
ALTER TABLE "symbol_observations" ADD CONSTRAINT "symbol_observations_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "symbol_observations" ADD CONSTRAINT "symbol_observations_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE restrict ON UPDATE no action;