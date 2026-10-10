CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by" uuid,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invites_role_check" CHECK ("invites"."role" in ('admin', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text,
	"email" text NOT NULL,
	"name" text,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
CREATE TABLE "wiki_members" (
	"wiki_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invite_id" uuid,
	CONSTRAINT "wiki_members_wiki_id_user_id_pk" PRIMARY KEY("wiki_id","user_id"),
	CONSTRAINT "wiki_members_role_check" CHECK ("wiki_members"."role" in ('admin', 'editor'))
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_used_by_users_id_fk" FOREIGN KEY ("used_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_invite_id_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_wiki_idx" ON "invites" USING btree ("wiki_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "wiki_members_user_idx" ON "wiki_members" USING btree ("user_id");--> statement-breakpoint
-- スターと下書きを、メールアドレスではなくユーザーで持つ。いまあるメールアドレスには、メールアドレスだけのユーザーの行を作って結びつける
-- （オーナーにするかどうかは、このあと pnpm db:migrate が ADMIN_EMAILS から決める。最初の Google ログインでアカウント ID と結びつく）
INSERT INTO "users" ("email")
SELECT DISTINCT lower("email") FROM (
	SELECT "admin_email" AS "email" FROM "page_stars"
	UNION SELECT "author_email" FROM "page_drafts"
) AS "e";--> statement-breakpoint
ALTER TABLE "page_stars" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "page_drafts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
UPDATE "page_stars" SET "user_id" = "users"."id" FROM "users" WHERE "users"."email" = lower("page_stars"."admin_email");--> statement-breakpoint
UPDATE "page_drafts" SET "user_id" = "users"."id" FROM "users" WHERE "users"."email" = lower("page_drafts"."author_email");--> statement-breakpoint
ALTER TABLE "page_stars" DROP CONSTRAINT "page_stars_admin_email_page_id_pk";--> statement-breakpoint
ALTER TABLE "page_drafts" DROP CONSTRAINT "page_drafts_page_id_author_email_pk";--> statement-breakpoint
ALTER TABLE "page_stars" DROP COLUMN "admin_email";--> statement-breakpoint
ALTER TABLE "page_drafts" DROP COLUMN "author_email";--> statement-breakpoint
ALTER TABLE "page_stars" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "page_drafts" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "page_stars" ADD CONSTRAINT "page_stars_user_id_page_id_pk" PRIMARY KEY("user_id","page_id");--> statement-breakpoint
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_page_id_user_id_pk" PRIMARY KEY("page_id","user_id");--> statement-breakpoint
ALTER TABLE "page_stars" ADD CONSTRAINT "page_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_drafts" ADD CONSTRAINT "page_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
