CREATE TABLE "page_stars" (
	"admin_email" text NOT NULL,
	"page_id" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "page_stars_admin_email_page_id_pk" PRIMARY KEY("admin_email","page_id")
);
--> statement-breakpoint
ALTER TABLE "page_stars" ADD CONSTRAINT "page_stars_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;