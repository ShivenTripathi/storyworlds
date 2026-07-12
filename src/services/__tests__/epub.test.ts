/**
 * Unit tests for the pure-JS EPUB extractor (src/services/epub.ts). Builds a
 * small synthetic EPUB in-memory with `fflate` — a real zip archive with a
 * container.xml -> OPF -> manifest/spine, exactly like a real EPUB producer
 * emits — so these tests exercise the actual zip + XML parsing path without
 * any network dependency on a real Gutenberg download (see the throwaway
 * verify script for that).
 */
import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { extractEpubText, htmlToPlainText } from "@/services/epub";

const CONTAINER_XML = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Synthetic Adventure</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
    <dc:creator>Grace Hopper</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="ch2"/>
  </spine>
</package>`;

const NAV_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body><nav epub:type="toc"><ol><li><a href="text/chapter1.xhtml">Chapter One</a></li></ol></nav></body>
</html>`;

const CHAPTER1 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title><style>p { color: red; }</style></head>
<body>
  <h1>CHAPTER I</h1>
  <p>It was a dark &amp; stormy night &mdash; the wind howled.</p>
  <p>She said, &ldquo;Hello, world.&rdquo;</p>
  <script>console.log("should be stripped");</script>
</body>
</html>`;

const CHAPTER2 = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <h1>CHAPTER II</h1>
  <p>The second chapter begins here, long after the first.</p>
</body>
</html>`;

function buildSyntheticEpub(): Uint8Array {
  return zipSync(
    {
      mimetype: strToU8("application/epub+zip"),
      "META-INF/container.xml": strToU8(CONTAINER_XML),
      "OEBPS/content.opf": strToU8(OPF),
      "OEBPS/nav.xhtml": strToU8(NAV_XHTML),
      "OEBPS/toc.ncx": strToU8("<ncx/>"),
      "OEBPS/text/chapter1.xhtml": strToU8(CHAPTER1),
      "OEBPS/text/chapter2.xhtml": strToU8(CHAPTER2),
    },
    { level: 0 },
  );
}

describe("extractEpubText", () => {
  it("extracts clean text, in spine reading order, with no tags/entities left", async () => {
    const result = await extractEpubText(buildSyntheticEpub());

    expect(result.text).not.toMatch(/<[a-z][\s\S]*>/i);
    expect(result.text).not.toContain("&amp;");
    expect(result.text).not.toContain("&mdash;");
    expect(result.text).not.toContain("&ldquo;");
    expect(result.text).not.toContain("should be stripped");
    expect(result.text).not.toContain("color: red");

    expect(result.text).toContain("dark & stormy night — the wind howled");
    expect(result.text).toContain("“Hello, world.”");

    // Reading order: chapter 1's content precedes chapter 2's.
    const idx1 = result.text.indexOf("CHAPTER I");
    const idx2 = result.text.indexOf("CHAPTER II");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThan(idx1);

    // Headings landed on their own paragraph (blank-line separated), which
    // is what src/domain/reader-format.ts needs to recognize them as
    // headings rather than folding them into the following prose.
    const paragraphs = result.text.split(/\n{2,}/);
    expect(paragraphs.some((p) => p.trim() === "CHAPTER I")).toBe(true);
    expect(paragraphs.some((p) => p.trim() === "CHAPTER II")).toBe(true);

    // The nav document (properties="nav") must be excluded from the body.
    expect(result.text).not.toContain("Chapter One");
  });

  it("pulls title/author from the OPF dc:title / dc:creator metadata", async () => {
    const result = await extractEpubText(buildSyntheticEpub());
    expect(result.title).toBe("The Synthetic Adventure");
    expect(result.author).toBe("Ada Lovelace, Grace Hopper");
  });

  it("rejects a non-EPUB zip / garbage input with a clear error", async () => {
    const notAnEpub = zipSync({ "readme.txt": strToU8("hello") });
    await expect(extractEpubText(notAnEpub)).rejects.toThrow();
    await expect(
      extractEpubText(new Uint8Array([1, 2, 3, 4])),
    ).rejects.toThrow();
  });
});

describe("htmlToPlainText", () => {
  it("converts block boundaries into blank-line paragraph breaks", () => {
    const html = "<body><p>First.</p><p>Second.</p></body>";
    const text = htmlToPlainText(html);
    expect(text.split(/\n{2,}/).map((p) => p.trim())).toEqual([
      "First.",
      "Second.",
    ]);
  });

  it("strips scripts and styles entirely, including their content", () => {
    const html =
      "<body><style>.x{color:red}</style><p>Visible</p><script>alert(1)</script></body>";
    const text = htmlToPlainText(html);
    expect(text).toBe("Visible");
  });
});
