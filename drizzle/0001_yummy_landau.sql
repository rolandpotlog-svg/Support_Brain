ALTER TYPE "public"."thread_status" ADD VALUE 'spam';--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "number" serial NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "tag" text;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_number_unique" UNIQUE("number");