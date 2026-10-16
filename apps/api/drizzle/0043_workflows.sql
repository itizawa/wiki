CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "workflows_wiki_name_unique" UNIQUE("wiki_id","name")
);
--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "workflow_id" uuid;--> statement-breakpoint
-- 既存データの移行：ブロックか実行の履歴がある wiki ごとに「ワークフロー」を1つ作り、そこへ入れる（NOT NULL はそのあと）
INSERT INTO "workflows" ("wiki_id", "name")
SELECT "wiki_id", 'ワークフロー' FROM "workflow_blocks"
UNION
SELECT "wiki_id", 'ワークフロー' FROM "workflow_runs";--> statement-breakpoint
UPDATE "workflow_blocks" b SET "workflow_id" = w."id" FROM "workflows" w WHERE w."wiki_id" = b."wiki_id";--> statement-breakpoint
UPDATE "workflow_runs" r SET "workflow_id" = w."id" FROM "workflows" w WHERE w."wiki_id" = r."wiki_id";--> statement-breakpoint
ALTER TABLE "workflow_blocks" ALTER COLUMN "workflow_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_runs" ALTER COLUMN "workflow_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_blocks" ADD CONSTRAINT "workflow_blocks_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_blocks_workflow_idx" ON "workflow_blocks" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_workflow_idx" ON "workflow_runs" USING btree ("workflow_id","created_at");