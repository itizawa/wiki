ALTER TABLE "page_drafts" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "author_email" text;--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "keep" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- すでにある下書きは、始めた時刻が分からないので、最後に保存した時刻を入れる（足した列の既定値のままだと、このマイグレーションを流した時刻になる）
UPDATE "page_drafts" SET "created_at" = "updated_at";
