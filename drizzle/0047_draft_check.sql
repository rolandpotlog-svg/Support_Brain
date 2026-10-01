ALTER TABLE "messages" ADD COLUMN "ai_check_passed" boolean;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_drafting_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_check" jsonb;