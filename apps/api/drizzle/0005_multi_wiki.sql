-- wiki を複数持てるようにする。いまある行は、すべて最初の wiki（key = 'wiki'）に入れる。
-- 表示名は primary ツリーの名前を引き継ぐ（公開サイトの SITE_NAME はここからは読めないので、移行のあとに管理画面で直す）。
CREATE TABLE "wikis" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	CONSTRAINT "wikis_key_unique" UNIQUE("key")
);
--> statement-breakpoint
INSERT INTO "wikis" ("id", "key", "name")
VALUES ('w_' || substr(md5(random()::text), 1, 10), 'wiki', coalesce((SELECT "name" FROM "trees" WHERE "is_primary" LIMIT 1), 'wiki'));--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "wiki_id" text;--> statement-breakpoint
ALTER TABLE "publish_events" ADD COLUMN "wiki_id" text;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD COLUMN "wiki_id" text;--> statement-breakpoint
ALTER TABLE "rules" ADD COLUMN "wiki_id" text;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "wiki_id" text;--> statement-breakpoint
ALTER TABLE "structure_branches" ADD COLUMN "wiki_id" text;--> statement-breakpoint
ALTER TABLE "structure_commits" ADD COLUMN "wiki_id" text;--> statement-breakpoint
ALTER TABLE "trees" ADD COLUMN "wiki_id" text;--> statement-breakpoint
UPDATE "pages" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
UPDATE "publish_events" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
UPDATE "rule_runs" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
UPDATE "rules" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
UPDATE "scheduled_actions" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
UPDATE "structure_branches" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
UPDATE "structure_commits" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
UPDATE "trees" SET "wiki_id" = (SELECT "id" FROM "wikis" WHERE "key" = 'wiki');--> statement-breakpoint
ALTER TABLE "pages" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_events" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rule_runs" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rules" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_branches" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "structure_commits" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trees" ALTER COLUMN "wiki_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_events" ADD CONSTRAINT "publish_events_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_branches" ADD CONSTRAINT "structure_branches_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_commits" ADD CONSTRAINT "structure_commits_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trees" ADD CONSTRAINT "trees_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- 定型ルールの id と main は wiki ごとに重なるので、主キーに wiki_id を含める
ALTER TABLE "rule_runs" DROP CONSTRAINT "rule_runs_rule_id_rules_id_fk";--> statement-breakpoint
ALTER TABLE "rules" DROP CONSTRAINT "rules_pkey";--> statement-breakpoint
ALTER TABLE "rules" ADD CONSTRAINT "rules_wiki_id_id_pk" PRIMARY KEY("wiki_id","id");--> statement-breakpoint
ALTER TABLE "rule_runs" ADD CONSTRAINT "rule_runs_rule_fk" FOREIGN KEY ("wiki_id","rule_id") REFERENCES "public"."rules"("wiki_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_branches" DROP CONSTRAINT "structure_branches_pkey";--> statement-breakpoint
ALTER TABLE "structure_branches" ADD CONSTRAINT "structure_branches_wiki_id_name_pk" PRIMARY KEY("wiki_id","name");--> statement-breakpoint
ALTER TABLE "trees" DROP CONSTRAINT "trees_key_unique";--> statement-breakpoint
ALTER TABLE "trees" ADD CONSTRAINT "trees_wiki_key_unique" UNIQUE("wiki_id","key");--> statement-breakpoint
DROP INDEX "trees_one_primary_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "trees_one_primary_idx" ON "trees" USING btree ("wiki_id") WHERE "trees"."is_primary";--> statement-breakpoint
DROP INDEX "pages_updated_at_idx";--> statement-breakpoint
CREATE INDEX "pages_wiki_updated_at_idx" ON "pages" USING btree ("wiki_id","updated_at");--> statement-breakpoint
DROP INDEX "rule_runs_rule_idx";--> statement-breakpoint
CREATE INDEX "rule_runs_rule_idx" ON "rule_runs" USING btree ("wiki_id","rule_id","created_at");
