ALTER TABLE "threads" ADD COLUMN "order_name" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "order_confidence" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "order_checks" jsonb;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "order_items" jsonb;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "order_matched_at" timestamp with time zone;