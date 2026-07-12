/**
 * Service-level tests for createBookFromUpload / detectBookFormat — the
 * unified pdf/epub/txt upload path (src/services/books.ts). Runs against a
 * real in-memory PGlite database (pushed straight from src/db/schema.ts, so
 * it can never drift from the code under test) and an in-memory fake of
 * src/services/storage.ts, so nothing touches disk, .data/pglite, or a
 * running server. Same isolation pattern as
 * src/domain/__tests__/persistence-privacy.integration.test.ts.
 */
import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { pushSchema } = await import("drizzle-kit/api");
  const schema = await import("@/db/schema");
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const dbReady = pushSchema(schema, db as never)
    .then(({ apply }) => apply())
    .then(() => db);
  return { db, dbReady, schema };
});

const fakeFiles = new Map<string, { data: Uint8Array; contentType: string }>();

vi.mock("@/services/storage", () => ({
  storage: {
    async put(key: string, data: Uint8Array, contentType: string) {
      fakeFiles.set(key, { data, contentType });
    },
    async get(key: string) {
      const entry = fakeFiles.get(key);
      if (!entry) throw new Error(`not found: ${key}`);
      return entry.data;
    },
    async delete(key: string) {
      fakeFiles.delete(key);
    },
    async deletePrefix(prefix: string) {
      for (const key of fakeFiles.keys()) {
        if (key.startsWith(prefix)) fakeFiles.delete(key);
      }
    },
    async getUrl(key: string) {
      return `/api/files/${key}`;
    },
  },
}));

