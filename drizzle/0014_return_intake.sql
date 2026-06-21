ALTER TABLE "return_cases" ADD COLUMN "received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "return_cases" ADD COLUMN "condition" text;--> statement-breakpoint
ALTER TABLE "return_cases" ADD COLUMN "restocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "return_cases" ADD COLUMN "received_by" uuid;--> statement-breakpoint
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;