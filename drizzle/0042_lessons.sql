CREATE TABLE "shop_lesson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"intent" text,
	"rule" text NOT NULL,
	"source" text DEFAULT 'edit' NOT NULL,
	"status" text DEFAULT 'vorschlag' NOT NULL,
	"evidence" text,
	"thread_id" uuid,
	"hits" integer DEFAULT 1 NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "lesson_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shop_lesson" ADD CONSTRAINT "shop_lesson_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_lesson" ADD CONSTRAINT "shop_lesson_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_lesson" ADD CONSTRAINT "shop_lesson_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_lesson_shop_idx" ON "shop_lesson" USING btree ("shop_id","status");