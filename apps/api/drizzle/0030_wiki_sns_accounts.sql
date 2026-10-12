CREATE TABLE "wiki_sns_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" text NOT NULL,
	"connected_by" uuid,
	"connected_by_label" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_sns_accounts_wiki_provider_key" UNIQUE("wiki_id","provider"),
	CONSTRAINT "wiki_sns_accounts_provider_check" CHECK ("wiki_sns_accounts"."provider" in ('x'))
);
--> statement-breakpoint
ALTER TABLE "wiki_sns_accounts" ADD CONSTRAINT "wiki_sns_accounts_wiki_id_wikis_id_fk" FOREIGN KEY ("wiki_id") REFERENCES "public"."wikis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_sns_accounts" ADD CONSTRAINT "wiki_sns_accounts_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;