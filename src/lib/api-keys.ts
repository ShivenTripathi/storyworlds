import { randomBytes, createHash } from "node:crypto";
import { eq, isNull, and } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { apiKeys } from "@/db/schema";
import { ApiError } from "@/lib/errors";

const KEY_PREFIX = "sw_live_";

/** Ceiling on live (non-revoked) keys per user — keeps a scripted caller from
 * inserting unbounded rows. */
const MAX_ACTIVE_KEYS_PER_USER = 10;

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface CreatedApiKey {
  id: string;
  name: string | null;
  prefix: string;
  key: string; // full secret — only ever returned here, at creation time
  createdAt: Date;
}

/**
 * Mints a new API key for `userId`. The full key is only ever available at
 * creation time — only its sha256 hash + a display prefix are persisted.
 */
export async function createApiKey(
  userId: string,
  name?: string,
): Promise<CreatedApiKey> {
  await dbReady;

  const active = await db
    .select({ id: apiKeys.id })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)));
  if (active.length >= MAX_ACTIVE_KEYS_PER_USER) {
    throw new ApiError(
      409,
      "too_many_keys",
      `You already have ${MAX_ACTIVE_KEYS_PER_USER} active keys — revoke one first.`,
    );
  }

  const secret = randomBytes(32).toString("hex");
  const key = `${KEY_PREFIX}${secret}`;
  const prefix = key.slice(0, 12);
  const keyHash = hashKey(key);

  const [row] = await db
    .insert(apiKeys)
    .values({ userId, keyHash, prefix, name: name ?? null })
    .returning();

  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix ?? prefix,
    key,
    createdAt: row.createdAt,
  };
}

export interface ApiKeySummary {
  id: string;
  name: string | null;
  prefix: string | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  await dbReady;
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));
  return rows;
}

/** Revokes a key (sets revokedAt); no-ops if it doesn't belong to userId. */
export async function revokeApiKey(
  userId: string,
  keyId: string,
): Promise<void> {
  await dbReady;
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.userId, userId)));
}

export interface VerifiedApiKey {
  userId: string;
  keyId: string;
}

/**
 * Verifies a raw `Authorization: Bearer sw_live_...` header value, looking
 * up by hash (never by prefix alone — the hash lookup IS the auth check).
 * Rejects missing/malformed headers, unknown keys, and revoked keys.
 * Fire-and-forgets a lastUsedAt touch so verification latency isn't coupled
 * to that write.
 */
async function verifyApiKey(
  authHeader: string | null,
): Promise<VerifiedApiKey> {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthorized", "Missing API key.");
  }
  const key = authHeader.slice("Bearer ".length).trim();
  if (!key.startsWith(KEY_PREFIX)) {
    throw new ApiError(401, "unauthorized", "Invalid API key.");
  }

  await dbReady;
  const keyHash = hashKey(key);

  const [row] = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1);

  if (!row || !row.userId) {
    throw new ApiError(401, "unauthorized", "Invalid or revoked API key.");
  }

  // Fire-and-forget usage touch — never block/fail the request on this.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.id))
    .catch((err) =>
      console.error("[api-keys] failed to update lastUsedAt:", err),
    );

  return { userId: row.userId, keyId: row.id };
}

/** Convenience wrapper for route handlers: reads the Authorization header. */
export async function requireApiKey(req: Request): Promise<VerifiedApiKey> {
  return verifyApiKey(req.headers.get("authorization"));
}
