CREATE TABLE "page_views_daily" (
	"wiki_id" text NOT NULL,
	"page_id" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "page_views_daily_page_id_day_pk" PRIMARY KEY("page_id","day")
);
--> statement-breakpoint
ALTER TABLE "page_views_daily" ADD CONSTRAINT "page_views_daily_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_views_daily" ADD CONSTRAINT "page_views_daily_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_views_daily_wiki_day_idx" ON "page_views_daily" USING btree ("wiki_id","day");