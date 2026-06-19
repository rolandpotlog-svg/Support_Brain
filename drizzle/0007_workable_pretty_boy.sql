CREATE TABLE "social_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text,
	"access_token_enc" text NOT NULL,
	"app_secret_enc" text,
	"verify_token" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"external_user_id" text NOT NULL,
	"user_name" text,
	"customer_name" text,
	"customer_email" text,
	"order_id" text,
	"order_name" text,
	"status" text DEFAULT 'open' NOT NULL,
	"last_inbound_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" "message_direction" NOT NULL,
	"text" text,
	"external_id" text,
	"sent_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "social_account" ADD CONSTRAINT "social_account_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_conversation" ADD CONSTRAINT "social_conversation_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_conversation" ADD CONSTRAINT "social_conversation_account_id_social_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."social_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_message" ADD CONSTRAINT "social_message_conversation_id_social_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."social_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_message" ADD CONSTRAINT "social_message_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_account_shop_channel_uidx" ON "social_account" USING btree ("shop_id","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "social_conv_account_user_uidx" ON "social_conversation" USING btree ("account_id","external_user_id");--> statement-breakpoint
CREATE INDEX "social_conv_shop_idx" ON "social_conversation" USING btree ("shop_id","last_message_at");--> statement-breakpoint
CREATE INDEX "social_msg_conv_idx" ON "social_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "social_msg_external_uidx" ON "social_message" USING btree ("external_id") WHERE "social_message"."external_id" is not null;