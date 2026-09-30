ALTER TABLE "messages" ADD COLUMN "ai_shadow_match" boolean;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ai_shadow_note" text;--> statement-breakpoint
ALTER TABLE "shop_mailboxes" ADD COLUMN "shadow_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_mailboxes" ADD COLUMN "last_seen_sent_uid" bigint;