-- ツリーのノードをページだけにする。
-- 既存のフォルダは同じ名前の（本文が空の非公開）ページに置き換え、Inbox は無くして中身を最上位へ出す。
-- 履歴のスナップショットも同じ対応で書き換える（同じフォルダはどのスナップショットでも同じページになる）。
CREATE TABLE "_folder_pages" (
	"node_id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL UNIQUE,
	"version_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL
);--> statement-breakpoint
-- フォルダ名は最も新しいスナップショットのものを使う
INSERT INTO "_folder_pages" ("node_id", "page_id", "title")
SELECT f."node_id", substr(md5(random()::text || f."node_id"), 1, 10), f."title"
FROM (
	SELECT DISTINCT ON (n."node_id") n."node_id", n."title"
	FROM "tree_nodes" n
	JOIN "tree_snapshots" s ON s."id" = n."snapshot_id"
	WHERE n."kind" = 'folder' AND n."node_id" <> '_inbox'
	ORDER BY n."node_id", s."created_at" DESC
) f;--> statement-breakpoint
INSERT INTO "pages" ("id", "slug", "title", "head_version_id")
SELECT
	"page_id",
	coalesce(nullif(trim(both '-' from left(trim(both '-' from regexp_replace(lower("title"), '[^[:alnum:]]+', '-', 'g')), 80)), ''), 'untitled'),
	"title",
	"version_id"
FROM "_folder_pages";--> statement-breakpoint
INSERT INTO "page_versions" ("id", "page_id", "title", "body_md", "author_type")
SELECT "version_id", "page_id", "title", '', 'human' FROM "_folder_pages";--> statement-breakpoint
ALTER TABLE "tree_nodes" DROP CONSTRAINT "tree_nodes_kind_check";--> statement-breakpoint
ALTER TABLE "tree_nodes" DROP CONSTRAINT "tree_nodes_shape_check";--> statement-breakpoint
UPDATE "tree_nodes" SET "parent_node_id" = NULL WHERE "parent_node_id" = '_inbox';--> statement-breakpoint
DELETE FROM "tree_nodes" WHERE "node_id" = '_inbox';--> statement-breakpoint
UPDATE "tree_nodes" n SET "parent_node_id" = f."page_id" FROM "_folder_pages" f WHERE n."parent_node_id" = f."node_id";--> statement-breakpoint
UPDATE "tree_nodes" n SET "node_id" = f."page_id", "page_id" = f."page_id" FROM "_folder_pages" f WHERE n."node_id" = f."node_id";--> statement-breakpoint
DROP TABLE "_folder_pages";--> statement-breakpoint
ALTER TABLE "tree_nodes" ALTER COLUMN "page_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tree_nodes" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "tree_nodes" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_page_check" CHECK ("tree_nodes"."node_id" = "tree_nodes"."page_id");
