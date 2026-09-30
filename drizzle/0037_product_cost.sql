CREATE TABLE "finance_product_cost" (
	"shop_id" uuid NOT NULL,
	"product_key" text NOT NULL,
	"label" text NOT NULL,
	"unit_cents" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manuell' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_product_cost_shop_id_product_key_pk" PRIMARY KEY("shop_id","product_key")
);
--> statement-breakpoint
ALTER TABLE "finance_product_cost" ADD CONSTRAINT "finance_product_cost_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;