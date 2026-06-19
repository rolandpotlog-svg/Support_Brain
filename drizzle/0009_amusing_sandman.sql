ALTER TABLE "shop_shopify" ALTER COLUMN "admin_token_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_shopify" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "shop_shopify" ADD COLUMN "client_secret_enc" text;--> statement-breakpoint
ALTER TABLE "shop_shopify" ADD COLUMN "token_expires_at" timestamp with time zone;