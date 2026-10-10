CREATE TABLE "page_drafts" (
	"page_id" text NOT NULL,
	"author_email" text NOT NULL,
	"base_version_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body_md" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_drafts_page_id_author_email_pk" PRIMARY KEY("page_id","author_email")
);
--> statement-breakpoint
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;