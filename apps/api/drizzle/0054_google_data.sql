CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"connected_by" uuid,
	"connected_by_label" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "wiki_google_properties" (
	"wiki_id" text PRIMARY KEY NOT NULL,
	"search_console_site" text,
	"ga_property_id" text,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_google_properties" ADD CONSTRAINT "wiki_google_properties_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;