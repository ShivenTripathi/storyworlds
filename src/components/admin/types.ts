/**
 * Wire shapes for /api/admin/*, mirroring src/services/admin.ts's
 * AdminOverview without importing it (this file has no dependency on
 * src/services or src/db).
 */

export interface AdminBookRow {
  id: string;
  title: string;
  owner: string | null;
  status: string;
  visibility: string | null;
  themeArchetype: string | null;
  totalChunks: number | null;
  analysis: { worldStatus: string | null; overlayCount: number };
  spendUsd: number;
  tokens: number;
}

export interface AdminOverview {
  books: AdminBookRow[];
  totals: { books: number; users: number; spendUsd: number; tokensToday: number };
}
