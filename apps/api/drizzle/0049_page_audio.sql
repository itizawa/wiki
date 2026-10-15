CREATE TABLE "page_audio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"page_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid
);
--> statement-breakpoint
ALTER TABLE "page_audio" ADD CONSTRAINT "page_audio_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audio" ADD CONSTRAINT "page_audio_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audio" ADD CONSTRAINT "page_audio_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "page_audio_page_idx" ON "page_audio" USING btree ("page_id","created_at");