ALTER TABLE "shops" ADD COLUMN "weekly_report_to" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "weekly_report_enabled" boolean DEFAULT false NOT NULL;