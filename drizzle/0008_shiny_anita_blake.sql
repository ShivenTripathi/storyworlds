CREATE TABLE "reading_activity" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"words_read" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reading_activity_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "reading_activity" ADD CONSTRAINT "reading_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;