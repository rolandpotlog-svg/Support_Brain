CREATE TABLE "finance_cogs_rate" (
	"shop_id" uuid NOT NULL,
	"key" text NOT NULL,
	"unit_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_cogs_rate_shop_id_key_pk" PRIMARY KEY("shop_id","key")
);
--> statement-breakpoint
ALTER TABLE "finance_cogs_rate" ADD CONSTRAINT "finance_cogs_rate_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;