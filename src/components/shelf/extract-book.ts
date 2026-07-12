/**
 * Client-side book extraction. Runs entirely in the browser so the upload
 * flow posts already-extracted text (a small JSON body) instead of the raw
 * file — this sidesteps Vercel's 4.5MB serverless request-body limit that
 * made large PDFs fail, and moves extraction CPU off the timeout-bound
 * serverless function.
 *
 * Reuses the exact same extractors as the server (unpdf for PDF, fflate for
 * EPUB) and the shared domain chunker, so a book binds identically whether it
 * was extracted here or (via the legacy multipart path) on the server.
 */

import {
  chunkPlainText,
  decodeTextFile,
  detectBookFormat,
  titleFromFilename,
  type BookSourceFormat,
} from "@/domain/book-format";
import { extractEpubText } from "@/services/epub";
import { extractPdf } from "@/services/pdf";

export interface ExtractedBook {
  sourceFormat: BookSourceFormat;
  /** From EPUB metadata / filename; the user can still override in the form. */
  title: string | null;
  author: string | null;
  /** Page-sized text ready to post. Empty pages are dropped server-side. */
  pages: { pageNum: number; text: string }[];
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Reads a chosen File, detects its true format from magic bytes (never the
 * extension/MIME alone), and extracts it to page-sized text in the browser.
 * Throws `ExtractionError` with a reader-facing message on unsupported or
 * un-parseable files.
 */
export async function extractBookInBrowser(file: File): Promise<ExtractedBook> {
  const data = new Uint8Array(await file.arrayBuffer());

  const format = detectBookFormat(file.name, data);
  if (!format) {
    throw new ExtractionError(
      "That file isn't a readable PDF, EPUB, or text file — it may be corrupt or a different format.",
    );
  }

  try {
    if (format === "pdf") {
      const { pages } = await extractPdf(data);
      return {
        sourceFormat: "pdf",
        title: titleFromFilename(file.name) || null,
        author: null,
        pages: pages.map((p) => ({ pageNum: p.pageNum, text: p.text })),
      };
    }

    let text: string;
    let title: string | null = titleFromFilename(file.name) || null;
    let author: string | null = null;

    if (format === "epub") {
      const extracted = await extractEpubText(data);
      text = extracted.text;
      title = extracted.title ?? title;
      author = extracted.author ?? null;
    } else {
      text = decodeTextFile(data);
    }

    const pages = chunkPlainText(text).map((pageText, i) => ({
      pageNum: i + 1,
      text: pageText,
    }));

    return { sourceFormat: format, title, author, pages };
  } catch (err) {
    if (err instanceof ExtractionError) throw err;
    const detail = err instanceof Error ? err.message : "unknown error";
    throw new ExtractionError(
      `We couldn't read that ${format.toUpperCase()} file (${detail}). If it's a scanned or DRM-protected file, its text can't be extracted.`,
    );
  }
}
