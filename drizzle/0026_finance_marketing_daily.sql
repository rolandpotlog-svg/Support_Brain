CREATE TABLE "finance_marketing_daily" (
	"shop_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"date" date NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_marketing_daily_shop_id_channel_date_pk" PRIMARY KEY("shop_id","channel","date")
);
--> statement-breakpoint
ALTER TABLE "finance_marketing_daily" ADD CONSTRAINT "finance_marketing_daily_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;