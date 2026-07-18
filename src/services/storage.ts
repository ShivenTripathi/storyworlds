import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, dbReady } from "@/db";
import { storedFiles } from "@/db/schema";
import { env } from "@/lib/env";

export interface StorageDriver {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Deletes everything under a key prefix (e.g. `books/{bookId}/`). */
  deletePrefix(prefix: string): Promise<void>;
  getUrl(key: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Local filesystem driver — files under .data/files/${key}
// ---------------------------------------------------------------------------

class LocalStorageDriver implements StorageDriver {
  private root = join(process.cwd(), ".data", "files");

  private resolve(key: string): string {
    // Containment check: keys are minted internally today, but a `../` in a
    // future caller must never escape .data/files.
    const filePath = join(this.root, key);
    if (filePath !== this.root && !filePath.startsWith(this.root + sep)) {
      throw new Error(`storage key escapes root: ${key}`);
    }
    return filePath;
  }

  async put(
    key: string,
    data: Uint8Array,
    _contentType: string,
  ): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  async get(key: string): Promise<Uint8Array> {
    return await readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.resolve(prefix), { recursive: true, force: true });
  }

  async getUrl(key: string): Promise<string> {
    // Not used in M1 — placeholder for a future local file-serving route.
    return `/api/files/${key}`;
  }
}

// ---------------------------------------------------------------------------
// Cloudflare R2 driver (S3-compatible) — @aws-sdk/client-s3
// ---------------------------------------------------------------------------

class R2StorageDriver implements StorageDriver {
  private clientPromise: Promise<import("@aws-sdk/client-s3").S3Client>;
  private bucket: string;

  constructor() {
    this.bucket = env.R2_BUCKET ?? "";
    this.clientPromise = (async () => {
      const { S3Client } = await import("@aws-sdk/client-s3");
      return new S3Client({
        region: "auto",
        endpoint: env.R2_ENDPOINT,
        credentials: {
          accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
          secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
        },
      });
    })();
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    const res = await client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error(`R2 object not found: ${key}`);
    }
    return bytes;
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    await client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async deletePrefix(prefix: string): Promise<void> {
    const { ListObjectsV2Command, DeleteObjectsCommand } =
      await import("@aws-sdk/client-s3");
    const client = await this.clientPromise;
    let continuationToken: string | undefined;
    do {
      const listed = await client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      const objects = (listed.Contents ?? [])
        .map((o) => (o.Key ? { Key: o.Key } : undefined))
        .filter((o): o is { Key: string } => Boolean(o));
      if (objects.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects },
          }),
        );
      }
      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);
  }

  async getUrl(key: string): Promise<string> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const client = await this.clientPromise;
    return await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 },
    );
  }
}

// ---------------------------------------------------------------------------
// DB-backed driver — Neon/PGlite bytea column. Zero-cost prod default: R2
// requires a card, this doesn't. Reads/writes go through src/db/index.ts's
// shared client; served to clients via src/app/api/files/[...key]/route.ts.
// ---------------------------------------------------------------------------

class DbStorageDriver implements StorageDriver {
  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    await dbReady;
    const buf = Buffer.from(data);
    await db
      .insert(storedFiles)
      .values({ key, data: buf, contentType, size: buf.byteLength })
      .onConflictDoUpdate({
        target: storedFiles.key,
        set: { data: buf, contentType, size: buf.byteLength },
      });
  }

  async get(key: string): Promise<Uint8Array> {
    await dbReady;
    const [row] = await db
      .select({ data: storedFiles.data })
      .from(storedFiles)
      .where(eq(storedFiles.key, key))
      .limit(1);
    if (!row) {
      throw new Error(`File not found: ${key}`);
    }
    return new Uint8Array(row.data);
  }

  async delete(key: string): Promise<void> {
    await dbReady;
    await db.delete(storedFiles).where(eq(storedFiles.key, key));
  }

  async deletePrefix(prefix: string): Promise<void> {
    await dbReady;
    // Escape LIKE metacharacters in the prefix, then match `prefix%`.
    const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    await db
      .delete(storedFiles)
      .where(sql`${storedFiles.key} LIKE ${escaped + "%"} ESCAPE '\\'`);
  }

  async getUrl(key: string): Promise<string> {
    return `/api/files/${key}`;
  }
}

function createStorageDriver(): StorageDriver {
  if (env.STORAGE_DRIVER === "r2") return new R2StorageDriver();
  if (env.STORAGE_DRIVER === "db") return new DbStorageDriver();
  return new LocalStorageDriver();
}

export const storage: StorageDriver = createStorageDriver();
