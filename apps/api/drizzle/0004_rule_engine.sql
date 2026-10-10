CREATE TABLE "rule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" text NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"page_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_runs_status_check" CHECK ("rule_runs"."status" in ('done', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"trigger" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "workflow_state" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "approved_version_id" uuid;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "review_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "rule_run_id" uuid;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_runs_rule_idx" ON "rule_runs" USING btree ("rule_id","created_at");--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_rule_run_id_rule_runs_id_fk" FOREIGN KEY ("rule_run_id") REFERENCES "public"."rule_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_workflow_state_check" CHECK ("pages"."workflow_state" in ('idea', 'draft', 'approved'));--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_approved_version_check" CHECK (("pages"."workflow_state" = 'approved') = ("pages"."approved_version_id" is not null));