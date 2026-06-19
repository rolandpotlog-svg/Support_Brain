-- shop_mailboxes: von 1:1 (PK shop_id) auf 1:n umstellen (eigene id als PK).
-- Tabelle ist leer -> gefahrloser Constraint-Wechsel.
ALTER TABLE "shop_mailboxes" DROP CONSTRAINT "shop_mailboxes_pkey";--> statement-breakpoint
ALTER TABLE "shop_mailboxes" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "mailbox_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_mailbox_id_shop_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "public"."shop_mailboxes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shop_mailboxes_shop_idx" ON "shop_mailboxes" USING btree ("shop_id");
