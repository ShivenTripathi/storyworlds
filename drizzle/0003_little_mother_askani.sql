ALTER TABLE "books" ADD COLUMN "pricing_tier" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "rights_attestation" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "contributed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_contributed_by_user_id_users_id_fk" FOREIGN KEY ("contributed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;