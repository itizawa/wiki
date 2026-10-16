ALTER TABLE "workflow_runs" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
-- すでに確定している失敗は、通知済みとして扱う（このあとの失敗だけを通知する）
UPDATE "workflow_runs" SET "notified_at" = coalesce("finished_at", now()) WHERE "status" = 'failed';
