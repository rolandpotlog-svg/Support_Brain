CREATE TABLE "shop_profile" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb,
	"sources" jsonb,
	"system_prompt" text,
	"website_url" text,
	"shopify_data" jsonb,
	"shopify_fetched_at" timestamp with time zone,
	"scraped_data" jsonb,
	"scraped_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shop_profile" ADD CONSTRAINT "shop_profile_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;