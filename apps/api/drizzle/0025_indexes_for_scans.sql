DROP INDEX "pages_wiki_updated_at_idx";--> statement-breakpoint
CREATE INDEX "page_versions_base_version_idx" ON "page_versions" USING btree ("base_version_id");--> statement-breakpoint
CREATE INDEX "page_views_daily_day_idx" ON "page_views_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "pages_wiki_updated_at_id_idx" ON "pages" USING btree ("wiki_id","updated_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "pages_head_version_idx" ON "pages" USING btree ("head_version_id");--> statement-breakpoint
CREATE INDEX "pages_published_version_idx" ON "pages" USING btree ("published_version_id");--> statement-breakpoint
CREATE INDEX "pages_trash_root_idx" ON "pages" USING btree ("trash_root_id") WHERE "pages"."deleted_at" is not null and "pages"."purged_at" is null;--> statement-breakpoint
CREATE INDEX "scheduled_actions_version_idx" ON "scheduled_actions" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "scheduled_actions_wiki_run_at_idx" ON "scheduled_actions" USING btree ("wiki_id","run_at");