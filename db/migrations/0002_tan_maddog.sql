CREATE TABLE "market_refresh_state" (
	"id" text PRIMARY KEY NOT NULL,
	"lease_holder" text,
	"lease_expires_at" timestamp with time zone,
	"cycle_started_at" timestamp with time zone,
	"cycle_completed_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"backoff_until" timestamp with time zone,
	CONSTRAINT "market_refresh_state_id_check" CHECK ("market_refresh_state"."id" = 'global')
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"symbol" text PRIMARY KEY NOT NULL,
	"last_price" numeric(14, 4) NOT NULL,
	"previous_close" numeric(14, 4) NOT NULL,
	"day_open" numeric(14, 4),
	"day_high" numeric(14, 4),
	"day_low" numeric(14, 4),
	"week_high_52" numeric(14, 4),
	"week_low_52" numeric(14, 4),
	"volume" bigint,
	"provider_ts" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_failure_at" timestamp with time zone,
	CONSTRAINT "quotes_last_price_check" CHECK ("quotes"."last_price" > 0),
	CONSTRAINT "quotes_previous_close_check" CHECK ("quotes"."previous_close" > 0)
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE restrict ON UPDATE no action;