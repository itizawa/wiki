CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"assignee_id" uuid,
	"page_id" text,
	"workflow_id" uuid,
	"run_id" uuid,
	"run_position" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	CONSTRAINT "tasks_status_check" CHECK ("tasks"."status" in ('todo', 'in_progress', 'done'))
);
--> statement-breakpoint
ALTER TABLE "workflow_actions" DROP CONSTRAINT "workflow_actions_type_check";--> statement-breakpoint
ALTER TABLE "workflow_runs" DROP CONSTRAINT "workflow_runs_status_check";--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD COLUMN "task_title" text;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD COLUMN "task_description" text;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_run_actions" ADD COLUMN "task_title" text;--> statement-breakpoint
ALTER TABLE "workflow_run_actions" ADD COLUMN "task_description" text;--> statement-breakpoint
ALTER TABLE "workflow_run_actions" ADD COLUMN "assignee_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_wiki_idx" ON "tasks" USING btree ("wiki_id","created_at");--> statement-breakpoint
CREATE INDEX "tasks_wiki_status_idx" ON "tasks" USING btree ("wiki_id","status","created_at");--> statement-breakpoint
CREATE INDEX "tasks_run_idx" ON "tasks" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_type_check" CHECK (("workflow_actions"."type" = 'call_routine' and "workflow_actions"."routine_id" is not null and "workflow_actions"."instruction" is not null and "workflow_actions"."tag_id" is null) or ("workflow_actions"."type" in ('remove_tag', 'add_tag') and "workflow_actions"."tag_id" is not null and "workflow_actions"."routine_id" is null) or ("workflow_actions"."type" = 'create_task' and "workflow_actions"."task_title" is not null and "workflow_actions"."task_description" is not null and "workflow_actions"."routine_id" is null and "workflow_actions"."tag_id" is null));--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('pending', 'running', 'waiting', 'succeeded', 'failed', 'skipped'));