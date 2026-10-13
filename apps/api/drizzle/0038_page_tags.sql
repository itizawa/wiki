CREATE TABLE "page_tags" (
	"page_id" text NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_tags_page_id_tag_id_pk" PRIMARY KEY("page_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_tags_wiki_name_unique" UNIQUE("wiki_id","name")
);
--> statement-breakpoint
ALTER TABLE "page_tags" ADD CONSTRAINT "page_tags_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_tags" ADD CONSTRAINT "page_tags_tag_id_wiki_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."wiki_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_tags" ADD CONSTRAINT "wiki_tags_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_tags_tag_idx" ON "page_tags" USING btree ("tag_id");