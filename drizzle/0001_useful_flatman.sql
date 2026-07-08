CREATE TABLE "stored_files" (
	"key" text PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"content_type" text,
	"size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
