CREATE TABLE "edit_request_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"oauth_grant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "edit_request_comments_body_check" CHECK (btrim("edit_request_comments"."body") <> '')
);
--> statement-breakpoint
ALTER TABLE "edit_request_items" DROP CONSTRAINT "edit_request_items_kind_check";--> statement-breakpoint
ALTER TABLE "edit_request_items" DROP CONSTRAINT "edit_request_items_status_check";--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD COLUMN "note_body" text;--> statement-breakpoint
ALTER TABLE "edit_request_comments" ADD CONSTRAINT "edit_request_comments_item_id_edit_request_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."edit_request_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request_comments" ADD CONSTRAINT "edit_request_comments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "edit_request_comments" ADD CONSTRAINT "edit_request_comments_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edit_request_comments_item_idx" ON "edit_request_comments" USING btree ("item_id","created_at");--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD CONSTRAINT "edit_request_items_kind_shape_check" CHECK (("edit_request_items"."kind" = 'suggestion' and "edit_request_items"."replacement_md" is not null and "edit_request_items"."note_body" is null and "edit_request_items"."status" <> 'resolved') or ("edit_request_items"."kind" = 'note' and "edit_request_items"."replacement_md" is null and "edit_request_items"."reason" is null and "edit_request_items"."accepted_version_id" is null and "edit_request_items"."note_body" is not null and btrim("edit_request_items"."note_body") <> '' and "edit_request_items"."status" not in ('accepted', 'rejected')));--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD CONSTRAINT "edit_request_items_kind_check" CHECK ("edit_request_items"."kind" in ('suggestion', 'note'));--> statement-breakpoint
ALTER TABLE "edit_request_items" ADD CONSTRAINT "edit_request_items_status_check" CHECK ("edit_request_items"."status" in ('open', 'accepted', 'rejected', 'resolved', 'withdrawn'));