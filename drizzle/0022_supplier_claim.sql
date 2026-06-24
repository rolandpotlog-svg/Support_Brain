CREATE TABLE "supplier_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_name" text,
	"product_label" text NOT NULL,
	"sku" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'manuell' NOT NULL,
	"trello_card_id" text,
	"trello_card_url" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "supplier_claim" ADD CONSTRAINT "supplier_claim_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_claim" ADD CONSTRAINT "supplier_claim_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_claim_shop_idx" ON "supplier_claim" USING btree ("shop_id","created_at");