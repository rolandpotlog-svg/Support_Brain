CREATE TABLE "return_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" serial NOT NULL,
	"shop_id" uuid NOT NULL,
	"order_gid" text,
	"order_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_name" text,
	"status" text DEFAULT 'open' NOT NULL,
	"reason_routing" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offer_type" text,
	"offer_value_cents" integer,
	"offer_step" integer DEFAULT 0 NOT NULL,
	"accepted_offer_type" text,
	"accepted_value_cents" integer,
	"recovered_value_cents" integer DEFAULT 0 NOT NULL,
	"outcome" text,
	"note" text,
	"thread_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_cases_number_unique" UNIQUE("number")
);
--> statement-breakpoint
CREATE TABLE "return_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"label" text NOT NULL,
	"routing" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_settings" (
	"shop_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"cogs_pct" integer DEFAULT 40 NOT NULL,
	"return_shipping_cents" integer DEFAULT 600 NOT NULL,
	"resaleable_default" boolean DEFAULT true NOT NULL,
	"voucher_bonus_pct" integer DEFAULT 15 NOT NULL,
	"first_offer_pct" integer DEFAULT 70 NOT NULL,
	"fraud_window_days" integer DEFAULT 60 NOT NULL,
	"fraud_max_keep_cents" integer DEFAULT 10000 NOT NULL,
	"high_value_threshold_cents" integer DEFAULT 15000 NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"accent_color" text DEFAULT '#2b6ef2' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"amount_cents" integer,
	"deep_link" text,
	"instruction" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perm_returns" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_reasons" ADD CONSTRAINT "return_reasons_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_settings" ADD CONSTRAINT "return_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_tasks" ADD CONSTRAINT "return_tasks_case_id_return_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."return_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_tasks" ADD CONSTRAINT "return_tasks_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_tasks" ADD CONSTRAINT "return_tasks_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_cases_shop_idx" ON "return_cases" USING btree ("shop_id","status","created_at");--> statement-breakpoint
CREATE INDEX "return_reasons_shop_idx" ON "return_reasons" USING btree ("shop_id","sort_order");--> statement-breakpoint
CREATE INDEX "return_tasks_open_idx" ON "return_tasks" USING btree ("shop_id","status","created_at");