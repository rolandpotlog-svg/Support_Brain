CREATE TABLE "social_category_autonomy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"category" text NOT NULL,
	"approved_count" integer DEFAULT 0 NOT NULL,
	"auto_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"post_id" text,
	"ad_id" text,
	"comment_id" text NOT NULL,
	"parent_comment_id" text,
	"from_id" text,
	"from_name" text,
	"message" text,
	"intent" text,
	"sentiment" text,
	"confidence" integer,
	"route_action" text,
	"visibility" text,
	"status" text DEFAULT 'new' NOT NULL,
	"draft_text" text,
	"posted_text" text,
	"auto" boolean DEFAULT false NOT NULL,
	"handled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_account" ADD COLUMN "auto_stop" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_category_autonomy" ADD CONSTRAINT "social_category_autonomy_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comment" ADD CONSTRAINT "social_comment_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comment" ADD CONSTRAINT "social_comment_account_id_social_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_comment" ADD CONSTRAINT "social_comment_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_autonomy_shop_cat_uidx" ON "social_category_autonomy" USING btree ("shop_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "social_comment_commentid_uidx" ON "social_comment" USING btree ("comment_id");--> statement-breakpoint
CREATE INDEX "social_comment_shop_status_idx" ON "social_comment" USING btree ("shop_id","status","created_at");