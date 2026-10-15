ALTER TABLE "workflow_blocks" DROP CONSTRAINT "workflow_blocks_trigger_type_check";--> statement-breakpoint
ALTER TABLE "workflow_blocks" ALTER COLUMN "trigger_tag_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "tag_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_trigger_type_check" CHECK (("workflow_blocks"."trigger_type" = 'tag_attached' and "workflow_blocks"."trigger_tag_id" is not null) or ("workflow_blocks"."trigger_type" = 'page_first_published' and "workflow_blocks"."trigger_tag_id" is null));