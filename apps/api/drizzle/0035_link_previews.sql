CREATE TABLE "link_previews" (
	"url" text PRIMARY KEY NOT NULL,
	"ok" boolean NOT NULL,
	"title" text,
	"description" text,
	"image_url" text,
	"site_name" text,
	"fetched_at" timestamp with time zone NOT NULL
);
