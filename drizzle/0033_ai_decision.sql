ALTER TABLE "messages" ADD COLUMN "ai_decision" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_decision" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_reason" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_draft_at" timestamp with time zone;