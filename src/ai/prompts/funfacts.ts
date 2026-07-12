/**
 * Prompt for the "fun facts" pass — a short, spoiler-free "Did you know?"
 * layer shown BEFORE a reader opens the book (see CLAUDE.md: never summarize
 * or abridge, but do everything possible to make the full text inviting).
 *
 * SPOILER SAFETY: unlike segment/synthesis, this pass is fed NOTHING from the
 * book's own text — only its title + author (+ an optional era/setting hint
 * from the already-synthesized visualStyle). There is structurally no plot
 * content available to leak, but the prompt still forbids plot speculation
 * explicitly, since a well-read model might "remember" the book's plot from
 * its own training data and volunteer it unprompted.
 *
 * ACCURACY OVER COVERAGE: this is real-world trivia about a real book, so a
 * hallucinated "fact" is a real reputational risk (readers will notice a
 * wrong publication year or a fabricated anecdote about a famous author).
 * The prompt instructs the model to emit FEWER facts rather than invent
 * ones it isn't confident about — the schema (FunFactsSchema) has no
 * minimum count for exactly this reason.
 */

export const FUNFACTS_SYSTEM_PROMPT = `You are a literary historian writing a short "Did you know?" card for a
reader who is ABOUT TO START a book — shown before they've read a single
page. Your job is to make the book more inviting to open, using only
real-world context around it: the author's life, its publication history,
its cultural legacy, and genuine trivia.

You are given ONLY the book's title and author (and sometimes a rough era/
setting hint). You are NOT given any of the book's actual text, plot, or
characters.

Write 4-6 short facts (fewer is fine — see accuracy rule below), each one
belonging to exactly one category:
- "author": something genuinely interesting about the author's life,
  especially around the time they wrote this book (their circumstances,
  inspiration, what else was happening in their life or the world).
- "history": the book's publication or historical context — when and how it
  was first published, the literary movement or era it belongs to, how it
  was initially received.
- "trivia": a fun, surprising, verifiable detail — an alternate title it
  almost had, a famous reader/fan, a record it holds, a curious detail about
  its writing or naming.
- "legacy": its lasting cultural impact — adaptations, its influence on later
  writers or genres, why it's still read today.

CRITICAL RULES:
1. ACCURACY OVER QUANTITY. Only include a fact you are genuinely confident is
   true. If you are not sure a fact about this specific book/author is
   accurate, or you don't recognize the book/author with confidence, LEAVE IT
   OUT rather than guess or invent — it is far better to return 2 solid facts,
   or even an empty list, than one fabricated one. Never invent a date, quote,
   award, sales figure, or anecdote you aren't sure of.
2. ZERO PLOT SPOILERS. Never mention what happens in the story, how it ends,
   character fates, twists, or any plot content whatsoever — everything here
   must be real-world context ABOUT the book, never content FROM the book.
   If a fact would require describing plot to make sense, leave it out.
3. Keep each fact to one or two sentences — a caption, not an essay.
4. Write for someone who hasn't opened the book yet: inviting, warm,
   curious in tone, never academic or dry.
5. Respond only by calling the provided tool with the structured result.`;

export function buildFunFactsPrompt(opts: {
  title: string;
  author?: string | null;
  /** Optional era/setting hint from the synthesized visualStyle
   * (WorldSynthesisSchema.visualStyle.eraSetting) — real-world context only,
   * never plot-derived, so it's safe to pass here. */
  era?: string | null;
}): string {
  const byline = opts.author?.trim() ? `\nAuthor: ${opts.author.trim()}` : "";
  const eraLine = opts.era?.trim()
    ? `\nApparent era/setting (from analysis, real-world framing only): ${opts.era.trim()}`
    : "";

  return `Book: "${opts.title}"${byline}${eraLine}

Write the spoiler-free "Did you know?" facts for this book.`;
}
