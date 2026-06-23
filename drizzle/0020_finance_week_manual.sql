CREATE TABLE "finance_week_manual" (
	"shop_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"umsatz_brutto_cents" integer DEFAULT 0 NOT NULL,
	"rabatte_cents" integer DEFAULT 0 NOT NULL,
	"refunds_cents" integer DEFAULT 0 NOT NULL,
	"versand_einnahme_cents" integer DEFAULT 0 NOT NULL,
	"ust_cents" integer DEFAULT 0 NOT NULL,
	"cogs_cents" integer DEFAULT 0 NOT NULL,
	"versandkosten_cents" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'blueprint' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_week_manual_shop_id_week_start_pk" PRIMARY KEY("shop_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "finance_week_manual" ADD CONSTRAINT "finance_week_manual_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;