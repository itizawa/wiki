CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"user_email" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"rate_window_start" timestamp with time zone,
	"rate_window_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_tokens_kind_check" CHECK ("oauth_tokens"."kind" in ('access', 'refresh'))
);
--> statement-breakpoint
ALTER TABLE "page_versions" ADD COLUMN "oauth_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "publish_events" ADD COLUMN "oauth_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD COLUMN "oauth_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "structure_commits" ADD COLUMN "oauth_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grants" ADD CONSTRAINT "oauth_grants_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_grant_id_oauth_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_grants_user_idx" ON "oauth_grants" USING btree ("user_email","created_at");--> statement-breakpoint
CREATE INDEX "oauth_tokens_grant_idx" ON "oauth_tokens" USING btree ("grant_id");--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_events" ADD CONSTRAINT "publish_events_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_actions" ADD CONSTRAINT "scheduled_actions_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_commits" ADD CONSTRAINT "structure_commits_oauth_grant_id_oauth_grants_id_fk" FOREIGN KEY ("oauth_grant_id") REFERENCES "public"."oauth_grants"("id") ON DELETE no action ON UPDATE no action;