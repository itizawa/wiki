ALTER TABLE "site_builds" ADD COLUMN "triggered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "site_builds" ADD COLUMN "attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- これまでのビルドは起動できたものとして扱う（空のままだと、反映した直後の Cron が最後の1件をもう一度起動する）
UPDATE "site_builds" SET "triggered_at" = "requested_at";