import { db, dbReady } from "@/db";
import { chunks, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { chunkPlainText, detectBookFormat } from "@/domain/book-format";
import {
  createBookFromExtracted,
  createBookFromUpload,
} from "@/services/books";

const OWNER = "user_upload_test";

beforeAll(async () => {
  await dbReady;
  await db.insert(users).values({ id: OWNER, email: "owner@example.com" });
});

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// ---------------------------------------------------------------------------
// detectBookFormat — extension + magic-byte sniff, spoofing rejected
// ---------------------------------------------------------------------------
describe("detectBookFormat", () => {
  it("accepts a real PDF by its %PDF magic bytes", () => {
    const data = utf8("%PDF-1.4\n...");
    expect(detectBookFormat("book.pdf", data)).toBe("pdf");
  });

  it("accepts plain decodable text as .txt", () => {
    expect(detectBookFormat("book.txt", utf8("Once upon a time.\n"))).toBe(
      "txt",
    );
  });

  it("accepts a real EPUB zip with the mimetype entry", () => {
    const zip = zipSync(
      { mimetype: strToU8("application/epub+zip") },
      { level: 0 },
    );
    expect(detectBookFormat("book.epub", zip)).toBe("epub");
  });

  it("rejects an unsupported extension", () => {
    expect(detectBookFormat("book.docx", utf8("hello"))).toBeNull();
  });

  it("rejects a spoofed file: .pdf extension on non-PDF bytes", () => {
    expect(detectBookFormat("fake.pdf", utf8("not actually a pdf"))).toBeNull();
  });

  it("rejects a spoofed file: .epub extension on a plain zip with no epub mimetype", () => {
    const zip = zipSync({ "readme.txt": strToU8("hello") }, { level: 0 });
    expect(detectBookFormat("fake.epub", zip)).toBeNull();
  });

  it("rejects a spoofed file: .txt extension on binary data", () => {
    const binary = new Uint8Array([0, 1, 2, 3, 0, 255, 0, 128]);
    expect(detectBookFormat("fake.txt", binary)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createBookFromUpload
// ---------------------------------------------------------------------------
describe("createBookFromUpload", () => {
  it("chunks a .txt upload and marks the book ready", async () => {
    const paragraphs = Array.from(
      { length: 5 },
      (_, i) => `Paragraph ${i} of the story, with some real prose in it.`,
    );
    const text = paragraphs.join("\n\n");

    const book = await createBookFromUpload({
      ownerId: OWNER,
      filename: "my-story.txt",
      data: utf8(text),
    });

    expect(book.status).toBe("ready");
    expect(book.sourceFormat).toBe("txt");
    expect(book.title).toBe("my-story");
    expect(book.totalChunks).toBe(chunkPlainText(text).length);

    const rows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.bookId, book.id));
    expect(rows).toHaveLength(book.totalChunks ?? 0);
    expect(rows[0].text).toContain("Paragraph 0");
  });

  it("extracts a synthetic EPUB, chunks it, and pulls title/author from metadata", async () => {
    const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
    const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Upload Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>`;
    const chapter = `<html><body><h1>CHAPTER I</h1><p>${"Prose. ".repeat(100)}</p></body></html>`;

    const epubBytes = zipSync(
      {
        mimetype: strToU8("application/epub+zip"),
        "META-INF/container.xml": strToU8(containerXml),
        "OEBPS/content.opf": strToU8(opf),
        "OEBPS/ch1.xhtml": strToU8(chapter),
      },
      { level: 0 },
    );

    const book = await createBookFromUpload({
      ownerId: OWNER,
      filename: "upload-test.epub",
      data: epubBytes,
    });

    expect(book.status).toBe("ready");
    expect(book.sourceFormat).toBe("epub");
    expect(book.title).toBe("Upload Test Book");
    expect(book.author).toBe("Test Author");
    expect(book.totalChunks).toBeGreaterThan(0);

    const rows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.bookId, book.id));
    expect(rows.some((r) => r.text.includes("CHAPTER I"))).toBe(true);
    expect(rows.some((r) => r.text.includes("Prose."))).toBe(true);
  });

  it("a user-supplied title overrides EPUB metadata", async () => {
    const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf"/></rootfiles>
</container>`;
    const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Metadata Title</dc:title>
  </metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;
    const epubBytes = zipSync(
      {
        mimetype: strToU8("application/epub+zip"),
        "META-INF/container.xml": strToU8(containerXml),
        "content.opf": strToU8(opf),
        "c1.xhtml": strToU8("<html><body><p>Some text.</p></body></html>"),
      },
      { level: 0 },
    );

    const book = await createBookFromUpload({
      ownerId: OWNER,
      filename: "book.epub",
      data: epubBytes,
      title: "User-Chosen Title",
    });

    expect(book.title).toBe("User-Chosen Title");
  });

  it("rejects an unsupported/spoofed file up front, without creating a book row", async () => {
    await expect(
      createBookFromUpload({
        ownerId: OWNER,
        filename: "definitely-not-a.pdf",
        data: utf8("plain garbage, not a PDF"),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("marks the book 'failed' when a validly-typed file can't actually be extracted", async () => {
    // A real zip with the epub mimetype marker (passes detectBookFormat's
    // sniff) but no container.xml/OPF inside — extraction must fail
    // cleanly and the book should land in 'failed', not throw uncaught.
    const brokenEpub = zipSync(
      { mimetype: strToU8("application/epub+zip") },
      { level: 0 },
    );

    const book = await createBookFromUpload({
      ownerId: OWNER,
      filename: "broken.epub",
      data: brokenEpub,
    });

    expect(book.status).toBe("failed");
    expect(book.sourceFormat).toBe("epub");
  });
});

// ---------------------------------------------------------------------------
// createBookFromExtracted — the primary path: the browser extracts a file to
// page text and posts it (no server-side parsing, no stored source blob),
// sidestepping Vercel's 4.5MB serverless request-body limit.
// ---------------------------------------------------------------------------
describe("createBookFromExtracted", () => {
  it("creates a ready book from already-extracted pages, re-deriving word counts", async () => {
    const book = await createBookFromExtracted({
      ownerId: OWNER,
      sourceFormat: "pdf",
      title: "Extracted Novel",
      author: "A. Writer",
      pages: [
        { pageNum: 1, text: "The first page, four words here." },
        { pageNum: 2, text: "Second page prose." },
      ],
    });

    expect(book.status).toBe("ready");
    expect(book.sourceFormat).toBe("pdf");
    expect(book.title).toBe("Extracted Novel");
    expect(book.author).toBe("A. Writer");
    expect(book.totalChunks).toBe(2);
    expect(book.totalWords).toBe(9);

    const rows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.bookId, book.id));
    expect(rows).toHaveLength(2);
    expect(rows[0].text).toContain("first page");
    // No source blob is stored on this path.
    expect(book.sourceKey ?? null).toBeNull();
  });

  it("drops blank pages and re-numbers sequentially", async () => {
    const book = await createBookFromExtracted({
      ownerId: OWNER,
      sourceFormat: "pdf",
      pages: [
        { pageNum: 1, text: "Real content." },
        { pageNum: 2, text: "   " },
        { pageNum: 3, text: "More content." },
      ],
    });

    expect(book.totalChunks).toBe(2);
    const rows = await db
      .select()
      .from(chunks)
      .where(eq(chunks.bookId, book.id));
    expect(rows.map((r) => r.pageNumber)).toEqual([1, 2]);
  });

  it("defaults an untitled upload to 'Untitled'", async () => {
    const book = await createBookFromExtracted({
      ownerId: OWNER,
      sourceFormat: "txt",
      pages: [{ pageNum: 1, text: "Body." }],
    });
    expect(book.title).toBe("Untitled");
  });

  it("rejects an empty extraction (e.g. a scanned, image-only PDF)", async () => {
    await expect(
      createBookFromExtracted({
        ownerId: OWNER,
        sourceFormat: "pdf",
        pages: [{ pageNum: 1, text: "   " }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
