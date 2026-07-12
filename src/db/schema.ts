import {
  bigserial,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// bytea column type — drizzle-orm/pg-core has no built-in bytea helper.
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  email: text("email"),
  role: text("role").default("reader").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// books
// ---------------------------------------------------------------------------
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => users.id),
    title: text("title").notNull(),
    author: text("author"),
    sourceKey: text("source_key"), // storage key of the original uploaded file
    // Format of the original uploaded/ingested source: 'pdf' | 'epub' |
    // 'txt'. Null for pre-existing rows and books with no stored source
    // (e.g. catalog books created via createBookFromText).
    sourceFormat: text("source_format"),
    status: text("status").notNull().default("uploaded"),
    // 'uploaded' | 'extracting' | 'analyzing' | 'ready' | 'failed'
    totalChunks: integer("total_chunks"),
    totalWords: integer("total_words"),
    visibility: text("visibility").default("private"), // 'private' | 'published'
    priceCents: integer("price_cents").default(0),
    // Visibility/monetization model (see CLAUDE.md "THE MODEL"): a book's
    // analysis cost is only amortizable if the analyzed world can be
    // shared. Public contributions (visibility='published') are shared
    // across every reader and subsidized; private books are single-reader,
    // so their (non-amortizable) analysis cost is premium-priced.
    // 'public_subsidized' | 'private_premium' | 'catalog' (Gutenberg seed —
    // also shared/free, but distinct from user contributions for admin
    // reporting). Nullable/default null for pre-existing rows; treated as
    // 'private_premium' by application code when absent.
    pricingTier: text("pricing_tier"),
    // The waiver recorded when a user contributes a book to the public
    // library: 'public_domain' (the work itself is public domain) or
    // 'owned_contributed' (the uploader owns the work and waives exclusive
    // rights to contribute it). Null for private books and for books not
    // yet run through the contribution flow.
    rightsAttestation: text("rights_attestation"),
    // The user who contributed this book to the public library, if any.
    // Distinct from ownerId so admin reporting can tell "who grew the
    // shared catalog" apart from "who currently owns this row" even if
    // ownership ever changes.
    contributedByUserId: text("contributed_by_user_id").references(
      () => users.id,
    ),
    contentHash: text("content_hash"),
    themeArchetype: text("theme_archetype").default("classic"),
    imageInterval: integer("image_interval").default(5),
    tokenBudgetUsd: numeric("token_budget_usd", {
      precision: 8,
      scale: 4,
    }).default("5.00"),
    // Dedup key for auto-ingested public-domain catalog books, e.g.
    // 'gutenberg:84'. Null for user-uploaded books.
    catalogSource: text("catalog_source"),
    // Short catalog description shown on the Discover tab.
    blurb: text("blurb"),
    // Storage key (src/services/storage.ts) of the generated cover
    // illustration, e.g. 'books/{bookId}/cover.img'. Null until analysis
    // has produced a visualStyle AND cover generation has succeeded (best-
    // effort — see src/services/cover.ts); render the typographic fallback
    // cover (src/components/shelf/TypographicCover.tsx) while null.
    coverStorageKey: text("cover_storage_key"),
    // Spoiler-free "Did you know?" facts (author/history/trivia/legacy) shown
    // BEFORE reading to make the book more inviting to open — see
    // FunFactsSchema (src/domain/schemas.ts) / src/ai/prompts/funfacts.ts.
    // Shape: { facts: { text: string, category: 'author'|'history'|'trivia'|
    // 'legacy' }[] }. Null until generated (best-effort, alongside analysis
    // or via the backfill sweep — src/jobs/sweep-funfacts.ts); render
    // nothing while null/empty rather than a placeholder.
    funFacts: jsonb("fun_facts"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("books_owner_id_idx").on(table.ownerId),
    unique("books_catalog_source_unique").on(table.catalogSource),
  ],
);

// ---------------------------------------------------------------------------
// chunks
// ---------------------------------------------------------------------------
export const chunks = pgTable(
  "chunks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    pageNumber: integer("page_number"),
    wordCount: integer("word_count"),
    text: text("text").notNull(),
  },
  (table) => [
    index("chunks_book_id_idx").on(table.bookId),
    unique("chunks_book_id_idx_unique").on(table.bookId, table.idx),
  ],
);

