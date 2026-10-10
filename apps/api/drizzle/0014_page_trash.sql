ALTER TABLE "pages" ADD COLUMN "trash_root_id" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "trashed_parent_id" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "trashed_position" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "purged_at" timestamp with time zone;--> statement-breakpoint
-- これまでに削除したページを、1ページずつのまとまりとしてゴミ箱に出す。
-- 子ページは削除のときに繰り上がっていて、元の親は残っていないので、元に戻すと最上位に入る
UPDATE "pages" SET "trash_root_id" = "id" WHERE "deleted_at" IS NOT NULL;
