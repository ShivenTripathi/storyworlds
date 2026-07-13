/**
 * Wire shapes for /api/admin/*, mirroring src/services/admin.ts's
 * AdminOverview without importing it (this file has no dependency on
 * src/services or src/db).
 */

export type AdminBookClass = "catalog" | "contribution" | "private";

export interface AdminBookRow {
  id: string;
  title: string;
  owner: string | null;
  ownerId: string | null;
  status: string;
  visibility: string | null;
  pricingTier: string | null;
  rightsAttestation: string | null;
  catalogSource: string | null;
  bookClass: AdminBookClass;
  themeArchetype: string | null;
  totalChunks: number | null;
  analysis: { worldStatus: string | null; overlayCount: number };
  spendUsd: number;
  tokens: number;
}

export interface AdminOverview {
  books: AdminBookRow[];
  totals: {
    books: number;
    users: number;
    spendUsd: number;
    tokensToday: number;
  };
}

/**
 * Wire shapes for /api/admin/feedback, mirroring src/services/feedback.ts
 * without importing it (see the file-level comment above).
 */
export type FeedbackKind = "praise" | "idea" | "bug" | "general";
export type FeedbackSentiment = "up" | "down";
export type FeedbackStatus = "new" | "triaged" | "resolved";

export interface FeedbackContext {
  bookId?: string;
  viewport?: { width: number; height: number };
  userAgent?: string;
  referrer?: string;
  appVersion?: string;
  [key: string]: unknown;
}

export interface FeedbackRow {
  id: string;
  userId: string;
  userEmail: string | null;
  kind: FeedbackKind;
  sentiment: FeedbackSentiment | null;
  rating: number | null;
  message: string;
  pathname: string | null;
  context: FeedbackContext | null;
  status: FeedbackStatus;
  adminNote: string | null;
  createdAt: string;
}

export interface FeedbackListResponse {
  items: FeedbackRow[];
  counts: {
    byKind: Record<FeedbackKind, number>;
    bySentiment: { up: number; down: number; none: number };
  };
}

/**
 * Wire shapes for /api/admin/queue, mirroring src/services/queue.ts's
 * QueueStatusDto without importing it (see the file-level comment above).
 */
export interface QueueProcessingItem {
  jobId: string;
  bookId: string;
  title: string;
  stage: string | null;
  progress: number;
  startedAt: string;
}

export interface QueueFailureItem {
  jobId: string;
  bookId: string;
  title: string;
  error: string | null;
  failedAt: string;
  attempts: number;
  willAutoRetry: boolean;
  cooldownEndsAt: string | null;
}

export interface QueueStatusDto {
  processing: QueueProcessingItem[];
  analysisBacklog: { pending: number; running: number; failed: number };
  analysis: { analyzed: number; totalReady: number };
  illustrations: {
    readyPages: number;
    totalPages: number;
    booksWithBacklog: number;
  };
  freeTier: { requestsToday: number; dailyLimit: number; headroomPct: number };
  /** The interactive/background quota split — see src/services/quota.ts. */
  quota: {
    limit: number;
    interactiveUsed: number;
    backgroundUsed: number;
    backgroundRemaining: number;
    exhaustedUntil: string | null;
  };
  recentFailures: QueueFailureItem[];
  generatedAt: string;
}
