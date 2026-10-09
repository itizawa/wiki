CREATE TABLE "publish_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"page_id" text,
	"scheduled_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" text NOT NULL,
	"page_id" text,
	"version_id" uuid,
	"target_visibility" text,
	"branch_name" text,
	"batch_id" uuid,
	"run_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	CONSTRAINT "scheduled_actions_action_type_check" CHECK ("scheduled_actions"."action_type" in ('publish_page', 'unpublish_page', 'merge_branch')),
	CONSTRAINT "scheduled_actions_status_check" CHECK ("scheduled_actions"."status" in ('scheduled', 'running', 'done', 'failed', 'canceled'))
);
--> statement-breakpoint
CREATE TABLE "site_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"last_event_id" bigint NOT NULL,
	"content_hash" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_version_id_page_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_actions_due_idx" ON "scheduled_actions" USING btree ("run_at") WHERE "scheduled_actions"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX "scheduled_actions_page_idx" ON "scheduled_actions" USING btree ("page_id");