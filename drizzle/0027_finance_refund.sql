CREATE TABLE "finance_refund" (
	"shop_id" uuid NOT NULL,
	"refund_id" text NOT NULL,
	"order_name" text,
	"refunded_at" date NOT NULL,
	"refund_week" date NOT NULL,
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finance_refund_shop_id_refund_id_pk" PRIMARY KEY("shop_id","refund_id")
);
--> statement-breakpoint
ALTER TABLE "finance_refund" ADD CONSTRAINT "finance_refund_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "finance_refund_week_idx" ON "finance_refund" USING btree ("shop_id","refund_week");