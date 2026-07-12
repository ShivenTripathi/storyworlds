ALTER TABLE "books" ADD COLUMN "catalog_source" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "blurb" text;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_catalog_source_unique" UNIQUE("catalog_source");