CREATE TABLE "dispute_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispute_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"source" text NOT NULL,
	"provider_case_id" text NOT NULL,
	"provider_evidence_id" text,
	"order_id" text,
	"order_name" text,
	"thread_id" uuid,
	"customer_email" text,
	"customer_name" text,
	"amount" text,
	"currency" text,
	"reason" text,
	"reason_code" text,
	"type" text,
	"status" text DEFAULT 'needs_response' NOT NULL,
	"due_by" timestamp with time zone,
	"initiated_at" timestamp with time zone,
	"evidence" jsonb,
	"decision" text,
	"submitted_at" timestamp with time zone,
	"outcome" text,
	"external_url" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispute_audit" ADD CONSTRAINT "dispute_audit_case_id_dispute_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."dispute_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_audit" ADD CONSTRAINT "dispute_audit_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_case" ADD CONSTRAINT "dispute_case_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_case" ADD CONSTRAINT "dispute_case_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_case_provider_uidx" ON "dispute_case" USING btree ("shop_id","source","provider_case_id");--> statement-breakpoint
CREATE INDEX "dispute_case_due_idx" ON "dispute_case" USING btree ("status","due_by");