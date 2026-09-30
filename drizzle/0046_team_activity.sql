CREATE TABLE "user_active_minute" (
	"user_id" uuid NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"shop_id" uuid,
	CONSTRAINT "user_active_minute_user_id_minute_pk" PRIMARY KEY("user_id","minute")
);
--> statement-breakpoint
CREATE TABLE "user_login" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"device" text
);
--> statement-breakpoint
ALTER TABLE "user_active_minute" ADD CONSTRAINT "user_active_minute_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_active_minute" ADD CONSTRAINT "user_active_minute_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_login" ADD CONSTRAINT "user_login_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_login_user_at_idx" ON "user_login" USING btree ("user_id","at");