CREATE TABLE "workflow_run_actions" (
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"routine_id" uuid,
	"tag_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_run_actions_run_id_position_pk" PRIMARY KEY("run_id","position"),
	CONSTRAINT "workflow_run_actions_status_check" CHECK ("workflow_run_actions"."status" in ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"block_id" uuid,
	"page_id" text NOT NULL,
	"tag_id" uuid NOT NULL,
	"version_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('pending', 'running', 'succeeded', 'failed', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "workflow_run_actions" ADD CONSTRAINT "workflow_run_actions_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_block_id_workflow_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_wiki_idx" ON "workflow_runs" USING btree ("wiki_id","created_at");