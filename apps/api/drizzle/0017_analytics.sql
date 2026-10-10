CREATE TABLE "analytics_snapshots" (
	"wiki_id" text NOT NULL,
	"kind" text NOT NULL,
	"days" integer NOT NULL,
	"target" text NOT NULL,
	"data" jsonb,
	"fetched_at" timestamp with time zone,
	"attempted_at" timestamp with time zone NOT NULL,
	"error" text,
	CONSTRAINT "analytics_snapshots_wiki_id_kind_days_pk" PRIMARY KEY("wiki_id","kind","days"),
	CONSTRAINT "analytics_snapshots_kind_check" CHECK ("analytics_snapshots"."kind" in ('ga', 'search_console'))
);
--> statement-breakpoint
ALTER TABLE "wikis" ADD COLUMN "ga_property_id" text;--> statement-breakpoint
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;