import { extractText, getDocumentProxy } from "unpdf";

// A single PDF within the 50MB upload cap can still hold tens of thousands of
// pages; each becomes a chunk row (+ image-pipeline work). Cap it so a
// pathological file can't exhaust DB writes / the analysis pipeline.
const MAX_PAGES = 5000;

export class PdfTooLargeError extends Error {
  constructor(public readonly totalPages: number) {
    super(`PDF has ${totalPages} pages; the limit is ${MAX_PAGES}.`);
    this.name = "PdfTooLargeError";
  }
}

export interface PdfPage {
  pageNum: number; // 1-based
  text: string;
  wordCount: number;
}

export interface PdfExtractResult {
  pages: PdfPage[];
  totalPages: number;
  totalWords: number;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Extracts per-page text from a PDF buffer using unpdf/pdf.js. Every page
 * becomes an entry (even blank ones) so page numbers line up 1:1 with
 * downstream chunk indices.
 */
export async function extractPdf(data: Uint8Array): Promise<PdfExtractResult> {
  const pdf = await getDocumentProxy(data);
  if (pdf.numPages > MAX_PAGES) {
    throw new PdfTooLargeError(pdf.numPages);
  }
  const { totalPages, text } = await extractText(pdf, { mergePages: false });

  const pages: PdfPage[] = text.map((raw, i) => {
    const normalized = normalize(raw);
    return {
      pageNum: i + 1,
      text: normalized,
      wordCount: countWords(normalized),
    };
  });

  const totalWords = pages.reduce((sum, p) => sum + p.wordCount, 0);

  return { pages, totalPages, totalWords };
}
