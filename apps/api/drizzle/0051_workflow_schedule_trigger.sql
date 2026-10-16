ALTER TABLE "workflow_blocks" DROP CONSTRAINT "workflow_blocks_trigger_type_check";--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD COLUMN "trigger_page_id" text;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD COLUMN "trigger_time" text;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD COLUMN "trigger_weekdays" integer[];--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD COLUMN "last_fired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "trigger_type" text DEFAULT 'tag_attached' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_trigger_page_id_pages_id_fk" FOREIGN KEY ("trigger_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_trigger_type_check" CHECK (("workflow_blocks"."trigger_type" = 'tag_attached' and "workflow_blocks"."trigger_tag_id" is not null) or ("workflow_blocks"."trigger_type" = 'page_first_published' and "workflow_blocks"."trigger_tag_id" is null) or ("workflow_blocks"."trigger_type" = 'schedule' and "workflow_blocks"."trigger_tag_id" is null and "workflow_blocks"."trigger_page_id" is not null and "workflow_blocks"."trigger_time" is not null and "workflow_blocks"."trigger_weekdays" is not null));--> statement-breakpoint
UPDATE "workflow_runs" SET "trigger_type" = 'page_first_published' WHERE "tag_id" IS NULL;