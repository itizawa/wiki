-- 構造の履歴（コミット・スナップショット）をやめる。ツリーは、いまの状態だけを tree_nodes に持つ。
-- main の head が指すスナップショットのノードだけを残し、そのツリーの行にする。
ALTER TABLE "tree_nodes" ADD COLUMN "tree_id" text;--> statement-breakpoint
DELETE FROM "tree_nodes" n WHERE NOT EXISTS (
  SELECT 1 FROM "structure_branches" b
  JOIN "commit_trees" ct ON ct."commit_id" = b."head_commit_id"
  WHERE b."name" = 'main' AND ct."snapshot_id" = n."snapshot_id"
);--> statement-breakpoint
UPDATE "tree_nodes" n SET "tree_id" = s."tree_id" FROM "tree_snapshots" s WHERE s."id" = n."snapshot_id";--> statement-breakpoint
ALTER TABLE "tree_nodes" DROP COLUMN "snapshot_id";--> statement-breakpoint
DROP TABLE "structure_branches";--> statement-breakpoint
DROP TABLE "commit_trees";--> statement-breakpoint
DROP TABLE "structure_commit_parents";--> statement-breakpoint
DROP TABLE "structure_commits";--> statement-breakpoint
DROP TABLE "tree_snapshots";--> statement-breakpoint
ALTER TABLE "tree_nodes" ALTER COLUMN "tree_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_tree_id_node_id_pk" PRIMARY KEY("tree_id","node_id");--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_tree_page_unique" UNIQUE("tree_id","page_id");
