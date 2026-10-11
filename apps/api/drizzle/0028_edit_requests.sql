CREATE TABLE "edit_request_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text DEFAULT 'suggestion' NOT NULL,
	"base_version_id" uuid NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"original_md" text NOT NULL,
	"replacement_md" text,
	"reason" text,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"accepted_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edit_request_items_request_position_unique" UNIQUE("request_id","position"),
	CONSTRAINT "edit_request_items_kind_check" CHECK ("edit_request_items"."kind" in ('suggestion')),
	CONSTRAINT "edit_request_items_status_check" CHECK ("edit_request_items"."status" in ('open', 'accepted', 'rejected', 'withdrawn')),
	CONSTRAINT "edit_request_items_lines_check" CHECK ("edit_request_items"."start_line" >= 1 and "edit_request_items"."end_line" >= "edit_request_items"."start_line")
);
--> statement-breakpoint
CREATE TABLE "edit_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"page_id" text NOT NULL,
	"comment" text,
	"created_by" uuid NOT NULL,
	"oauth_grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD CONSTRAINT "edit_request_items_request_id_edit_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."edit_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD CONSTRAINT "edit_request_items_base_version_id_page_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD CONSTRAINT "edit_request_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD CONSTRAINT "edit_request_items_accepted_version_id_page_versions_id_fk" FOREIGN KEY ("accepted_version_id") REFERENCES "public"."page_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_requests" ADD CONSTRAINT "edit_requests_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edit_request_items_base_version_idx" ON "edit_request_items" USING btree ("base_version_id");--> statement-breakpoint
CREATE INDEX "edit_request_items_accepted_version_idx" ON "edit_request_items" USING btree ("accepted_version_id");--> statement-breakpoint
CREATE INDEX "edit_request_items_open_idx" ON "edit_request_items" USING btree ("request_id") WHERE "edit_request_items"."status" = 'open';--> statement-breakpoint
CREATE INDEX "edit_requests_page_idx" ON "edit_requests" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "edit_requests_wiki_idx" ON "edit_requests" USING btree ("wiki_id","created_at");