ALTER TABLE "user_shops" ADD COLUMN "role" text DEFAULT 'mitarbeiter' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_shops" ADD COLUMN "finance_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "user_shops" SET "role" = 'admin';--> statement-breakpoint
ALTER TABLE "user_shops" ADD CONSTRAINT "user_shops_finance_role_chk" CHECK ("finance_access" = false OR "role" IN ('founder','admin'));
