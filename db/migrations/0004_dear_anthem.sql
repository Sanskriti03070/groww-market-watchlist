CREATE TYPE "public"."alert_condition_type" AS ENUM('PRICE_LEVEL', 'DAY_MOVE');--> statement-breakpoint
CREATE TYPE "public"."alert_direction" AS ENUM('ABOVE', 'BELOW', 'UP', 'DOWN');--> statement-breakpoint
CREATE TYPE "public"."alert_state" AS ENUM('ACTIVE', 'TRIGGERED', 'DISABLED');--> statement-breakpoint
CREATE TABLE "alert_triggers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"alert_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"triggered_at" timestamp with time zone NOT NULL,
	"quote_fetched_at" timestamp with time zone NOT NULL,
	"observed_price" numeric(14, 4) NOT NULL,
	"threshold_value" numeric(14, 4) NOT NULL,
	"condition_type" "alert_condition_type" NOT NULL,
	"direction" "alert_direction" NOT NULL,
	"previous_side" smallint NOT NULL,
	"new_side" smallint NOT NULL,
	"day_change_percent" numeric(14, 4),
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "alert_triggers_alert_id_quote_fetched_at_unique" UNIQUE("alert_id","quote_fetched_at"),
	CONSTRAINT "alert_triggers_observed_price_check" CHECK ("alert_triggers"."observed_price" > 0),
	CONSTRAINT "alert_triggers_threshold_value_check" CHECK ("alert_triggers"."threshold_value" > 0),
	CONSTRAINT "alert_triggers_previous_side_check" CHECK ("alert_triggers"."previous_side" in (-1, 1)),
	CONSTRAINT "alert_triggers_new_side_check" CHECK ("alert_triggers"."new_side" in (-1, 1))
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"condition_type" "alert_condition_type" NOT NULL,
	"direction" "alert_direction" NOT NULL,
	"threshold_value" numeric(14, 4) NOT NULL,
	"state" "alert_state" DEFAULT 'ACTIVE' NOT NULL,
	"last_side" smallint,
	"last_evaluated_quote_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "alerts_threshold_value_check" CHECK ("alerts"."threshold_value" > 0),
	CONSTRAINT "alerts_last_side_check" CHECK ("alerts"."last_side" is null or "alerts"."last_side" in (-1, 1)),
	CONSTRAINT "alerts_direction_matches_condition_type_check" CHECK (("alerts"."condition_type" = 'PRICE_LEVEL' and "alerts"."direction" in ('ABOVE', 'BELOW')) or ("alerts"."condition_type" = 'DAY_MOVE' and "alerts"."direction" in ('UP', 'DOWN')))
);
--> statement-breakpoint
ALTER TABLE "alert_triggers" ADD CONSTRAINT "alert_triggers_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_triggers" ADD CONSTRAINT "alert_triggers_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_triggers" ADD CONSTRAINT "alert_triggers_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_symbol_symbols_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."symbols"("symbol") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_triggers_alert_id_idx" ON "alert_triggers" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "alert_triggers_owner_id_idx" ON "alert_triggers" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "alerts_owner_id_idx" ON "alerts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "alerts_symbol_evaluation_idx" ON "alerts" USING btree ("symbol") WHERE "alerts"."state" <> 'DISABLED';