// ---------------------------------------------------------------------------
// worldReferences
// ---------------------------------------------------------------------------
export const worldReferences = pgTable("world_references", {
  bookId: uuid("book_id")
    .primaryKey()
    .references(() => books.id, { onDelete: "cascade" }),
  status: text("status").default("pending"),
  settingDescription: text("setting_description"),
  visualStyle: jsonb("visual_style"),
  timeline: jsonb("timeline"),
  commitments: jsonb("commitments"),
  unknowns: jsonb("unknowns"),
  segmentResults: jsonb("segment_results"),
  modelVersions: jsonb("model_versions"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// entities
// ---------------------------------------------------------------------------
export const entities = pgTable(
  "entities",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    id: text("id").notNull(), // slug e.g. 'char:paul-atreides'
    name: text("name").notNull(),
    kind: text("kind").notNull(), // 'character' | 'location' | 'object' | 'faction'
    introducedAtChunk: integer("introduced_at_chunk"),
    attributes: jsonb("attributes"),
    visualDescription: text("visual_description"),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.id] })],
);

// ---------------------------------------------------------------------------
// entityAliases
// ---------------------------------------------------------------------------
export const entityAliases = pgTable(
  "entity_aliases",
  {
    bookId: uuid("book_id").notNull(),
    aliasNorm: text("alias_norm").notNull(),
    entityId: text("entity_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.bookId, table.aliasNorm] }),
    foreignKey({
      columns: [table.bookId, table.entityId],
      foreignColumns: [entities.bookId, entities.id],
      name: "entity_aliases_entity_fk",
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// overlays
// ---------------------------------------------------------------------------
export const overlays = pgTable(
  "overlays",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull(),
    status: text("status").default("ready"), // 'ready' | 'generating' | 'failed'
    activeEntityIds: jsonb("active_entity_ids"), // text[] of slugs
    unresolvedMentions: jsonb("unresolved_mentions"),
    activeCommitments: jsonb("active_commitments"),
    activeUnknowns: jsonb("active_unknowns"),
    interpretiveLens: jsonb("interpretive_lens"),
    sceneDescription: text("scene_description"),
    suggestedQuestions: jsonb("suggested_questions"),
    imageId: uuid("image_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.bookId, table.chunkIdx] })],
);

// ---------------------------------------------------------------------------
// images
// ---------------------------------------------------------------------------
export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx"),
    storageKey: text("storage_key").notNull(),
    prompt: text("prompt"),
    model: text("model"),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("images_book_id_chunk_idx_idx").on(table.bookId, table.chunkIdx),
  ],
);

// ---------------------------------------------------------------------------
// chatSessions
// ---------------------------------------------------------------------------
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    mode: text("mode").notNull(), // 'story_so_far' | 'after_ending'
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("chat_sessions_user_book_entity_mode_unique").on(
      table.userId,
      table.bookId,
      table.entityId,
      table.mode,
    ),
  ],
);

// ---------------------------------------------------------------------------
// chatMessages
// ---------------------------------------------------------------------------
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull(),
    chunkIdxAtSend: integer("chunk_idx_at_send"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("chat_messages_session_id_idx").on(table.sessionId)],
);

// ---------------------------------------------------------------------------
// readingProgress
// ---------------------------------------------------------------------------
export const readingProgress = pgTable(
  "reading_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    currentChunk: integer("current_chunk").default(0),
    frontierChunk: integer("frontier_chunk").default(0), // max chunk ever reached — spoiler gate
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.bookId] })],
);

// ---------------------------------------------------------------------------
// readingActivity — per-user-per-day rollup (NOT per-event) powering the
// GitHub-contribution-style reading heatmap + streaks (src/domain/streak.ts,
// src/services/analytics.ts getReadingActivity). `day` is a UTC calendar day
// stored as a plain date string ('YYYY-MM-DD', mode: 'string') so streak/
// heatmap math never has to fight Postgres `date` <-> JS `Date` timezone
// coercion. Composite primary key (userId, day) IS the "unique per user per
// day" constraint — same pattern as `readingProgress` above — so an upsert
// targets [userId, day] and increments `wordsRead` (see
// src/services/books.ts recordReadingActivity).
// ---------------------------------------------------------------------------
export const readingActivity = pgTable(
  "reading_activity",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    day: date("day", { mode: "string" }).notNull(),
    wordsRead: integer("words_read").default(0).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);

