ALTER TABLE "threads" ADD COLUMN "ai_intent" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_issue" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_item" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_summary" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_language" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_praise" boolean;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_triaged_at" timestamp with time zone;