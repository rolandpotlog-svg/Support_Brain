CREATE TABLE "finance_google_ads" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"login_customer_id" text,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"developer_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_google_ads" ADD CONSTRAINT "finance_google_ads_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;