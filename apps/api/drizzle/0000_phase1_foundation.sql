CREATE TABLE "commit_trees" (
	"commit_id" uuid NOT NULL,
	"tree_id" text NOT NULL,
	"snapshot_id" uuid NOT NULL,
	CONSTRAINT "commit_trees_commit_id_tree_id_pk" PRIMARY KEY("commit_id","tree_id")
);
--> statement-breakpoint
CREATE TABLE "page_links" (
	"from_page_id" text NOT NULL,
	"to_page_id" text NOT NULL,
	CONSTRAINT "page_links_from_page_id_to_page_id_pk" PRIMARY KEY("from_page_id","to_page_id")
);
--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" text NOT NULL,
	"base_version_id" uuid,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"summary" text,
	"author_type" text NOT NULL,
	"source_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_versions_author_type_check" CHECK ("page_versions"."author_type" in ('human', 'ai'))
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"head_version_id" uuid NOT NULL,
	"published_version_id" uuid,
	"visibility" text DEFAULT 'private' NOT NULL,
	"unlisted_key" text,
	"origin" text DEFAULT 'human' NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"first_published_at" timestamp with time zone,
	"monetization" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "pages_unlisted_key_unique" UNIQUE("unlisted_key"),
	CONSTRAINT "pages_visibility_check" CHECK ("pages"."visibility" in ('public', 'unlisted', 'private')),
	CONSTRAINT "pages_origin_check" CHECK ("pages"."origin" in ('human', 'ai_draft'))
);
--> statement-breakpoint
CREATE TABLE "slug_history" (
	"page_id" text NOT NULL,
	"slug" text NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	CONSTRAINT "slug_history_page_id_slug_pk" PRIMARY KEY("page_id","slug")
);
--> statement-breakpoint
CREATE TABLE "structure_branches" (
	"name" text PRIMARY KEY NOT NULL,
	"head_commit_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merged_at" timestamp with time zone,
	CONSTRAINT "structure_branches_kind_check" CHECK ("structure_branches"."kind" in ('main', 'manual', 'ai_proposal'))
);
--> statement-breakpoint
CREATE TABLE "structure_commit_parents" (
	"commit_id" uuid NOT NULL,
	"parent_commit_id" uuid NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "structure_commit_parents_commit_id_parent_commit_id_pk" PRIMARY KEY("commit_id","parent_commit_id")
);
--> statement-breakpoint
CREATE TABLE "structure_commits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text,
	"author_type" text DEFAULT 'human' NOT NULL,
	"source_proposal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tree_nodes" (
	"snapshot_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"kind" text NOT NULL,
	"page_id" text,
	"title" text,
	"parent_node_id" text,
	"position" text NOT NULL,
	CONSTRAINT "tree_nodes_snapshot_id_node_id_pk" PRIMARY KEY("snapshot_id","node_id"),
	CONSTRAINT "tree_nodes_snapshot_page_unique" UNIQUE("snapshot_id","page_id"),
	CONSTRAINT "tree_nodes_kind_check" CHECK ("tree_nodes"."kind" in ('page', 'folder')),
	CONSTRAINT "tree_nodes_shape_check" CHECK (("tree_nodes"."kind" = 'page' and "tree_nodes"."page_id" is not null and "tree_nodes"."node_id" = "tree_nodes"."page_id") or ("tree_nodes"."kind" = 'folder' and "tree_nodes"."page_id" is null and "tree_nodes"."title" is not null))
);
--> statement-breakpoint
CREATE TABLE "tree_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tree_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trees" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "trees_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "commit_trees" ADD CONSTRAINT "commit_trees_commit_id_structure_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."structure_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_trees" ADD CONSTRAINT "commit_trees_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_trees" ADD CONSTRAINT "commit_trees_snapshot_id_tree_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."tree_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_from_page_id_pages_id_fk" FOREIGN KEY ("from_page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slug_history" ADD CONSTRAINT "slug_history_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_branches" ADD CONSTRAINT "structure_branches_head_commit_id_structure_commits_id_fk" FOREIGN KEY ("head_commit_id") REFERENCES "public"."structure_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_commit_parents" ADD CONSTRAINT "structure_commit_parents_commit_id_structure_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."structure_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_commit_parents" ADD CONSTRAINT "structure_commit_parents_parent_fk" FOREIGN KEY ("parent_commit_id") REFERENCES "public"."structure_commits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_snapshot_id_tree_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."tree_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_snapshots" ADD CONSTRAINT "tree_snapshots_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_links_to_idx" ON "page_links" USING btree ("to_page_id");--> statement-breakpoint
CREATE INDEX "page_versions_page_id_idx" ON "page_versions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "tree_nodes_page_id_idx" ON "tree_nodes" USING btree ("page_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trees_one_primary_idx" ON "trees" USING btree ("is_primary") WHERE "trees"."is_primary";