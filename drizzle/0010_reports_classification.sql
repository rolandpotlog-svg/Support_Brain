ALTER TABLE "messages" ADD COLUMN "ai_outcome" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "first_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_category" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_sentiment" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_product" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "ai_classified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "last_ai_draft" text;