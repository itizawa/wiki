CREATE TABLE "cost_snapshots" (
	"service" text NOT NULL,
	"period" text NOT NULL,
	"usage" jsonb,
	"fetched_at" timestamp with time zone,
	"attempted_at" timestamp with time zone NOT NULL,
	"error" text,
	CONSTRAINT "cost_snapshots_service_period_pk" PRIMARY KEY("service","period")
);
