CREATE TABLE "workflow_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"routine_id" uuid,
	"tag_id" uuid,
	CONSTRAINT "workflow_actions_block_position_unique" UNIQUE("block_id","position"),
	CONSTRAINT "workflow_actions_type_check" CHECK (("workflow_actions"."type" = 'call_routine' and "workflow_actions"."routine_id" is not null and "workflow_actions"."tag_id" is null) or ("workflow_actions"."type" = 'remove_tag' and "workflow_actions"."tag_id" is not null and "workflow_actions"."routine_id" is null))
);
--> statement-breakpoint
CREATE TABLE "workflow_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "workflow_blocks_trigger_type_check" CHECK ("workflow_blocks"."trigger_type" in ('tag_attached'))
);
--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_block_id_workflow_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."workflow_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_routine_id_workflow_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."workflow_routines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_actions" ADD CONSTRAINT "workflow_actions_tag_id_wiki_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."wiki_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_trigger_tag_id_wiki_tags_id_fk" FOREIGN KEY ("trigger_tag_id") REFERENCES "public"."wiki_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_actions_routine_idx" ON "workflow_actions" USING btree ("routine_id");--> statement-breakpoint
CREATE INDEX "workflow_actions_tag_idx" ON "workflow_actions" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "workflow_blocks_wiki_idx" ON "workflow_blocks" USING btree ("wiki_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_blocks_trigger_tag_idx" ON "workflow_blocks" USING btree ("trigger_tag_id");