// ---------------------------------------------------------------------------
// jobs
// ---------------------------------------------------------------------------
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id"),
    userId: text("user_id"),
    kind: text("kind").notNull(),
    status: text("status").default("queued"),
    progress: integer("progress").default(0),
    stage: text("stage"),
    detail: jsonb("detail"),
    inngestRunId: text("inngest_run_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("jobs_book_id_status_idx").on(table.bookId, table.status)],
);

// ---------------------------------------------------------------------------
// usageEvents
// ---------------------------------------------------------------------------
export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bookId: uuid("book_id"),
    userId: text("user_id"),
    provider: text("provider"),
    model: text("model"),
    operation: text("operation"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("usage_events_book_id_idx").on(table.bookId)],
);

// ---------------------------------------------------------------------------
// purchases
// ---------------------------------------------------------------------------
export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").references(() => users.id),
    bookId: uuid("book_id").references(() => books.id, {
      onDelete: "cascade",
    }),
    stripePaymentIntent: text("stripe_payment_intent"),
    amountCents: integer("amount_cents"),
    status: text("status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("purchases_user_book_unique").on(table.userId, table.bookId),
  ],
);

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  plan: text("plan").default("free"),
  status: text("status"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// storedFiles — DB-backed blob storage (zero-cost storage driver; see
// src/services/storage.ts DbStorageDriver). Used in prod instead of R2,
// which requires a card.
// ---------------------------------------------------------------------------
export const storedFiles = pgTable("stored_files", {
  key: text("key").primaryKey(),
  data: bytea("data").notNull(),
  contentType: text("content_type"),
  size: integer("size"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ---------------------------------------------------------------------------
// achievements
// ---------------------------------------------------------------------------
export const achievements = pgTable(
  "achievements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    // 'full_cast' | 'cartographer' | 'deep_reader' | 'streak_7' | 'first_light' | ...
    kind: text("kind").notNull(),
    bookId: uuid("book_id").references(() => books.id, {
      onDelete: "cascade",
    }),
    // Free-form reference for the achievement (e.g. an entity slug for a
    // per-character unlock); null for book-level or account-level kinds.
    refId: text("ref_id"),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    metadata: jsonb("metadata"),
  },
  (table) => [
    // Unlocks once per (user, kind, book, ref). Note: Postgres treats NULLs
    // as distinct in unique constraints (same latent behavior as
    // chatSessions' nullable-userId unique above), so an account-level kind
    // with bookId/refId both null could in principle insert more than one
    // row; callers should still upsert defensively (onConflictDoNothing)
    // rather than relying on the constraint alone for those rows.
    unique("achievements_user_kind_book_ref_unique").on(
      table.userId,
      table.kind,
      table.bookId,
      table.refId,
    ),
  ],
);

// ---------------------------------------------------------------------------
// feedback — reader-submitted feedback (praise/idea/bug/general), captured
// with tracing about what the reader was doing (pathname + context) so an
// admin can reproduce it without asking follow-up questions.
// ---------------------------------------------------------------------------
export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(), // 'praise' | 'idea' | 'bug' | 'general'
    sentiment: text("sentiment"), // 'up' | 'down' | null (optional)
    rating: integer("rating"), // 1-5 rubric, optional
    message: text("message").notNull(),
    // The page the reader was on when they opened the widget.
    pathname: text("pathname"),
    // Auto-captured tracing, never asked for: { bookId?, viewport: {width,
    // height}, userAgent, referrer, appVersion? }.
    context: jsonb("context"),
    status: text("status").default("new").notNull(), // 'new' | 'triaged' | 'resolved'
    adminNote: text("admin_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("feedback_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// apiKeys
// ---------------------------------------------------------------------------
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").references(() => users.id),
  keyHash: text("key_hash").notNull().unique(),
  prefix: text("prefix"),
  name: text("name"),
  scopes: jsonb("scopes"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
