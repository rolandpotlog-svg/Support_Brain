CREATE TABLE "finance_cost_override" (
	"shop_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"fixkosten_cents" integer DEFAULT 0 NOT NULL,
	"variable_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_cost_override_shop_id_week_start_pk" PRIMARY KEY("shop_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "finance_marketing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"channel" text NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_name" text NOT NULL,
	"order_gid" text,
	"created_at" timestamp with time zone NOT NULL,
	"week_start" date NOT NULL,
	"umsatz_brutto_cents" integer DEFAULT 0 NOT NULL,
	"rabatte_cents" integer DEFAULT 0 NOT NULL,
	"refunds_cents" integer DEFAULT 0 NOT NULL,
	"versand_einnahme_cents" integer DEFAULT 0 NOT NULL,
	"ust_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"cogs_cents" integer DEFAULT 0 NOT NULL,
	"cogs_unknown" boolean DEFAULT false NOT NULL,
	"financial_status" text,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"title" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"sku" text,
	"unit_cogs_cents" integer DEFAULT 0 NOT NULL,
	"line_cogs_cents" integer DEFAULT 0 NOT NULL,
	"mapped" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finance_shipping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_name" text NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"contaminated" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_cost_override" ADD CONSTRAINT "finance_cost_override_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_marketing" ADD CONSTRAINT "finance_marketing_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_order" ADD CONSTRAINT "finance_order_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_order_item" ADD CONSTRAINT "finance_order_item_order_id_finance_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."finance_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_order_item" ADD CONSTRAINT "finance_order_item_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_shipping" ADD CONSTRAINT "finance_shipping_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finance_marketing_uidx" ON "finance_marketing" USING btree ("shop_id","week_start","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_order_uidx" ON "finance_order" USING btree ("shop_id","order_name");--> statement-breakpoint
CREATE INDEX "finance_order_week_idx" ON "finance_order" USING btree ("shop_id","week_start");--> statement-breakpoint
CREATE INDEX "finance_item_order_idx" ON "finance_order_item" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_shipping_uidx" ON "finance_shipping" USING btree ("shop_id","order_name");