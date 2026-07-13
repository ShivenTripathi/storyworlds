CREATE TABLE "quota_state" (
	"id" integer PRIMARY KEY NOT NULL,
	"exhausted_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
