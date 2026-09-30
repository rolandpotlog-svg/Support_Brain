CREATE TABLE "shop_paypal" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret_enc" text NOT NULL,
	"mode" text DEFAULT 'sandbox' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispute_case" ADD COLUMN "match_confidence" text;--> statement-breakpoint
ALTER TABLE "dispute_case" ADD COLUMN "match_note" text;--> statement-breakpoint
ALTER TABLE "shop_paypal" ADD CONSTRAINT "shop_paypal_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;