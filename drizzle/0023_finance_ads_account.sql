CREATE TABLE "finance_ads_account" (
	"shop_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"account_id" text NOT NULL,
	"token_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_ads_account_shop_id_channel_pk" PRIMARY KEY("shop_id","channel")
);
--> statement-breakpoint
ALTER TABLE "finance_ads_account" ADD CONSTRAINT "finance_ads_account_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;