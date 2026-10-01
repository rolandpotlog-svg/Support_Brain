ALTER TABLE "outbox" ADD COLUMN "send_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "auto_send" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "auto_send_intents" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "auto_send_delay_min" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "auto_send_daily_max" integer DEFAULT 50 NOT NULL;