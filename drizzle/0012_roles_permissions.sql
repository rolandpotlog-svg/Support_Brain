ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;--> statement-breakpoint
UPDATE "users" SET "role" = 'owner' WHERE "role" = 'admin';--> statement-breakpoint
UPDATE "users" SET "role" = 'member' WHERE "role" = 'agent';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perm_reports" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perm_cases" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perm_shops_view" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perm_shops_edit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "perm_manage_users" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DROP TYPE "public"."user_role";
