CREATE TABLE "page_ratings" (
	"page_id" text NOT NULL,
	"rater_hash" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_ratings_page_id_rater_hash_pk" PRIMARY KEY("page_id","rater_hash"),
	CONSTRAINT "page_ratings_score_check" CHECK ("page_ratings"."score" between 1 and 5)
);
--> statement-breakpoint
ALTER TABLE "wikis" ADD COLUMN "ratings_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "page_ratings" ADD CONSTRAINT "page_ratings_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;