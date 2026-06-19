CREATE TABLE "shop_shopify" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"store_domain" text NOT NULL,
	"admin_token_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_shopify" ADD CONSTRAINT "shop_shopify_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;