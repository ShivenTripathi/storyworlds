CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"key_hash" text NOT NULL,
	"prefix" text,
	"name" text,
	"scopes" jsonb,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text,
	"title" text NOT NULL,
	"author" text,
	"source_key" text,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"total_chunks" integer,
	"total_words" integer,
	"visibility" text DEFAULT 'private',
	"price_cents" integer DEFAULT 0,
	"content_hash" text,
	"theme_archetype" text DEFAULT 'classic',
	"image_interval" integer DEFAULT 5,
	"token_budget_usd" numeric(8, 4) DEFAULT '5.00',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"chunk_idx_at_send" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"book_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_sessions_user_book_entity_mode_unique" UNIQUE("user_id","book_id","entity_id","mode")
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"book_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"page_number" integer,
	"word_count" integer,
	"text" text NOT NULL,
	CONSTRAINT "chunks_book_id_idx_unique" UNIQUE("book_id","idx")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"book_id" uuid NOT NULL,
	"id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"introduced_at_chunk" integer,
	"attributes" jsonb,
	"visual_description" text,
	CONSTRAINT "entities_book_id_id_pk" PRIMARY KEY("book_id","id")
);
--> statement-breakpoint
CREATE TABLE "entity_aliases" (
	"book_id" uuid NOT NULL,
	"alias_norm" text NOT NULL,
	"entity_id" text NOT NULL,
	CONSTRAINT "entity_aliases_book_id_alias_norm_pk" PRIMARY KEY("book_id","alias_norm")
);
--> statement-breakpoint
CREATE TABLE "images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"chunk_idx" integer,
	"storage_key" text NOT NULL,
	"prompt" text,
	"model" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid,
	"user_id" text,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued',
	"progress" integer DEFAULT 0,
	"stage" text,
	"detail" jsonb,
	"inngest_run_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "overlays" (
	"book_id" uuid NOT NULL,
	"chunk_idx" integer NOT NULL,
	"status" text DEFAULT 'ready',
	"active_entity_ids" jsonb,
	"unresolved_mentions" jsonb,
	"active_commitments" jsonb,
	"active_unknowns" jsonb,
	"interpretive_lens" jsonb,
	"scene_description" text,
	"suggested_questions" jsonb,
	"image_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "overlays_book_id_chunk_idx_pk" PRIMARY KEY("book_id","chunk_idx")
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"book_id" uuid,
	"stripe_payment_intent" text,
	"amount_cents" integer,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_user_book_unique" UNIQUE("user_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"user_id" text NOT NULL,
	"book_id" uuid NOT NULL,
	"current_chunk" integer DEFAULT 0,
	"frontier_chunk" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_user_id_book_id_pk" PRIMARY KEY("user_id","book_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"plan" text DEFAULT 'free',
	"status" text,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"book_id" uuid,
	"user_id" text,
	"provider" text,
	"model" text,
	"operation" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"role" text DEFAULT 'reader' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_references" (
	"book_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending',
	"setting_description" text,
	"visual_style" jsonb,
	"timeline" jsonb,
	"commitments" jsonb,
	"unknowns" jsonb,
	"segment_results" jsonb,
	"model_versions" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_chat_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_aliases" ADD CONSTRAINT "entity_aliases_entity_fk" FOREIGN KEY ("book_id","entity_id") REFERENCES "public"."entities"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overlays" ADD CONSTRAINT "overlays_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_references" ADD CONSTRAINT "world_references_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_owner_id_idx" ON "books" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "chunks_book_id_idx" ON "chunks" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "images_book_id_chunk_idx_idx" ON "images" USING btree ("book_id","chunk_idx");--> statement-breakpoint
CREATE INDEX "jobs_book_id_status_idx" ON "jobs" USING btree ("book_id","status");--> statement-breakpoint
CREATE INDEX "usage_events_book_id_idx" ON "usage_events" USING btree ("book_id");