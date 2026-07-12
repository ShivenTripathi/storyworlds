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
