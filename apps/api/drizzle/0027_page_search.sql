-- 索引（gin_trgm_ops）に pg_trgm が要る。拡張を作る権限が無いと、ここで止まる
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "page_search" (
	"page_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_search" ADD CONSTRAINT "page_search_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- いまある全ページの head 版を写す。完全に削除したページは版が無いので入らない。索引は、写したあとに作る（1回で作るため）
INSERT INTO "page_search" ("page_id", "title", "body_md")
SELECT p."id", v."title", v."body_md" FROM "pages" p INNER JOIN "page_versions" v ON v."id" = p."head_version_id";--> statement-breakpoint
CREATE INDEX "page_search_title_trgm_idx" ON "page_search" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "page_search_body_trgm_idx" ON "page_search" USING gin ("body_md" gin_trgm_ops);
