ALTER TABLE "workflow_actions" DROP CONSTRAINT "workflow_actions_type_check";--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD COLUMN "instruction" text;--> statement-breakpoint
ALTER TABLE "workflow_run_actions" ADD COLUMN "instruction" text;--> statement-breakpoint
UPDATE "workflow_actions" SET "instruction" = '次のページを確認し、wiki の MCP の get_page で本文を読んで、create_edit_request で編集リクエストを出してください。create_edit_request の baseVersionId には、下の versionId を使ってください。' WHERE "type" = 'call_routine';--> statement-breakpoint
UPDATE "workflow_run_actions" SET "instruction" = '次のページを確認し、wiki の MCP の get_page で本文を読んで、create_edit_request で編集リクエストを出してください。create_edit_request の baseVersionId には、下の versionId を使ってください。' WHERE "type" = 'call_routine';--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_type_check" CHECK (("workflow_actions"."type" = 'call_routine' and "workflow_actions"."routine_id" is not null and "workflow_actions"."instruction" is not null and "workflow_actions"."tag_id" is null) or ("workflow_actions"."type" in ('remove_tag', 'add_tag') and "workflow_actions"."tag_id" is not null and "workflow_actions"."routine_id" is null));
